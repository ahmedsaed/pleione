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
#   scripts/tizen.sh uninstall           # remove Pleione from the TV
#   scripts/tizen.sh probe [key-seconds] # run the device checks (needs npm run xtream:demo)
#   scripts/tizen.sh profile <name>      # register $TIZEN_CERTS/author.p12 (+ distributor.p12)
#   scripts/tizen.sh duid                # the TV's DUID, for a Samsung distributor certificate
#   scripts/tizen.sh down                # stop and remove the container
#
# TIZEN_TV        the TV's IP address (required for everything that talks to it)
# TIZEN_PROFILE   the signing profile in the container (default: dev, the
#                 image's sample certificate, enough for Tizen 5.5 Developer Mode)
# TIZEN_CERTS     a folder with author.p12 and, optionally, a Samsung
#                 distributor.p12, mounted read-only into the container at /certs
# TIZEN_AUTHOR_PASSWORD, TIZEN_DISTRIBUTOR_PASSWORD   their passwords, for
#                 profile, which asks for them when they are unset
# TIZEN_HOST      this computer's LAN address for probe (default: the route to the TV)
# TIZEN_STORE     set (to 1) to package the store build, without the LAN web service
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

IMAGE='vitalets/tizen-webos-sdk@sha256:5107c8a83fae3128d3b9aa2b499a221f1e0188ebb0fa3ad5be01e9ba2eaf33dc'
CONTAINER='pleione-tizen'
PROFILE="${TIZEN_PROFILE:-dev}"
APP_ID="$(node -e "import('./scripts/tizen-config.mjs').then(m => console.log(m.TIZEN_APP_ID))")"
PROBE_ID='meropeProb.Probe'
WGT='Pleione.wgt'

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $1" >&2; }
error() { echo -e "${RED}[ERROR]${NC} $1" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || error "Docker is required."

in_container() { docker exec "$CONTAINER" bash -lc "$1"; }

tv() {
  [ -n "$TIZEN_TV" ] || error "Set TIZEN_TV to the TV's IP address."
  echo "$TIZEN_TV"
}

up() {
  local mounted=''
  if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    mounted="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/certs"}}{{.Source}}{{end}}{{end}}' "$CONTAINER")"
    # A certificate folder the running container lacks needs a new one.
    if [ -z "$TIZEN_CERTS" ] || [ "$mounted" = "$(cd "$TIZEN_CERTS" && pwd)" ]; then return; fi
  fi
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  info "Starting the Tizen CLI container..."
  local certs=()
  if [ -n "$TIZEN_CERTS" ]; then
    [ -d "$TIZEN_CERTS" ] || error "TIZEN_CERTS is not a folder: $TIZEN_CERTS"
    certs=(-v "$(cd "$TIZEN_CERTS" && pwd):/certs:ro")
  fi
  # Host networking: the TV's Developer Mode accepts only the host's IP, and
  # sdb's daemon must outlive single commands.
  docker run -d --name "$CONTAINER" --network host -v pleione-tizen-home:/home/developer \
    "${certs[@]}" "$IMAGE" sleep infinity >/dev/null
}

# sdb drops the TV now and then, after an install or a debug launch above
# all; reconnect until the device lists again.
connect() {
  up
  local ip; ip="$(tv)"
  for _ in 1 2 3 4 5; do
    if in_container "sdb connect $ip >/dev/null 2>&1; sdb devices" | grep -q "^$ip:26101"; then
      info "Connected to $ip"
      return
    fi
    sleep 2
  done
  error "sdb cannot reach $ip; check the TV's Developer Mode and its Host PC IP."
}

# Package a folder into /home/developer/out/<name>.wgt in the container.
package_dir() {
  local dir="$1" name="$2"
  in_container "rm -rf /tmp/wgt-src /home/developer/out && mkdir -p /home/developer/out"
  docker cp "$dir" "$CONTAINER:/tmp/wgt-src"
  local log
  log="$(in_container "tizen package -t wgt -s $PROFILE -o /home/developer/out -- /tmp/wgt-src" 2>&1)" \
    || error "Packaging failed:\n$log"
  in_container "cd /home/developer/out && f=\$(ls *.wgt | head -1) && [ \"\$f\" = '$name' ] || mv \"\$f\" '$name'"
}

package() {
  up
  info "Linting (Chromium 53 compat gate)..."
  npm run lint
  info "Building for Tizen..."
  npx tsc --noEmit
  if [ -n "$TIZEN_STORE" ]; then
    node esbuild.config.mjs --platform=tizen --store
  else
    node esbuild.config.mjs --platform=tizen
  fi
  info "Packaging $WGT with profile '$PROFILE'..."
  package_dir "$([ -n "$TIZEN_STORE" ] && echo dist-tizen-store || echo dist-tizen)" "$WGT"
  docker cp "$CONTAINER:/home/developer/out/$WGT" "$ROOT/$WGT"
  info "Wrote $WGT"
}

install_wgt() {
  local ip="$1" name="$2" log
  log="$(in_container "tizen install -s $ip:26101 -n $name -- /home/developer/out" 2>&1)"
  # A plain Tizen certificate is refused from Tizen 7 on: say what to do.
  if ! echo "$log" | grep -q 'successfully installed'; then
    if echo "$log" | grep -qi 'signature\|certificate\|-12\b'; then
      error "The TV refused the signature. It needs a Samsung certificate: see docs/tizen.md, 'Certificates'.\n$log"
    fi
    error "Install failed:\n$log"
  fi
}

restart_app() {
  local ip="$1" app="$2"
  connect >/dev/null
  # A plain launch only brings an open app to the front; kill it first.
  in_container "sdb -s $ip:26101 shell 0 was_kill $app >/dev/null 2>&1 || true; tizen run -s $ip:26101 -p $app" | tail -1
}

install() {
  local ip; ip="$(tv)"
  package
  connect
  info "Installing on $ip..."
  install_wgt "$ip" "$WGT"
  restart_app "$ip" "$APP_ID"
}

# Cold-start an app in debug mode and forward its DevTools to localhost.
debug_app() {
  local app="$1" local_port="${2:-9333}"
  local ip; ip="$(tv)"
  connect >/dev/null
  in_container "sdb -s $ip:26101 shell 0 was_kill $app >/dev/null 2>&1 || true"
  local port=''
  for _ in 1 2 3; do
    port="$(in_container "timeout 30 sdb -s $ip:26101 shell 0 debug $app" 2>/dev/null \
      | grep -o 'port: [0-9]*' | grep -o '[0-9]*' || true)"
    [ -n "$port" ] && break
    connect >/dev/null
  done
  [ -n "$port" ] || error "The TV did not report a debug port."
  DEBUG_PORT="$port"
  for _ in 1 2 3; do
    connect >/dev/null
    in_container "sdb -s $ip:26101 forward --remove-all; sdb -s $ip:26101 forward tcp:$local_port tcp:$port" \
      >/dev/null 2>&1 || true
    if in_container "sdb forward --list" | grep -q "tcp:$local_port"; then
      info "DevTools: http://127.0.0.1:$local_port/json"
      return
    fi
  done
  error "Could not forward the DevTools port."
}

uninstall() {
  local ip; ip="$(tv)"
  connect >/dev/null
  # `tizen uninstall` fails on retail TVs; the TV's own command works.
  in_container "sdb -s $ip:26101 shell 0 vd_appuninstall $APP_ID" | head -1
}

probe() {
  local ip; ip="$(tv)"
  local key_seconds="${1:-0}"
  local host="$TIZEN_HOST"
  if [ -z "$host" ]; then
    host="$(ip route get "$ip" 2>/dev/null | grep -o 'src [0-9.]*' | cut -d' ' -f2 || true)"
  fi
  [ -n "$host" ] || error "Set TIZEN_HOST to this computer's LAN address."
  curl -fs -o /dev/null "http://$host:8090/player_api.php" \
    || info "No demo server on $host:8090; the media checks will time out. Run: npm run xtream:demo"
  up
  local tmp; tmp="$(mktemp -d)"
  cp -r scripts/tizen-probe/. "$tmp/"
  rm -f "$tmp/collect.mjs"
  sed -i "s/__PROBE_HOST__/$host/" "$tmp/index.html"
  info "Packaging the probe for media on $host..."
  package_dir "$tmp" Probe.wgt
  rm -rf "$tmp"
  connect >/dev/null
  install_wgt "$ip" Probe.wgt
  debug_app "$PROBE_ID" 9339
  local out; out="tizen-probe-$(date +%Y%m%d-%H%M%S).json"
  info "Running the checks (about a minute)..."
  node scripts/tizen-probe/collect.mjs "9339,$ip:$DEBUG_PORT" "$out" "$key_seconds"
  info "Wrote $out"
}

profile() {
  local name="${1:?usage: scripts/tizen.sh profile <name>}"
  [ -n "$TIZEN_CERTS" ] || error "Set TIZEN_CERTS to the folder with author.p12 (and distributor.p12)."
  [ -f "$TIZEN_CERTS/author.p12" ] || error "No author.p12 in $TIZEN_CERTS."
  if [ -z "$TIZEN_AUTHOR_PASSWORD" ]; then
    read -rsp "author.p12 password: " TIZEN_AUTHOR_PASSWORD; echo >&2
  fi
  if [ -f "$TIZEN_CERTS/distributor.p12" ] && [ -z "$TIZEN_DISTRIBUTOR_PASSWORD" ]; then
    read -rsp "distributor.p12 password (Enter if the same): " TIZEN_DISTRIBUTOR_PASSWORD; echo >&2
    TIZEN_DISTRIBUTOR_PASSWORD="${TIZEN_DISTRIBUTOR_PASSWORD:-$TIZEN_AUTHOR_PASSWORD}"
  fi
  [ -n "$TIZEN_AUTHOR_PASSWORD" ] || error "No author.p12 password."
  export TIZEN_AUTHOR_PASSWORD TIZEN_DISTRIBUTOR_PASSWORD
  [[ "$name" =~ ^[A-Za-z0-9_-]+$ ]] || error "A profile name takes letters, digits, - and _."
  up
  # `tizen security-profiles add` cannot store passwords without a desktop
  # keyring. The image's sample profile keeps its two passwords (developer,
  # and the public distributor's) encrypted inline, so the new profile reuses
  # those entries, with the certificates re-exported under those passwords.
  docker exec -e TIZEN_AUTHOR_PASSWORD -e TIZEN_DISTRIBUTOR_PASSWORD -e NAME="$name" "$CONTAINER" bash -lc '
    set -e
    dir="$HOME/profiles/$NAME"
    mkdir -p "$dir"
    openssl pkcs12 -in /certs/author.p12 -passin env:TIZEN_AUTHOR_PASSWORD -nodes -out /tmp/a.pem
    openssl pkcs12 -export -in /tmp/a.pem -out "$dir/author.p12" -passout pass:developer
    xml="$HOME/tizen-studio-data/profile/profiles.xml"
    item() { sed -n "/<profile name=\"dev\">/,/<\/profile>/p" "$xml" | grep "distributor=\"$1\"" | sed "s/.*$2=\"\([^\"]*\)\".*/\1/"; }
    a=$(item 0 password); d=$(item 1 password)
    # Without a Samsung distributor, the public one the sample profile uses:
    # enough for Tizen 5.5-6.5 in Developer Mode.
    dkey=$(item 1 key)
    if [ -f /certs/distributor.p12 ]; then
      openssl pkcs12 -in /certs/distributor.p12 -passin env:TIZEN_DISTRIBUTOR_PASSWORD -nodes -out /tmp/d.pem
      openssl pkcs12 -export -in /tmp/d.pem -out "$dir/distributor.p12" -passout pass:tizenpkcs12passfordsigner
      dkey="$dir/distributor.p12"
    fi
    rm -f /tmp/a.pem /tmp/d.pem
    sed -i "/<profile name=\"$NAME\">/,/<\/profile>/d" "$xml"
    sed -i "s#</profiles>#<profile name=\"$NAME\">\n<profileitem ca=\"\" distributor=\"0\" key=\"$dir/author.p12\" password=\"$a\" rootca=\"\"/>\n<profileitem ca=\"\" distributor=\"1\" key=\"$dkey\" password=\"$d\" rootca=\"\"/>\n<profileitem ca=\"\" distributor=\"2\" key=\"\" password=\"\" rootca=\"\"/>\n</profile>\n</profiles>#" "$xml"
    tizen security-profiles list | grep -w "$NAME"'
  info "Use it with: TIZEN_PROFILE=$name scripts/tizen.sh install"
}

duid() {
  local ip; ip="$(tv)"
  connect >/dev/null
  in_container "sdb -s $ip:26101 shell 0 getduid" | tr -d '\r' | head -1
}

down() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}

case "${1:-}" in
  up) up ;;
  connect) connect ;;
  package) package ;;
  install) install ;;
  restart) restart_app "$(tv)" "$APP_ID" ;;
  debug) debug_app "$APP_ID" "$2" ;;
  uninstall) uninstall ;;
  probe) probe "$2" ;;
  profile) profile "$2" ;;
  duid) duid ;;
  down) down ;;
  *) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
