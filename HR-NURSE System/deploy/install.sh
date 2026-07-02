#!/usr/bin/env bash
#
#  HR Nurse System — one-time automated installer for Ubuntu Server
#  ----------------------------------------------------------------
#  Installs and configures: Node.js, the app + database (SQLite or PostgreSQL),
#  a systemd service, an nginx reverse proxy, an optional LAN DNS record,
#  and prints guidance for Cloudflare and MikroTik / Peplink routers.
#
#  Usage:   sudo bash deploy/install.sh
#  Re-run:  safe to run again; it updates the existing install.
#
#  Tested on Ubuntu 20.04 / 22.04 / 24.04.
#
set -euo pipefail

# ----------------------------- helpers --------------------------------------
C_OK=$'\e[32m'; C_WARN=$'\e[33m'; C_ERR=$'\e[31m'; C_HEAD=$'\e[1;36m'; C_OFF=$'\e[0m'
say()  { echo -e "${C_OK}✔${C_OFF} $*"; }
warn() { echo -e "${C_WARN}!${C_OFF} $*"; }
err()  { echo -e "${C_ERR}✘ $*${C_OFF}" >&2; }
head() { echo; echo -e "${C_HEAD}== $* ==${C_OFF}"; }
ask()  { local p="$1" d="${2:-}" v; if [ -n "$d" ]; then read -rp "$p [$d]: " v; echo "${v:-$d}"; else read -rp "$p: " v; echo "$v"; fi; }
ask_secret() { local p="$1" v; read -rsp "$p: " v; echo >&2; echo "$v"; }
yesno() { local p="$1" d="${2:-y}" v; read -rp "$p ($([ "$d" = y ] && echo 'Y/n' || echo 'y/N')): " v; v="${v:-$d}"; [[ "$v" =~ ^[Yy] ]]; }

if [ "$(id -u)" -ne 0 ]; then err "Please run with sudo:  sudo bash deploy/install.sh"; exit 1; fi
if ! grep -qi ubuntu /etc/os-release 2>/dev/null; then warn "This installer targets Ubuntu. Continuing anyway."; fi

# Resolve repo root (the directory that contains backend/ and frontend/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ ! -d "$REPO_DIR/backend" ]; then err "Cannot find backend/ next to this script."; exit 1; fi

clear
cat <<'BANNER'
  ┌────────────────────────────────────────────┐
  │      HR NURSE SYSTEM  ·  Server Installer    │
  │   Occupational Health Management Platform    │
  └────────────────────────────────────────────┘
BANNER

# ----------------------------- gather inputs --------------------------------
head "Configuration"
DEFAULT_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
SERVER_IP="$(ask 'Server LAN IP address' "${DEFAULT_IP:-192.168.1.10}")"
DOMAIN="$(ask 'Domain or hostname for the app' 'hrnurse.local')"
APP_PORT="$(ask 'Internal app port (nginx proxies to this)' '3000')"
INSTALL_DIR="$(ask 'Install directory' '/opt/hr-nurse')"
SERVICE_USER="$(ask 'System user to run the service' 'hrnurse')"

head "Database"
echo "  1) SQLite     — zero-config single file. Recommended for one clinic / one server."
echo "  2) PostgreSQL — server-grade. Choose if you expect heavy use or external reporting."
DB_CHOICE="$(ask 'Select database engine' '1')"
if [ "$DB_CHOICE" = "2" ]; then DB_ENGINE="postgres"; else DB_ENGINE="sqlite"; fi

PG_PASS=""
if [ "$DB_ENGINE" = "postgres" ]; then
  PG_DB="$(ask 'PostgreSQL database name' 'hrnurse')"
  PG_USER="$(ask 'PostgreSQL user' 'hrnurse')"
  PG_PASS="$(ask_secret 'PostgreSQL password (blank = auto-generate)')"
  [ -z "$PG_PASS" ] && PG_PASS="$(openssl rand -hex 16)"
fi

head "Administrator account"
ADMIN_USER="$(ask 'Admin username' 'admin')"
ADMIN_PASS="$(ask_secret 'Admin password (blank = auto-generate)')"
[ -z "$ADMIN_PASS" ] && ADMIN_PASS="$(openssl rand -base64 9 | tr -dc 'A-Za-z0-9')"
SEED_DEMO="n"; yesno 'Load sample/demo employees to explore the system?' 'n' && SEED_DEMO="y"

head "Web server / TLS"
USE_TLS="n"
echo "  HTTPS options for nginx:"
echo "    1) HTTP only (LAN use behind a router/firewall)"
echo "    2) Self-signed certificate (HTTPS, browser warning)"
echo "    3) Let's Encrypt via certbot (needs a public domain pointing here)"
TLS_CHOICE="$(ask 'Select' '1')"

SETUP_DNS="n"; yesno "Set up a local DNS record so '$DOMAIN' resolves to $SERVER_IP on your LAN (dnsmasq)?" 'n' && SETUP_DNS="y"
SETUP_UFW="y"; yesno 'Configure UFW firewall (allow SSH, HTTP, HTTPS)?' 'y' || SETUP_UFW="n"

JWT_SECRET="$(openssl rand -hex 32)"

echo
head "Summary"
cat <<SUM
  Domain / IP     : $DOMAIN  ->  $SERVER_IP
  App port        : $APP_PORT   (nginx :80/:443 -> 127.0.0.1:$APP_PORT)
  Install dir     : $INSTALL_DIR
  Service user    : $SERVICE_USER
  Database        : $DB_ENGINE
  Admin user      : $ADMIN_USER
  Demo data       : $SEED_DEMO
  TLS option      : $TLS_CHOICE        Local DNS: $SETUP_DNS     UFW: $SETUP_UFW
SUM
yesno "Proceed with installation?" 'y' || { warn 'Aborted.'; exit 0; }

# ----------------------------- packages -------------------------------------
head "Installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg ufw nginx openssl rsync >/dev/null
say "Base packages installed."

# Node.js 20 LTS via NodeSource (only if missing or too old)
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  NODE_MAJ="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$NODE_MAJ" -ge 18 ] && NEED_NODE=0
fi
if [ "$NEED_NODE" -eq 1 ]; then
  head "Installing Node.js 20 LTS"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
fi
say "Node.js $(node -v) ready."

if [ "$DB_ENGINE" = "postgres" ]; then
  head "Installing PostgreSQL"
  apt-get install -y -qq postgresql postgresql-contrib >/dev/null
  systemctl enable --now postgresql >/dev/null 2>&1 || true
  # Create role + database idempotently
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$PG_USER'" | grep -q 1 \
    || sudo -u postgres psql -qc "CREATE ROLE \"$PG_USER\" LOGIN PASSWORD '$PG_PASS';"
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$PG_DB'" | grep -q 1 \
    || sudo -u postgres psql -qc "CREATE DATABASE \"$PG_DB\" OWNER \"$PG_USER\";"
  say "PostgreSQL database '$PG_DB' ready."
fi

# ----------------------------- app deploy -----------------------------------
head "Deploying application to $INSTALL_DIR"
id "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$INSTALL_DIR"
rsync -a --delete --exclude node_modules --exclude backend/.env --exclude backend/data "$REPO_DIR"/ "$INSTALL_DIR"/
chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"

# Write backend/.env
ENV_FILE="$INSTALL_DIR/backend/.env"
{
  echo "PORT=$APP_PORT"
  echo "NODE_ENV=production"
  echo "JWT_SECRET=$JWT_SECRET"
  echo "DB_ENGINE=$DB_ENGINE"
  if [ "$DB_ENGINE" = "postgres" ]; then
    echo "PGHOST=localhost"; echo "PGPORT=5432"
    echo "PGUSER=$PG_USER"; echo "PGPASSWORD=$PG_PASS"; echo "PGDATABASE=$PG_DB"
  else
    echo "SQLITE_PATH=$INSTALL_DIR/backend/data/hrnurse.db"
  fi
  echo "ADMIN_USER=$ADMIN_USER"
  echo "ADMIN_PASS=$ADMIN_PASS"
  echo "SEED_DEMO=$([ "$SEED_DEMO" = y ] && echo 1 || echo 0)"
} > "$ENV_FILE"
chown "$SERVICE_USER":"$SERVICE_USER" "$ENV_FILE"; chmod 600 "$ENV_FILE"
say "Environment written to $ENV_FILE"

head "Installing dependencies & initialising database"
cd "$INSTALL_DIR/backend"
sudo -u "$SERVICE_USER" bash -c "cd '$INSTALL_DIR/backend' && npm install --omit=dev --no-audit --no-fund"
sudo -u "$SERVICE_USER" bash -c "cd '$INSTALL_DIR/backend' && npm run init-db && npm run seed"
say "Database initialised and seeded."

# ----------------------------- systemd --------------------------------------
head "Creating systemd service"
cat > /etc/systemd/system/hr-nurse.service <<UNIT
[Unit]
Description=HR Nurse System
After=network.target $([ "$DB_ENGINE" = postgres ] && echo postgresql.service)

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR/backend
EnvironmentFile=$INSTALL_DIR/backend/.env
ExecStart=$(command -v node) $INSTALL_DIR/backend/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now hr-nurse >/dev/null 2>&1
sleep 2
systemctl is-active --quiet hr-nurse && say "Service hr-nurse is running." || { err "Service failed to start. Check: journalctl -u hr-nurse -n 50"; }

# ----------------------------- nginx ----------------------------------------
head "Configuring nginx reverse proxy"
NGINX_SITE="/etc/nginx/sites-available/hr-nurse"
LISTEN="listen 80;"
SSL_BLOCK=""
case "$TLS_CHOICE" in
  2)
    mkdir -p /etc/nginx/ssl
    [ -f /etc/nginx/ssl/hr-nurse.crt ] || openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
      -keyout /etc/nginx/ssl/hr-nurse.key -out /etc/nginx/ssl/hr-nurse.crt \
      -subj "/CN=$DOMAIN" >/dev/null 2>&1
    LISTEN="listen 80;
    listen 443 ssl;
    ssl_certificate     /etc/nginx/ssl/hr-nurse.crt;
    ssl_certificate_key /etc/nginx/ssl/hr-nurse.key;"
    ;;
esac

cat > "$NGINX_SITE" <<NGINX
server {
    $LISTEN
    server_name $DOMAIN $SERVER_IP;
    client_max_body_size 30m;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/hr-nurse
rm -f /etc/nginx/sites-enabled/default
nginx -t >/dev/null 2>&1 && systemctl reload nginx && say "nginx configured." || err "nginx config test failed — run 'nginx -t' to inspect."

if [ "$TLS_CHOICE" = "3" ]; then
  head "Let's Encrypt (certbot)"
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  warn "Make sure '$DOMAIN' publicly resolves to this server, then this will request a certificate."
  if yesno "Run certbot now for $DOMAIN?" 'y'; then
    certbot --nginx -d "$DOMAIN" --redirect --agree-tos -m "admin@$DOMAIN" -n || warn "certbot failed; you can re-run: certbot --nginx -d $DOMAIN"
  fi
fi

# ----------------------------- firewall -------------------------------------
if [ "$SETUP_UFW" = "y" ]; then
  head "Configuring UFW firewall"
  ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow 'Nginx Full' >/dev/null 2>&1 || { ufw allow 80/tcp; ufw allow 443/tcp; } >/dev/null 2>&1 || true
  yes | ufw enable >/dev/null 2>&1 || true
  say "Firewall active (SSH, HTTP, HTTPS allowed)."
fi

# ----------------------------- local DNS ------------------------------------
if [ "$SETUP_DNS" = "y" ]; then
  head "Setting up local DNS (dnsmasq)"
  apt-get install -y -qq dnsmasq >/dev/null
  # Avoid clashing with systemd-resolved on :53
  if ss -lntup 2>/dev/null | grep -q '127.0.0.53:53'; then
    mkdir -p /etc/systemd/resolved.conf.d
    echo -e "[Resolve]\nDNSStubListener=no" > /etc/systemd/resolved.conf.d/hr-nurse.conf
    systemctl restart systemd-resolved || true
  fi
  echo "address=/$DOMAIN/$SERVER_IP" > /etc/dnsmasq.d/hr-nurse.conf
  systemctl enable --now dnsmasq >/dev/null 2>&1 && systemctl restart dnsmasq || true
  say "dnsmasq resolves $DOMAIN -> $SERVER_IP."
  warn "Point your router's DHCP 'DNS server' option to $SERVER_IP so all LAN devices use it,"
  warn "or add a static DNS entry on the router (see router notes below)."
fi

# ----------------------------- guidance -------------------------------------
head "Router & Cloudflare notes (manual, optional)"
cat <<NOTES

  These steps are NOT automated — they are reminders for when you expose the app
  beyond the LAN or wire it into your router.

  ── MikroTik (RouterOS) ─────────────────────────────────────────────
   Port-forward 80/443 to this server (run in the MikroTik terminal):
     /ip firewall nat add chain=dstnat protocol=tcp dst-port=80 \\
        action=dst-nat to-addresses=$SERVER_IP to-ports=80 comment="HR-Nurse HTTP"
     /ip firewall nat add chain=dstnat protocol=tcp dst-port=443 \\
        action=dst-nat to-addresses=$SERVER_IP to-ports=443 comment="HR-Nurse HTTPS"
   Local DNS record (so '$DOMAIN' resolves on the LAN without dnsmasq):
     /ip dns static add name=$DOMAIN address=$SERVER_IP
   Hand out this server as DNS to clients:
     /ip dhcp-server network set [find] dns-server=$SERVER_IP

  ── Peplink (Balance / MAX) ─────────────────────────────────────────
   Web admin → Advanced → Port Forwarding → Add:
     Service: HR-Nurse | Protocol TCP | Port 80 and 443
     Server IP (LAN): $SERVER_IP
   Local DNS: Network → LAN → DNS Proxy → Local DNS Records:
     Host: $DOMAIN   ->   $SERVER_IP
   (If you have multiple WANs, set Outbound Policy / inbound rules as needed.)

  ── Cloudflare (future, public access) ──────────────────────────────
   1. Add your domain to Cloudflare and update the registrar's nameservers.
   2. DNS → add an A record:  $DOMAIN  ->  <your public WAN IP>  (Proxied ☁ ON).
   3. SSL/TLS mode: 'Full (strict)' if using a real cert here, else 'Full'.
   4. For a no-open-ports option, install 'cloudflared' and create a Tunnel:
        cloudflared tunnel create hr-nurse
        cloudflared tunnel route dns hr-nurse $DOMAIN
        # then run: cloudflared tunnel --url http://127.0.0.1:$APP_PORT run hr-nurse
   5. Keep MikroTik/Peplink port-forwards CLOSED if you use a Tunnel.

NOTES

# ----------------------------- done -----------------------------------------
PROTO="http"; [ "$TLS_CHOICE" != "1" ] && PROTO="https"
head "Installation complete 🎉"
cat <<DONE

  Open the app:
     $PROTO://$SERVER_IP/        (always works on the LAN)
     $PROTO://$DOMAIN/           (once DNS resolves)

  Login:
     username: $ADMIN_USER
     password: $ADMIN_PASS
  ${C_WARN}Change this password after first login (top-left → Change password).${C_OFF}

  Manage the service:
     systemctl status hr-nurse
     systemctl restart hr-nurse
     journalctl -u hr-nurse -f          # live logs

  Update after pulling new code:
     sudo bash deploy/install.sh        # re-run; it redeploys safely

  Backups:
$([ "$DB_ENGINE" = sqlite ] \
    && echo "     cp $INSTALL_DIR/backend/data/hrnurse.db /path/to/backup/" \
    || echo "     pg_dump -U $PG_USER $PG_DB > hrnurse-\$(date +%F).sql")

DONE
say "All set."
