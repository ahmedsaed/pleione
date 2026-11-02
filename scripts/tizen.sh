#!/bin/bash
# Build, package, install, and debug the Samsung Tizen build through a pinned
# Tizen CLI container, so nothing from Tizen Studio is installed on the host.
# See docs/tizen.md.
#
#   scripts/tizen.sh up                  # start the CLI container
#   scripts/tizen.sh connect             # sdb connect to $TIZEN_TV
#   scripts/tizen.sh package             # lint + build --platform=tizen + .wgt
#   scripts/tizen.sh install             # package, install, and cold-start
#   scripts/tizen.sh restart             # cold-start the installed app
#   scripts/tizen.sh debug [local-port]  # cold-start in debug mode; DevTools on localhost
#   scripts/tizen.sh down                # stop and remove the container
#
# TIZEN_TV        the TV's IP address (required for connect/install/restart/debug)
# TIZEN_PROFILE   the signing profile in the container (default: dev, the
#                 image's sample certificate, enough for Tizen 5.5 Developer Mode)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

IMAGE='vitalets/tizen-webos-sdk@sha256:5107c8a83fae3128d3b9aa2b499a221f1e0188ebb0fa3ad5be01e9ba2eaf33dc'
CONTAINER='pleione-tizen'
PROFILE="${TIZEN_PROFILE:-dev}"
APP_ID="$(node -e "import('./scripts/tizen-config.mjs').then(m => console.log(m.TIZEN_APP_ID))")"
WGT='Pleione.wgt'

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

command -v docker >/dev/null 2>&1 || error "Docker is required."

in_container() { docker exec "$CONTAINER" bash -lc "$1"; }

tv() {
  [ -n "$TIZEN_TV" ] || error "Set TIZEN_TV to the TV's IP address."
  echo "$TIZEN_TV"
}

up() {
  if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then return; fi
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  info "Starting the Tizen CLI container..."
  # Host networking: the TV's Developer Mode accepts only the host's IP, and
  # sdb's daemon must outlive single commands.
  docker run -d --name "$CONTAINER" --network host -v pleione-tizen-home:/home/developer \
    "$IMAGE" sleep infinity >/dev/null
}

connect() {
  up
  local ip; ip="$(tv)"
  in_container "sdb connect $ip" | tail -1
}

package() {
  up
  info "Linting (Chromium 53 compat gate)..."
  npm run lint
  info "Building for Tizen..."
  npx tsc --noEmit
  node esbuild.config.mjs --platform=tizen
  info "Packaging $WGT with profile '$PROFILE'..."
  in_container "rm -rf /tmp/pleione /home/developer/out && mkdir -p /home/developer/out"
  docker cp dist-tizen "$CONTAINER:/tmp/pleione"
  in_container "tizen package -t wgt -s $PROFILE -o /home/developer/out -- /tmp/pleione" | tail -1
  docker cp "$CONTAINER:/home/developer/out/$WGT" "$ROOT/$WGT"
  info "Wrote $WGT"
}

restart() {
  local ip; ip="$(tv)"
  # A plain launch only brings an open app to the front; kill it first.
  in_container "sdb connect $ip >/dev/null; sdb -s $ip:26101 shell 0 was_kill $APP_ID >/dev/null 2>&1 || true; tizen run -s $ip:26101 -p $APP_ID" | tail -1
}

install() {
  local ip; ip="$(tv)"
  package
  connect
  info "Installing on $ip..."
  in_container "tizen install -s $ip:26101 -n $WGT -- /home/developer/out" | tail -1
  restart
}

debug() {
  local ip; ip="$(tv)"
  local local_port="${1:-9333}"
  connect >/dev/null
  in_container "sdb -s $ip:26101 shell 0 was_kill $APP_ID >/dev/null 2>&1 || true"
  local port
  port="$(in_container "timeout 30 sdb -s $ip:26101 shell 0 debug $APP_ID" | grep -o 'port: [0-9]*' | grep -o '[0-9]*')"
  [ -n "$port" ] || error "The TV did not report a debug port."
  # sdb drops the device after a debug launch; reconnect before forwarding.
  in_container "sdb connect $ip >/dev/null; sdb -s $ip:26101 forward --remove-all; sdb -s $ip:26101 forward tcp:$local_port tcp:$port"
  info "DevTools: http://127.0.0.1:$local_port/json"
}

down() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}

case "${1:-}" in
  up) up ;;
  connect) connect ;;
  package) package ;;
  install) install ;;
  restart) restart ;;
  debug) debug "$2" ;;
  down) down ;;
  *) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
