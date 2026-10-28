#!/bin/sh
# luke-host -- the host's one command: `uninstall` removes Luke's host from the box, as root, with the smolvm the install script put beside it and, with the luke-host user's home, smolvm's state and every machine left behind; every other command is the daemon's own (lib/luke-host.mjs), run on the Node the release carries.
#
# Shipped as bin/luke-host in the release (scripts/package.ts) and linked
# from /usr/local/bin by the install script.
set -eu

root="$(dirname "$(dirname "$(readlink -f "$0")")")"
HOST_USER="luke-host"
UNIT="luke-host.service"
SMOLVM_DIR="/opt/luke-smolvm"

uninstall() {
  if [ "$(id -u)" -ne 0 ]; then
    printf 'Run it as root: sudo luke-host uninstall\n' >&2
    exit 1
  fi
  systemctl disable --now "$UNIT" >/dev/null 2>&1 || true
  if id "$HOST_USER" >/dev/null 2>&1; then
    uid="$(id -u "$HOST_USER")"
    # Note that lingering is turned off where an earlier build turned it on, since systemd keeps its record past the user.
    loginctl disable-linger "$HOST_USER" >/dev/null 2>&1 || true
    loginctl terminate-user "$HOST_USER" >/dev/null 2>&1 || true
    # Every process of the user's is waited out, and killed after ten seconds, before the user goes.
    waited=0
    while pgrep -u "$uid" >/dev/null 2>&1 && [ "$waited" -lt 10 ]; do
      sleep 1
      waited=$((waited + 1))
    done
    pkill -KILL -u "$uid" >/dev/null 2>&1 || true
    home="$(getent passwd "$HOST_USER" | cut -d: -f6)"
    # Note that the home, which holds the box's secret, is removed only once the user is gone.
    if ! userdel "$HOST_USER"; then
      printf 'Could not remove the %s user, so its home %s is left in place. Stop its processes and run this again.\n' "$HOST_USER" "$home" >&2
      exit 1
    fi
    if [ "$home" = "/var/lib/luke-host" ]; then
      rm -rf "$home"
    fi
  fi
  rm -f "/etc/systemd/system/$UNIT"
  systemctl daemon-reload >/dev/null 2>&1 || true
  if [ "$(readlink -f /usr/local/bin/luke-host 2>/dev/null)" = "$root/bin/luke-host" ]; then
    rm -f /usr/local/bin/luke-host
  fi
  if [ "$root" = "/opt/luke-host" ]; then
    rm -rf "$root"
  fi
  # Note that smolvm is the install script's own, beside the release rather than in it; its state and any machines left behind are under the luke-host user's home and processes, which went with the user above.
  rm -rf "$SMOLVM_DIR"
  printf 'Luke host is removed from this box. Remove it in Settings › Hosts too, if it is still listed.\n'
}

if [ "${1:-}" = "uninstall" ]; then
  uninstall
  exit 0
fi
exec "$root/node/bin/node" "$root/lib/luke-host.mjs" "$@"
