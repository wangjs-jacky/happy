#!/bin/sh
set -eu
export DISPLAY=:99 HOME=/profile
# The controller exclusively owns this volume and creates only one browser
# container. A removed container leaves Chromium's hostname/PID lock symlinks;
# these process locks are not cookies or profile data and cannot be reused.
rm -f /profile/chromium/SingletonLock /profile/chromium/SingletonCookie /profile/chromium/SingletonSocket
mkfifo /tmp/paws-display-ready
Xvfb :99 -displayfd 3 -screen 0 1280x800x24 -nolisten tcp 3>/tmp/paws-display-ready &
read -r display_number < /tmp/paws-display-ready
rm /tmp/paws-display-ready
export DISPLAY=:$display_number
# DevTools stays on this container's loopback. A trusted host-side stdio tunnel
# carries display/input without publishing a Docker network port.
exec chromium --no-sandbox --disable-dev-shm-usage --disable-gpu \
  --no-first-run --no-default-browser-check --disable-background-networking \
  --disable-component-update --disable-sync --disable-extensions \
  --disable-features=MediaRouter --disable-quic \
  --remote-debugging-port=9222 --remote-allow-origins=http://127.0.0.1 \
  --user-data-dir=/profile/chromium --window-size=1280,800 \
  --proxy-server=http://paws-egress:3128 '--proxy-bypass-list=<-loopback>' \
  about:blank
