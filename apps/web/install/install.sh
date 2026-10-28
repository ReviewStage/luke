#!/bin/sh
# install.sh -- installs Luke's host daemon on a Linux box (x64 or arm64), enrolls it with an install token, and upgrades it in place when run again without one.
#
# Served by the web app at /install.sh with the release written in
# (apps/web/scripts/install-script.ts), and run as root:
#
#   curl -fsSL https://tryluke.dev/install.sh | sudo sh -s -- --token <token>
#
# Every agent runs in a smolvm VM of its own, with no mode that runs one
# without, so it refuses a box with no usable /dev/kvm before it changes
# anything. It then downloads the release's tarball for the box's architecture
# and the pinned smolvm's, and checks each against the SHA-256 this script
# carries before anything of either is installed; installs the daemon to
# /opt/luke-host and smolvm to /opt/luke-smolvm, both owned by root, smolvm only
# where the box's is not the pinned release already; makes the luke-host user
# the daemon and every agent's VM run as, in the kvm group; enrolls the box under
# its hostname, which writes the box's device secret readable by luke-host
# alone; installs and starts luke-host.service as that user, restarted only
# when it crashes, and told by its environment which smolvm to run; and, last,
# fetches Luke's sandbox image as luke-host, so the first agent does not wait
# for its 1.3 GB. smolvm's own state lives under luke-host's home. Run again
# without --token, it upgrades in place and keeps the box's enrollment.
# `sudo luke-host uninstall` removes it.
#
# smolvm's own install script is never run: its release is fetched and checked
# here, as the daemon's is.
set -eu

VERSION="@@VERSION@@"
SHA256_X64="@@SHA256_X64@@"
SHA256_ARM64="@@SHA256_ARM64@@"
URL_X64="@@URL_X64@@"
URL_ARM64="@@URL_ARM64@@"

# The smolvm release Luke runs agents in, and Luke's sandbox image its VMs boot,
# held to the daemon's pins (SMOLVM_LINUX_PIN, SANDBOX_IMAGE in
# packages/agent-runner/src/pins.ts) by a test.
SMOLVM_VERSION="1.32.3"
SMOLVM_SHA256_X64="82b50f55b35828efbf02ec84c22274780be109c7f424a24646390abc44506afe"
SMOLVM_SHA256_ARM64="baea200aea86c405e31afd3a6f278b3bcf6370ea252d35e66b90ba3e849b9721"
SMOLVM_URL_X64="https://github.com/smol-machines/smolvm/releases/download/v1.32.3/smolvm-1.32.3-linux-x86_64.tar.gz"
SMOLVM_URL_ARM64="https://github.com/smol-machines/smolvm/releases/download/v1.32.3/smolvm-1.32.3-linux-arm64.tar.gz"
SANDBOX_IMAGE="ghcr.io/reviewstage/luke-sandbox:ea78580d96ce7256@sha256:f6ff07bdc663c9173a856a713e4caa02a725eedd3da4aed0029c662e3b0b33a5"

ORIGIN="https://tryluke.dev"
HOST_USER="luke-host"
HOST_HOME="/var/lib/luke-host"
INSTALL_DIR="/opt/luke-host"
UNIT="luke-host.service"
UNIT_FILE="/etc/systemd/system/$UNIT"
LINK="/usr/local/bin/luke-host"
# Where smolvm is installed, apart from the daemon's folder, which every run
# swaps whole, and the one path the daemon's service is told to run it from.
SMOLVM_DIR="/opt/luke-smolvm"
SMOLVM="$SMOLVM_DIR/smolvm"
# The device every VM needs; a test points it at a path that is not there.
KVM_DEVICE="${LUKE_HOST_KVM_DEVICE:-/dev/kvm}"
# The daemon exits with this (EX_CONFIG) where its smolvm is not the pinned
# release, and the unit leaves it stopped rather than start it over.
EXIT_REFUSED=78
# How long the script waits for the service's first word with Luke: its first
# start fetches the pinned Claude Code before it registers.
CONNECT_WAIT_SECONDS=300
# How long fetching the sandbox image may take before the script goes on without it.
IMAGE_WAIT_SECONDS=1800

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

# Refuses a box whose KVM device is missing or cannot be opened, as the script's
# first word on it, before it changes anything.
require_kvm() {
  if [ ! -e "$KVM_DEVICE" ]; then
    found="$KVM_DEVICE is missing"
  elif ! (exec 3<>"$KVM_DEVICE") 2>/dev/null; then
    found="$KVM_DEVICE exists but cannot be opened"
  else
    return 0
  fi
  {
    printf '%s %s, and Luke host needs it.\n' "$CROSS" "$found"
    printf '  Every agent runs in a VM of its own, which needs hardware virtualization (KVM).\n'
    printf '  There is no bare mode that runs agents on the box itself, so nothing was installed.\n'
    printf '  Check with: ls -l /dev/kvm   (it should be a character device, group kvm)\n'
    printf '  On a cloud VM, turn on nested virtualization or pick a bare-metal instance;\n'
    printf '  on a box of your own, turn on VT-x or AMD-V in its BIOS or UEFI settings.\n'
  } >&2
  exit 1
}

# Fails unless the file's SHA-256 is the one given: $1 the file, $2 its digest.
check_sha256() {
  actual="$(sha256sum "$1" | cut -d ' ' -f 1)"
  [ "$actual" = "$2" ] || fail "The download's checksum is $actual, not $2. Nothing was installed."
}

# Downloads $1 to $2, over https, with curl or wget.
download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --proto '=https' --tlsv1.2 -o "$2" "$1" || fail "Could not download $1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1" || fail "Could not download $1"
  else
    fail "Luke host needs curl or wget to download its release."
  fi
}

# Writes the service's unit, and has systemd read it.
write_unit() {
cat >"$UNIT_FILE" <<UNIT_EOF
[Unit]
Description=Luke host
Documentation=https://tryluke.dev
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=$HOST_USER
Group=$HOST_USER
WorkingDirectory=$HOST_HOME
# Note that the daemon is told which smolvm to run by its whole path, never the one PATH finds.
Environment=LUKE_HOST_SMOLVM=$SMOLVM
ExecStart=$INSTALL_DIR/bin/luke-host run
Restart=on-failure
RestartPreventExitStatus=$EXIT_REFUSED
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT_EOF
  systemctl daemon-reload
}

# A test sources the script up to here, to call its functions and read what it carries.
[ -z "${LUKE_HOST_INSTALL_LIBRARY:-}" ] || return 0

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
case "$ORIGIN" in
  https://*) ;;
  *) fail "--origin must be an https:// address, not $ORIGIN" ;;
esac
require_kvm
[ "$(id -u)" -eq 0 ] || fail "Run it as root: curl -fsSL $ORIGIN/install.sh | sudo sh -s -- --token <token>"
[ "$(uname -s)" = "Linux" ] || fail "Luke host runs on Linux."
command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ] || fail "Luke host needs systemd."
command -v sha256sum >/dev/null 2>&1 || fail "Luke host needs sha256sum (coreutils)."
command -v git >/dev/null 2>&1 || fail "Luke host needs git, which its agents make their worktrees with."
command -v bash >/dev/null 2>&1 || fail "Luke host needs bash, which smolvm's launcher script runs on."

case "$(uname -m)" in
  x86_64 | amd64)
    arch="x64"
    sha256="$SHA256_X64"
    url="$URL_X64"
    smolvm_sha256="$SMOLVM_SHA256_X64"
    smolvm_url="$SMOLVM_URL_X64"
    ;;
  aarch64 | arm64)
    arch="arm64"
    sha256="$SHA256_ARM64"
    url="$URL_ARM64"
    smolvm_sha256="$SMOLVM_SHA256_ARM64"
    smolvm_url="$SMOLVM_URL_ARM64"
    ;;
  *) fail "Luke host runs on x64 and arm64, not $(uname -m)." ;;
esac

if [ -z "$token" ] && [ ! -f "$HOST_HOME/state/device.json" ]; then
  fail "This box is not enrolled yet. Run the command from Settings › Hosts › Add hosts, with its --token."
fi

printf 'Luke host %s for linux-%s\n' "$VERSION" "$arch"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
tarball="luke-host-$VERSION-linux-$arch.tar.gz"
download "$url" "$work/$tarball"
check_sha256 "$work/$tarball" "$sha256"
ok "Downloaded and checked $tarball (sha256 matches)"

# Note that smolvm is fetched and checked before anything is installed too, but
# only where the box's is not the pinned release already; the check is the one
# the daemon makes as it starts.
smolvm_tarball="${smolvm_url##*/}"
if [ "$("$SMOLVM" --version 2>/dev/null || true)" = "smolvm $SMOLVM_VERSION" ]; then
  smolvm_current=true
else
  smolvm_current=false
  download "$smolvm_url" "$work/$smolvm_tarball"
  check_sha256 "$work/$smolvm_tarball" "$smolvm_sha256"
  ok "Downloaded and checked $smolvm_tarball (sha256 matches)"
fi

mkdir "$work/unpacked"
tar -xzf "$work/$tarball" -C "$work/unpacked" || fail "Could not unpack $tarball"
[ -x "$work/unpacked/luke-host/bin/luke-host" ] || fail "$tarball holds no luke-host."
if id "$HOST_USER" >/dev/null 2>&1; then
  made="Kept user $HOST_USER"
else
  useradd --system --create-home --home-dir "$HOST_HOME" --shell /bin/bash \
    --comment "Luke host" "$HOST_USER" || fail "Could not make the $HOST_USER user."
  made="Made user $HOST_USER"
fi
chmod 700 "$HOST_HOME"
if getent group kvm >/dev/null 2>&1; then
  usermod -aG kvm "$HOST_USER"
  made="$made (in group kvm)"
fi
# Note that the user is made, and its access to the device checked, before the service is stopped or any file swapped, so a box it cannot use is left running as it was.
# Note that the device may be open to every user rather than to the kvm group, so what decides is whether luke-host can open it.
runuser -u "$HOST_USER" -- sh -c 'exec 3<>"$1"' sh "$KVM_DEVICE" 2>/dev/null ||
  fail "$HOST_USER cannot open $KVM_DEVICE (see ls -l $KVM_DEVICE). Give its group to $HOST_USER, and run this again."
ok "$made"

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

if [ "$smolvm_current" = true ]; then
  ok "Kept smolvm $SMOLVM_VERSION at $SMOLVM_DIR"
else
  mkdir "$work/smolvm-unpacked"
  tar -xzf "$work/$smolvm_tarball" -C "$work/smolvm-unpacked" || fail "Could not unpack $smolvm_tarball"
  smolvm_unpacked="$work/smolvm-unpacked/${smolvm_tarball%.tar.gz}"
  [ -x "$smolvm_unpacked/smolvm" ] && [ -x "$smolvm_unpacked/smolvm-bin" ] || fail "$smolvm_tarball holds no smolvm."
  rm -rf "$SMOLVM_DIR.new" "$SMOLVM_DIR.old"
  mv "$smolvm_unpacked" "$SMOLVM_DIR.new"
  chown -R root:root "$SMOLVM_DIR.new"
  # Note that the VMs run as luke-host, which reads smolvm and writes none of it.
  chmod -R go-w,a+rX "$SMOLVM_DIR.new"
  if [ -d "$SMOLVM_DIR" ]; then
    mv "$SMOLVM_DIR" "$SMOLVM_DIR.old"
  fi
  mv "$SMOLVM_DIR.new" "$SMOLVM_DIR"
  rm -rf "$SMOLVM_DIR.old"
  [ "$("$SMOLVM" --version 2>/dev/null || true)" = "smolvm $SMOLVM_VERSION" ] ||
    fail "The smolvm installed to $SMOLVM_DIR does not answer smolvm $SMOLVM_VERSION."
  ok "Installed smolvm $SMOLVM_VERSION to $SMOLVM_DIR"
fi

name="$(hostname -s 2>/dev/null || hostname)"
if [ -n "$token" ]; then
  # Note that the token goes in on stdin, never an argument another user could read.
  # Note that a box enrolled before keeps running on that enrollment where this one is refused.
  if ! enrolled="$(printf '%s\n' "$token" | runuser -u "$HOST_USER" -- env HOME="$HOST_HOME" \
    "$INSTALL_DIR/bin/luke-host" enroll --name "$name" --origin "$ORIGIN")"; then
    if [ -f "$HOST_HOME/state/device.json" ] && [ -f "$UNIT_FILE" ]; then
      # Note that the unit is rewritten first, since the daemon just installed refuses to run under the previous release's, which names no smolvm.
      write_unit
      systemctl restart "$UNIT" || true
      fail "Not enrolled again: $INSTALL_DIR was upgraded and $UNIT restarted on this box's existing enrollment."
    fi
    exit 1
  fi
  ok "$enrolled"
else
  ok "Kept this box's enrollment"
fi

write_unit
since="$(date '+%Y-%m-%d %H:%M:%S')"
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

# Note that the first VM of an image pulls it, about 1.3 GB, so it is fetched
# here, by smolvm's own documented way (a run of the image, which keeps the
# image for every VM after it), rather than leave the first agent to wait for
# it. It is last because nothing needs it to finish, and a failure only means the
# first agent pulls it as it would have.
printf 'Fetching the sandbox image (about 1.3 GB), so the first agent does not wait for it...\n'
limit=""
if command -v timeout >/dev/null 2>&1; then
  limit="timeout $IMAGE_WAIT_SECONDS"
fi
if (cd "$HOST_HOME" && runuser -u "$HOST_USER" -- env \
  -u XDG_DATA_HOME -u XDG_CACHE_HOME -u XDG_CONFIG_HOME HOME="$HOST_HOME" \
  $limit "$SMOLVM" machine run --net --image "$SANDBOX_IMAGE" -- true >/dev/null 2>&1); then
  ok "Fetched the sandbox image"
else
  printf '! Could not fetch the sandbox image. The first agent fetches it as it starts.\n'
fi

printf '\n%s is ready. Pick it under a task'"'"'s Runs on.\n' "$name"
printf 'To upgrade later, run the same command without --token.\n'
printf 'To remove it: sudo luke-host uninstall\n'
