#!/usr/bin/env bash
#
#  HR Nurse System — Control Dashboard
#  ===================================
#  One menu to install, run, secure, integrate, and troubleshoot the system.
#
#      bash dashboard.sh
#
#  Menu:
#    1) Install / Setup            (runs setup.sh; choose port)
#    2) Service control            (start / stop / restart / status)
#    3) Network & firewall check   (fixes "can't reach the server from another PC")
#    4) HTTPS / certificates       (self-signed, Let's Encrypt, or disable)
#    5) API integrations           (email SMTP, SMS gateway, webhook)
#    6) Logs & diagnostics
#    7) Change port
#    8) Full uninstall
#    0) Exit
#
set -uo pipefail

# ---------------------------------------------------------------- helpers ---
C_OK=$'\e[32m'; C_WARN=$'\e[33m'; C_ERR=$'\e[31m'; C_H=$'\e[1;36m'; C_DIM=$'\e[2m'; C_OFF=$'\e[0m'
ok(){ echo -e "${C_OK}✔${C_OFF} $*"; }
warn(){ echo -e "${C_WARN}!${C_OFF} $*"; }
err(){ echo -e "${C_ERR}✘${C_OFF} $*"; }
hd(){ echo; echo -e "${C_H}━━ $* ━━${C_OFF}"; }
pause(){ echo; read -rp "Press Enter to return to the menu… " _; }
yesno(){ local d="${2:-y}"; read -rp "$1 ($([ "$d" = y ] && echo 'Y/n' || echo 'y/N')): " a; a="${a:-$d}"; [[ "$a" =~ ^[Yy] ]]; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
ENV_FILE="$BACKEND/.env"

env_get(){ [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }
env_set(){ # env_set KEY VALUE
  touch "$ENV_FILE"
  if grep -qE "^$1=" "$ENV_FILE"; then
    sed "s|^$1=.*|$1=$2|" "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
  fi
}
env_unset(){ [ -f "$ENV_FILE" ] && grep -vE "^$1=" "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"; }
cur_port(){ local p; p="$(env_get PORT)"; echo "${p:-3000}"; }
has_systemd_service(){ [ -f /etc/systemd/system/hr-nurse.service ]; }
os_name(){ uname -s 2>/dev/null || echo unknown; }
port_free(){ command -v node >/dev/null 2>&1 && node -e "const n=require('net').createServer();n.once('error',()=>process.exit(1)).once('listening',()=>n.close(()=>process.exit(0))).listen($1,'0.0.0.0')" >/dev/null 2>&1; }

restart_hint(){
  if has_systemd_service; then
    if yesno "Restart the service now to apply?"; then sudo systemctl restart hr-nurse && ok "Restarted."; fi
  else
    warn "Restart the app to apply: stop it (Ctrl+C) and run  cd backend && npm start"
  fi
}

# ------------------------------------------------------------- 1) install ---
do_install(){
  hd "Install / Setup"
  [ -f "$ROOT/setup.sh" ] || { err "setup.sh not found."; return; }
  echo "This runs the in-project installer (dependencies, .env, database, port choice)."
  bash "$ROOT/setup.sh"
}

# ------------------------------------------------------- 2) service control -
do_service(){
  hd "Service control"
  if has_systemd_service; then
    echo "  1) Start     2) Stop     3) Restart     4) Status     5) Live logs     0) Back"
    read -rp "Choose: " s
    case "$s" in
      1) sudo systemctl start hr-nurse && ok "Started." ;;
      2) sudo systemctl stop hr-nurse && ok "Stopped." ;;
      3) sudo systemctl restart hr-nurse && ok "Restarted." ;;
      4) systemctl status hr-nurse --no-pager ;;
      5) echo "(Ctrl+C to stop)"; journalctl -u hr-nurse -f ;;
      *) return ;;
    esac
  else
    warn "No systemd service found (workstation mode)."
    echo "Start the app manually:   cd backend && npm start"
    echo "Run it in the background:  cd backend && nohup npm start > ../app.log 2>&1 &"
    if yesno "Start it in the background now?" n; then
      ( cd "$BACKEND" && nohup npm start > "$ROOT/app.log" 2>&1 & ) && ok "Started (logs: app.log). Port $(cur_port)."
    fi
  fi
}

# --------------------------------------------------- 3) network & firewall --
do_network(){
  hd "Network & firewall check"
  local port; port="$(cur_port)"
  echo "Configured port: ${C_H}$port${C_OFF}"
  echo
  echo "This server's IP address(es):"
  if command -v hostname >/dev/null 2>&1; then hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^$' | sed 's/^/   • /'; fi
  echo

  # Is the app listening, and on which address?
  local listen=""
  if command -v ss >/dev/null 2>&1; then listen="$(ss -lntp 2>/dev/null | grep ":$port ")";
  elif command -v netstat >/dev/null 2>&1; then listen="$(netstat -lntp 2>/dev/null | grep ":$port ")"; fi
  if [ -n "$listen" ]; then
    ok "Something is listening on port $port:"
    echo "   $listen" | sed 's/^/   /'
    echo "$listen" | grep -q '127.0.0.1' && ! echo "$listen" | grep -q '0.0.0.0' \
      && warn "It is bound to 127.0.0.1 (localhost only) — not reachable from other PCs. (This app binds 0.0.0.0 by default.)"
  else
    warn "Nothing is listening on port $port. Is the app running? (menu 2 → Start)"
  fi

  # Local health probe
  if command -v curl >/dev/null 2>&1; then
    local code; code="$(curl -m 4 -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/health" 2>/dev/null || echo 000)"
    [ "$code" = "200" ] && ok "Local health check OK (http://127.0.0.1:$port/api/health → 200)." \
                         || warn "Local health check returned '$code'. If not 200, the app may not be running."
  fi

  # Firewall — the usual cause of "loads forever from another PC"
  echo
  hd "Firewall"
  local fixed=0
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi 'Status: active'; then
    if ufw status | grep -qE "(^|[[:space:]])$port(/tcp)?[[:space:]]"; then
      ok "UFW is active and already allows port $port."
    else
      warn "UFW is active and does NOT allow port $port — this is very likely why remote access hangs."
      if yesno "Open port $port in UFW now (sudo ufw allow $port/tcp)?"; then
        sudo ufw allow "$port/tcp" && sudo ufw reload && ok "Opened port $port." && fixed=1
      fi
    fi
  elif command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld 2>/dev/null; then
    warn "firewalld is active."
    if yesno "Open port $port in firewalld now?"; then
      sudo firewall-cmd --permanent --add-port="$port/tcp" && sudo firewall-cmd --reload && ok "Opened port $port." && fixed=1
    fi
  else
    ok "No active UFW/firewalld detected on this host."
  fi

  # Windows note (in case the server is Windows / WSL)
  echo
  echo -e "${C_DIM}If the SERVER is Windows, allow the port in Windows Defender Firewall (Run as Admin):"
  echo "   netsh advfirewall firewall add rule name=\"HR Nurse $port\" dir=in action=allow protocol=TCP localport=$port${C_OFF}"

  echo
  echo "Then browse from another PC to:  ${C_H}http://<this-server-ip>:$port/${C_OFF}"
  [ "$fixed" -eq 1 ] && ok "Firewall updated — try the other workstation again now."
}

# ------------------------------------------------------ 4) HTTPS / certs ----
do_tls(){
  hd "HTTPS / Certificates"
  local cur_cert; cur_cert="$(env_get SSL_CERT)"
  [ -n "$cur_cert" ] && echo "Current: TLS ${C_OK}ON${C_OFF} ($cur_cert)" || echo "Current: TLS ${C_WARN}OFF${C_OFF} (serving plain HTTP)"
  echo
  echo "  1) Self-signed certificate (works on the LAN; browser shows a one-time warning)"
  echo "  2) Let's Encrypt via nginx  (needs a public domain pointing here)"
  echo "  3) Disable HTTPS (serve plain HTTP)"
  echo "  0) Back"
  read -rp "Choose: " c
  case "$c" in
    1)
      command -v openssl >/dev/null 2>&1 || { err "openssl not installed (sudo apt install openssl)."; return; }
      mkdir -p "$BACKEND/certs"
      local ip; ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
      local cn; cn="$(read -rp "Common name (domain or IP) [${ip:-localhost}]: " x; echo "${x:-${ip:-localhost}}")"
      openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
        -keyout "$BACKEND/certs/app.key" -out "$BACKEND/certs/app.crt" -subj "/CN=$cn" 2>/dev/null
      env_set SSL_CERT "$BACKEND/certs/app.crt"
      env_set SSL_KEY  "$BACKEND/certs/app.key"
      ok "Self-signed certificate created. The app will serve HTTPS on port $(cur_port)."
      warn "Browsers will warn once (self-signed) — users click 'Advanced → proceed'."
      restart_hint
      ;;
    2)
      command -v certbot >/dev/null 2>&1 || { warn "certbot/nginx flow is part of the full server install."; echo "Run:  sudo bash deploy/install.sh   and choose the Let's Encrypt TLS option."; return; }
      local dom; dom="$(read -rp "Public domain (e.g. hrnurse.example.com): " x; echo "$x")"
      [ -z "$dom" ] && { err "Domain required."; return; }
      sudo certbot --nginx -d "$dom" --redirect --agree-tos -m "admin@$dom" -n && ok "Certificate issued for $dom." || err "certbot failed."
      ;;
    3)
      env_unset SSL_CERT; env_unset SSL_KEY
      ok "HTTPS disabled — serving plain HTTP on port $(cur_port)."
      restart_hint
      ;;
    *) return ;;
  esac
}

# ------------------------------------------------- 5) API integrations ------
do_integrations(){
  hd "API integrations"
  echo "Store credentials for optional integrations (used by messaging & external hooks)."
  echo "  1) Email (SMTP)      2) SMS gateway      3) Webhook URL"
  echo "  4) Show current      5) Test connectivity     0) Back"
  read -rp "Choose: " c
  case "$c" in
    1)
      local h u p f pt
      h="$(read -rp 'SMTP host (e.g. smtp.gmail.com): ' x; echo "$x")"
      pt="$(read -rp 'SMTP port [587]: ' x; echo "${x:-587}")"
      u="$(read -rp 'SMTP username: ' x; echo "$x")"
      p="$(read -rsp 'SMTP password/app-key: ' x; echo >&2; echo "$x")"
      f="$(read -rp 'From address: ' x; echo "$x")"
      env_set SMTP_HOST "$h"; env_set SMTP_PORT "$pt"; env_set SMTP_USER "$u"; env_set SMTP_PASS "$p"; env_set SMTP_FROM "$f"
      ok "SMTP settings saved to .env."
      warn "Note: outbound email delivery is a planned feature; these credentials are stored ready for it."
      ;;
    2)
      local prov key snd
      prov="$(read -rp 'SMS provider (twilio / semaphore / other): ' x; echo "$x")"
      key="$(read -rsp 'API key / token: ' x; echo >&2; echo "$x")"
      snd="$(read -rp 'Sender ID / from number: ' x; echo "$x")"
      env_set SMS_PROVIDER "$prov"; env_set SMS_API_KEY "$key"; env_set SMS_SENDER "$snd"
      ok "SMS settings saved to .env."
      warn "Note: SMS delivery is a planned feature; credentials are stored ready for it."
      ;;
    3)
      local w; w="$(read -rp 'Webhook URL (POSTed on new messages/events): ' x; echo "$x")"
      env_set WEBHOOK_URL "$w"; ok "Webhook URL saved."
      ;;
    4)
      echo; echo "Current integration settings (secrets hidden):"
      for k in SMTP_HOST SMTP_PORT SMTP_USER SMTP_FROM SMS_PROVIDER SMS_SENDER WEBHOOK_URL; do
        printf "   %-14s %s\n" "$k" "$(env_get "$k")"
      done
      for k in SMTP_PASS SMS_API_KEY; do
        v="$(env_get "$k")"; printf "   %-14s %s\n" "$k" "$([ -n "$v" ] && echo '••••••(set)' || echo '(not set)')"
      done
      ;;
    5)
      local h pt; h="$(env_get SMTP_HOST)"; pt="$(env_get SMTP_PORT)"
      if [ -n "$h" ] && [ -n "$pt" ]; then
        echo "Testing TCP connection to SMTP $h:$pt …"
        if command -v node >/dev/null 2>&1; then
          node -e "const s=require('net').connect($pt,'$h',()=>{console.log('OK: reachable');s.end();process.exit(0)});s.setTimeout(5000,()=>{console.log('TIMEOUT');process.exit(1)});s.on('error',e=>{console.log('FAIL: '+e.message);process.exit(1)});"
        fi
      else
        warn "No SMTP host configured yet."
      fi
      local w; w="$(env_get WEBHOOK_URL)"
      [ -n "$w" ] && command -v curl >/dev/null 2>&1 && { echo "Pinging webhook…"; curl -m 5 -s -o /dev/null -w 'Webhook HTTP %{http_code}\n' "$w" || warn "Webhook not reachable"; }
      ;;
    *) return ;;
  esac
}

# -------------------------------------------------- 6) logs & diagnostics ---
do_logs(){
  hd "Logs & diagnostics"
  echo "Configured port: $(cur_port)   |   DB engine: $(env_get DB_ENGINE)   |   TLS: $([ -n "$(env_get SSL_CERT)" ] && echo on || echo off)"
  echo
  if has_systemd_service; then
    echo "Last 30 service log lines:"; journalctl -u hr-nurse -n 30 --no-pager 2>/dev/null
  elif [ -f "$ROOT/app.log" ]; then
    echo "Last 30 lines of app.log:"; tail -n 30 "$ROOT/app.log"
  else
    warn "No service or app.log found. Start via menu 2 to generate logs."
  fi
  echo
  echo -e "${C_DIM}In-app errors are also visible at:  Control Panel → Troubleshooting (admin login).${C_OFF}"
}

# ---------------------------------------------------------- 7) change port --
do_port(){
  hd "Change port"
  local cur; cur="$(cur_port)"
  local new; new="$(read -rp "New port [$cur]: " x; echo "${x:-$cur}")"
  if ! [[ "$new" =~ ^[0-9]+$ ]] || [ "$new" -lt 1 ] || [ "$new" -gt 65535 ]; then err "Invalid port."; return; fi
  if [ "$new" != "$cur" ] && ! port_free "$new"; then
    warn "Port $new appears to be in use."
    yesno "Set it anyway?" n || return
  fi
  env_set PORT "$new"; ok "Port set to $new in .env."
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi 'active'; then
    yesno "Open port $new in the firewall too?" && sudo ufw allow "$new/tcp" && sudo ufw reload && ok "Firewall updated."
  fi
  restart_hint
}

# ------------------------------------------------------------ 8) uninstall --
do_uninstall(){
  hd "Full uninstall"
  echo "  1) Workstation cleanup (node_modules, .env, database)"
  echo "  2) Server uninstall (systemd service, nginx, DNS)"
  echo "  0) Back"
  read -rp "Choose: " c
  case "$c" in
    1) bash "$ROOT/deploy/uninstall.sh" --local ;;
    2) sudo bash "$ROOT/deploy/uninstall.sh" ;;
    *) return ;;
  esac
}

# ----------------------------------------------------------------- menu -----
banner(){
  clear 2>/dev/null || true
  local name; name="$(env_get ADMIN_USER >/dev/null 2>&1; echo)"
  echo -e "${C_H}"
  echo "  ┌────────────────────────────────────────────┐"
  echo "  │        HR NURSE SYSTEM · Control Dashboard    │"
  echo "  └────────────────────────────────────────────┘"
  echo -e "${C_OFF}${C_DIM}  dir: $ROOT   port: $(cur_port)   service: $(has_systemd_service && echo systemd || echo manual)${C_OFF}"
}

while true; do
  banner
  echo
  echo "   1) Install / Setup            (setup.sh — choose port, deps, DB)"
  echo "   2) Service control            (start / stop / restart / status)"
  echo "   3) Network & firewall check   (fix: can't reach server from another PC)"
  echo "   4) HTTPS / certificates       (self-signed · Let's Encrypt · disable)"
  echo "   5) API integrations           (email SMTP · SMS · webhook)"
  echo "   6) Logs & diagnostics"
  echo "   7) Change port"
  echo "   8) Full uninstall"
  echo "   0) Exit"
  echo
  read -rp "Select an option: " choice
  case "$choice" in
    1) do_install ;;
    2) do_service ;;
    3) do_network ;;
    4) do_tls ;;
    5) do_integrations ;;
    6) do_logs ;;
    7) do_port ;;
    8) do_uninstall ;;
    0|q|Q) echo "Bye."; exit 0 ;;
    *) warn "Unknown option: $choice" ;;
  esac
  pause
done
