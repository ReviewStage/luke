#!/bin/sh
# install.sh -- installs Luke's host daemon on a Linux box (x64 or arm64), enrolls it with an install token, and upgrades it in place when run again without one.
#
# Served by the web app at /install.sh with the release written in
# (apps/web/scripts/install-script.ts), and run as root:
#
#   curl -fsSL https://tryluke.dev/install.sh | sudo sh -s -- --token <token>
#
# It downloads the release's tarball for the box's architecture and checks it
# against the SHA-256 this script carries before anything of it is installed;
# installs it to /opt/luke-host, owned by root; makes the luke-host user the
# daemon and every agent run as, in the kvm group where /dev/kvm exists, with
# lingering on so its own systemd runs from boot; enrolls the box under its
# hostname, which writes the box's device secret readable by luke-host alone;
# and installs and starts luke-host.service as that user, restarted only
# when it crashes. Run again without --token, it upgrades in place and keeps
# the box's enrollment. `sudo luke-host uninstall` removes it.
set -eu

VERSION="@@VERSION@@"
SHA256_X64="@@SHA256_X64@@"
SHA256_ARM64="@@SHA256_ARM64@@"
URL_X64="@@URL_X64@@"
URL_ARM64="@@URL_ARM64@@"

ORIGIN="https://tryluke.dev"
HOST_USER="luke-host"
HOST_HOME="/var/lib/luke-host"
INSTALL_DIR="/opt/luke-host"
UNIT="luke-host.service"
UNIT_FILE="/etc/systemd/system/$UNIT"
LINK="/usr/local/bin/luke-host"
# How long the script waits for the service's first word with Luke: its first
# start fetches the pinned Claude Code before it registers.
CONNECT_WAIT_SECONDS=300

if [ -t 1 ]; then
  CHECK="$(printf '\033[32m✓\033[0m')"
  CROSS="$(printf '\033[31m✗\033[0m')"
else
  CHECK="✓"
  CROSS="✗"
fi

ok() { printf '%s %s\n' "$CHECK" "$*"; }
fail() {
  printf '%s %s\n' "$CROSS" "$*" >&2
  exit 1
}

token=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --token)
      [ "$#" -ge 2 ] || fail "--token needs a value"
      token="$2"
      shift 2
      ;;
    --token=*)
      token="${1#--token=}"
      shift
      ;;
    --origin)
      [ "$#" -ge 2 ] || fail "--origin needs a value"
      ORIGIN="$2"
      shift 2
      ;;
    --origin=*)
      ORIGIN="${1#--origin=}"
      shift
      ;;
    *) fail "Unknown option: $1" ;;
  esac
done

[ -n "$VERSION" ] || fail "Luke host has no release yet."
[ "$(id -u)" -eq 0 ] || fail "Run it as root: curl -fsSL $ORIGIN/install.sh | sudo sh -s -- --token <token>"
[ "$(uname -s)" = "Linux" ] || fail "Luke host runs on Linux."
command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ] || fail "Luke host needs systemd."
command -v sha256sum >/dev/null 2>&1 || fail "Luke host needs sha256sum (coreutils)."
command -v git >/dev/null 2>&1 || fail "Luke host needs git, which its agents make their worktrees with."

case "$(uname -m)" in
  x86_64 | amd64)
    arch="x64"
    sha256="$SHA256_X64"
    url="$URL_X64"
    ;;
  aarch64 | arm64)
    arch="arm64"
    sha256="$SHA256_ARM64"
    url="$URL_ARM64"
    ;;
  *) fail "Luke host runs on x64 and arm64, not $(uname -m)." ;;
esac

if [ -z "$token" ] && [ ! -f "$HOST_HOME/state/device.json" ]; then
  fail "This box is not enrolled yet. Run the command from Settings › Agents › Hosts › Add hosts, with its --token."
fi

printf 'Luke host %s for linux-%s\n' "$VERSION" "$arch"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
tarball="luke-host-$VERSION-linux-$arch.tar.gz"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL --proto '=https' --tlsv1.2 -o "$work/$tarball" "$url" || fail "Could not download $url"
elif command -v wget >/dev/null 2>&1; then
  wget -q -O "$work/$tarball" "$url" || fail "Could not download $url"
else
  fail "Luke host needs curl or wget to download its release."
fi
actual="$(sha256sum "$work/$tarball" | cut -d ' ' -f 1)"
[ "$actual" = "$sha256" ] || fail "The download's checksum is $actual, not $sha256. Nothing was installed."
ok "Downloaded and checked $tarball (sha256 matches)"

mkdir "$work/unpacked"
tar -xzf "$work/$tarball" -C "$work/unpacked" || fail "Could not unpack $tarball"
[ -x "$work/unpacked/luke-host/bin/luke-host" ] || fail "$tarball holds no luke-host."
# Note that a running daemon is stopped before its files are swapped, which
# stops every agent it runs; their turns in flight end, and each agent picks up
# on its next message.
if systemctl is-active --quiet "$UNIT"; then
  systemctl stop "$UNIT"
fi
rm -rf "$INSTALL_DIR.new" "$INSTALL_DIR.old"
mv "$work/unpacked/luke-host" "$INSTALL_DIR.new"
chown -R root:root "$INSTALL_DIR.new"
chmod -R go-w "$INSTALL_DIR.new"
if [ -d "$INSTALL_DIR" ]; then
  mv "$INSTALL_DIR" "$INSTALL_DIR.old"
fi
mv "$INSTALL_DIR.new" "$INSTALL_DIR"
rm -rf "$INSTALL_DIR.old"
mkdir -p "$(dirname "$LINK")"
ln -sf "$INSTALL_DIR/bin/luke-host" "$LINK"
ok "Installed to $INSTALL_DIR"

if id "$HOST_USER" >/dev/null 2>&1; then
  made="Kept user $HOST_USER"
else
  useradd --system --create-home --home-dir "$HOST_HOME" --shell /bin/bash \
    --comment "Luke host" "$HOST_USER" || fail "Could not make the $HOST_USER user."
  made="Made user $HOST_USER"
fi
chmod 700 "$HOST_HOME"
if [ -e /dev/kvm ] && getent group kvm >/dev/null 2>&1; then
  usermod -aG kvm "$HOST_USER"
  made="$made (in group kvm: /dev/kvm found)"
fi
loginctl enable-linger "$HOST_USER" || fail "Could not turn on lingering for $HOST_USER."
uid="$(id -u "$HOST_USER")"
# The user's own systemd, which every agent's unit runs under, starts with lingering on.
waited=0
while [ ! -S "/run/user/$uid/bus" ] && [ "$waited" -lt 30 ]; do
  sleep 1
  waited=$((waited + 1))
done
[ -S "/run/user/$uid/bus" ] || fail "The $HOST_USER user's systemd did not start (no /run/user/$uid/bus)."
ok "$made"

name="$(hostname -s 2>/dev/null || hostname)"
if [ -n "$token" ]; then
  # Note that the token goes in on stdin, never an argument another user could read.
  enrolled="$(printf '%s\n' "$token" | runuser -u "$HOST_USER" -- env HOME="$HOST_HOME" \
    "$INSTALL_DIR/bin/luke-host" enroll --name "$name" --origin "$ORIGIN")" || exit 1
  ok "$enrolled"
else
  ok "Kept this box's enrollment"
fi

cat >"$UNIT_FILE" <<UNIT_EOF
[Unit]
Description=Luke host
Documentation=https://tryluke.dev
Wants=network-online.target
After=network-online.target user@$uid.service

[Service]
Type=simple
User=$HOST_USER
Group=$HOST_USER
WorkingDirectory=$HOST_HOME
Environment=XDG_RUNTIME_DIR=/run/user/$uid
ExecStart=$INSTALL_DIR/bin/luke-host run
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT_EOF
since="$(date '+%Y-%m-%d %H:%M:%S')"
systemctl daemon-reload
systemctl enable "$UNIT" >/dev/null 2>&1
systemctl restart "$UNIT"
ok "Started $UNIT (starts on boot)"

waited=0
connected=false
while [ "$waited" -lt "$CONNECT_WAIT_SECONDS" ]; do
  if journalctl -u "$UNIT" --since "$since" -o cat 2>/dev/null | grep -q "Connected to Luke"; then
    connected=true
    break
  fi
  sleep 2
  waited=$((waited + 2))
done
if [ "$connected" = true ]; then
  ok "Connected to Luke"
else
  printf '! Not connected to Luke yet. Follow it with: journalctl -u %s -f\n' "$UNIT"
fi

printf '\n%s is ready. Pick it under a task'"'"'s Runs on.\n' "$name"
printf 'To upgrade later, run the same command without --token.\n'
printf 'To remove it: sudo luke-host uninstall\n'
