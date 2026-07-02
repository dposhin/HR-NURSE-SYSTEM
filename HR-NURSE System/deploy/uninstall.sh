#!/usr/bin/env bash
#
#  HR Nurse System — uninstaller
#  -----------------------------
#  Two modes:
#
#   SERVER (default):  removes the systemd service, nginx site, and dnsmasq record
#                      created by deploy/install.sh. Optionally deletes the app dir.
#       sudo bash deploy/uninstall.sh [/opt/hr-nurse]
#
#   LOCAL workstation: removes the in-project install made by setup.sh
#                      (node_modules, backend/.env, and the SQLite database).
#       bash deploy/uninstall.sh --local
#
set -euo pipefail
C_WARN=$'\e[33m'; C_OFF=$'\e[0m'
yesno(){ read -rp "$1 (y/N): " a; [[ "$a" =~ ^[Yy] ]]; }

# ---- LOCAL / workstation cleanup ----
if [ "${1:-}" = "--local" ]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  echo "Local (workstation) cleanup in: $ROOT"
  echo "This removes: backend/node_modules, backend/.env, backend/data/ (the DATABASE)."
  yesno "Proceed?" || { echo "Cancelled."; exit 0; }
  rm -rf "$ROOT/backend/node_modules"
  rm -f  "$ROOT/backend/.env"
  if [ -d "$ROOT/backend/data" ]; then
    yesno "Also delete the database in backend/data/ ?" && rm -rf "$ROOT/backend/data" && echo "Database deleted." || echo "Database kept."
  fi
  echo "Local cleanup done. Re-run with:  bash setup.sh"
  exit 0
fi

# ---- SERVER uninstall ----
[ "$(id -u)" -eq 0 ] || { echo "Run server uninstall with sudo, or use --local for a workstation."; exit 1; }
INSTALL_DIR="${1:-/opt/hr-nurse}"

yesno "Remove HR Nurse systemd service, nginx site & DNS record?" || exit 0
systemctl disable --now hr-nurse 2>/dev/null || true
rm -f /etc/systemd/system/hr-nurse.service && systemctl daemon-reload
rm -f /etc/nginx/sites-enabled/hr-nurse /etc/nginx/sites-available/hr-nurse
rm -f /etc/dnsmasq.d/hr-nurse.conf
systemctl restart dnsmasq 2>/dev/null || true
nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
echo "Service, nginx config, and DNS record removed."

echo -e "${C_WARN}The app directory $INSTALL_DIR still contains the database.${C_OFF}"
if yesno "Delete $INSTALL_DIR entirely (INCLUDING the database)?"; then
  rm -rf "$INSTALL_DIR"; echo "Deleted $INSTALL_DIR"
else
  echo "Kept $INSTALL_DIR (back up backend/data/ or run pg_dump before deleting)."
fi
echo "Uninstall complete."
