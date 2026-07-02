#!/usr/bin/env bash
#
#  HR Nurse System — in-project quick setup (workstation / development)
#  -------------------------------------------------------------------
#  No root, no nginx, no system services. Installs Node dependencies inside
#  the project, configures .env, creates and seeds the database, then (optionally)
#  starts the app. Ideal for a sample workstation or to try the system locally.
#
#  Usage:   bash setup.sh            # set up and offer to start
#           bash setup.sh --start    # set up and start immediately
#           bash setup.sh --no-demo  # skip sample employees / demo portal logins
#
#  For a full Ubuntu SERVER install (nginx + service + DB + DNS) use:
#           sudo bash deploy/install.sh
#
set -euo pipefail

C_OK=$'\e[32m'; C_WARN=$'\e[33m'; C_ERR=$'\e[31m'; C_H=$'\e[1;36m'; C_OFF=$'\e[0m'
ok(){ echo -e "${C_OK}✔${C_OFF} $*"; }
warn(){ echo -e "${C_WARN}!${C_OFF} $*"; }
hd(){ echo; echo -e "${C_H}== $* ==${C_OFF}"; }

START=0; DEMO=1; PORT_ARG=""
for a in "$@"; do
  case "$a" in
    --start) START=1 ;;
    --no-demo) DEMO=0 ;;
    --port=*) PORT_ARG="${a#*=}" ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
  esac
done

# Is a TCP port free? (uses node, which we require anyway)
port_free() { node -e "const n=require('net').createServer();n.once('error',()=>process.exit(1)).once('listening',()=>n.close(()=>process.exit(0))).listen($1,'0.0.0.0')" >/dev/null 2>&1; }
next_free_port() { local p="$1"; for _ in $(seq 1 50); do port_free "$p" && { echo "$p"; return; }; p=$((p+1)); done; echo "$1"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT/backend"

hd "Checking prerequisites"
if ! command -v node >/dev/null 2>&1; then
  echo -e "${C_ERR}Node.js is not installed.${C_OFF}"
  echo "Install Node.js 18+ first:"
  echo "  • Ubuntu/Debian:  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt install -y nodejs"
  echo "  • macOS (brew):   brew install node"
  echo "  • Windows:        https://nodejs.org  (LTS installer)"
  exit 1
fi
NODE_MAJ="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJ" -ge 18 ] || { warn "Node $(node -v) detected; v18+ recommended."; }
ok "Node.js $(node -v) / npm $(npm -v)"

hd "Configuring environment (.env)"
if [ ! -f .env ]; then
  cp .env.example .env
  # Generate a real JWT secret if openssl is available
  if command -v openssl >/dev/null 2>&1; then
    SECRET="$(openssl rand -hex 32)"
    # portable in-place edit
    sed "s/^JWT_SECRET=.*/JWT_SECRET=$SECRET/" .env > .env.tmp && mv .env.tmp .env
  fi
  [ "$DEMO" -eq 0 ] && { sed "s/^SEED_DEMO=.*/SEED_DEMO=0/" .env > .env.tmp && mv .env.tmp .env; }
  ok "Created backend/.env (SQLite, no DB server needed)."
else
  # Replace a known placeholder secret with a strong one
  if command -v openssl >/dev/null 2>&1 && grep -q 'please-change-this-to-a-long-random-string' .env; then
    SECRET="$(openssl rand -hex 32)"
    sed "s|^JWT_SECRET=.*|JWT_SECRET=$SECRET|" .env > .env.tmp && mv .env.tmp .env
    ok "backend/.env exists — strengthened the JWT secret."
  else
    ok "backend/.env already exists — keeping it."
  fi
fi

hd "Choosing application port"
CUR_PORT="$(grep -E '^PORT=' .env | cut -d= -f2)"; CUR_PORT="${CUR_PORT:-3000}"
DESIRED="${PORT_ARG:-$CUR_PORT}"
if [ -z "$PORT_ARG" ] && [ "$START" -eq 0 ]; then
  read -rp "Port to run on [$DESIRED]: " ans; DESIRED="${ans:-$DESIRED}"
fi
if port_free "$DESIRED"; then
  ok "Port $DESIRED is available."
else
  SUGGEST="$(next_free_port $((DESIRED+1)))"
  warn "Port $DESIRED is already in use (another system may be running there)."
  if [ -z "$PORT_ARG" ] && [ "$START" -eq 0 ]; then
    read -rp "Use suggested free port $SUGGEST instead? (Y/n): " yn; yn="${yn:-y}"
    [[ "$yn" =~ ^[Yy] ]] && DESIRED="$SUGGEST" || warn "Keeping $DESIRED — start may fail until it is freed."
  else
    DESIRED="$SUGGEST"; warn "Auto-selected free port $SUGGEST."
  fi
fi
sed "s/^PORT=.*/PORT=$DESIRED/" .env > .env.tmp && mv .env.tmp .env
ok "Application port set to $DESIRED."

hd "Installing dependencies"
npm install --no-audit --no-fund
ok "Dependencies installed."

hd "Initialising & seeding database"
npm run init-db
npm run seed
ok "Database ready."

hd "Setup complete"
PORT="$(grep -E '^PORT=' .env | cut -d= -f2)"; PORT="${PORT:-3000}"
echo "  Open:  http://localhost:${PORT}"
echo "  The default logins are printed just above (admin / nurse / employee / newhire)."
echo
echo "  Start the app any time with:   cd backend && npm start"

if [ "$START" -eq 1 ]; then
  hd "Starting server"; exec npm start
else
  read -rp "Start the app now? (Y/n): " a; a="${a:-y}"
  [[ "$a" =~ ^[Yy] ]] && { hd "Starting server"; exec npm start; } || ok "Done. Start later with: cd backend && npm start"
fi
