#!/bin/sh
# Start a 1920x1080 X server, then run the given command against it.
# xvfb-run is not used: as PID 1 it waits forever for Xvfb's ready signal.
set -e
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp >/dev/null 2>&1 &
i=0
while [ ! -e /tmp/.X11-unix/X99 ]; do
  i=$((i + 1))
  if [ "$i" -gt 100 ]; then echo "Xvfb did not start" >&2; exit 1; fi
  sleep 0.1
done
export DISPLAY=:99
exec "$@"
