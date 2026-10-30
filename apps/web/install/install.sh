#!/bin/sh
# install.sh -- installs Luke's host into the account that runs it, on a Linux box (x64 or arm64) or an Apple silicon Mac, connects it to Luke with a code a member approves, and upgrades it in place when run again.
#
# Served by the web app at /install.sh with the release, and the origin it
# was fetched from, written in (packages/service/src/agents/host-install-script-app.ts),
# and run, with no sudo, as the account whose agents the host should run:
#
#   curl -fsSL https://tryluke.dev/install.sh | sh
#
# Before it changes anything it checks the computer and says what is missing:
# Linux x64 or arm64 with a systemd user manager it can reach, or an Apple
# silicon Mac on macOS MAC_MIN_VERSION or later, and git. On Windows it runs
# inside WSL2 alone, whose kernel is Linux's; WSL1 has none, so it is refused.
# Run as root directly, it installs into root's own account, which is all a
# VPS that logs in as root has; run as root under sudo from another account,
# it is refused, so a stale `curl … | sudo sh` never installs into root's
# account.
# An install that came before, under /opt or a Mac's Application Support, is
# refused with that install's own uninstall command, since the two would run
# side by side.
#
# The account's files, which `luke-host uninstall` (apps/host/scripts/luke-host.sh)
# removes by the same names, and which the release's own launcher reads its
# state root from:
#
#   ~/.local/share/luke-host/versions/<version>/   each release, as its tarball's luke-host/ folder
#   ~/.local/share/luke-host/current                link to versions/<version>, the one that runs
#   ~/.local/bin/luke-host                          absolute link to …/current/bin/luke-host
#   ~/.local/state/luke-host/                       the state root: the box's record and its agents'
#   ~/.config/systemd/user/luke-host.service        Linux: the service, run through current
#   ~/Library/LaunchAgents/dev.reviewstage.luke.host.standalone.plist
#                                                   Mac: the LaunchAgent, run through current
#   ~/Library/Logs/Luke Host/luke-host.log          Mac: the LaunchAgent's log
#
# On Linux it turns on lingering first, so the service keeps running after
# the account logs out: on its own where the account may, and otherwise with
# `sudo loginctl enable-linger`, the one sudo it ever asks for, said first. It
# then downloads the release's tarball for the computer and checks it against
# the SHA-256 this script carries before anything of it is installed, unpacks
# it beside the releases already there, points current at it, and runs
# `luke-host connect`, which prints a link and a code and waits for a member to
# approve it in Luke, or answers at once where the box is connected already.
# Once it is connected it starts the service, a systemd user service enabled
# at boot or a LaunchAgent that runs while the user is logged in, and removes
# every other release. Run again, it upgrades in place: the box keeps its
# pairing, and the service is restarted on the new release.
set -eu

VERSION="@@VERSION@@"
SHA256_X64="@@SHA256_X64@@"
SHA256_ARM64="@@SHA256_ARM64@@"
URL_X64="@@URL_X64@@"
URL_ARM64="@@URL_ARM64@@"
SHA256_DARWIN_ARM64="@@SHA256_DARWIN_ARM64@@"
URL_DARWIN_ARM64="@@URL_DARWIN_ARM64@@"

ORIGIN="@@ORIGIN@@"
UNIT="luke-host.service"
# A Mac's LaunchAgent, by its label, which an install that came before used too.
MAC_LABEL="dev.reviewstage.luke.host.standalone"
# Where a Mac's install that came before put Luke host, under its user's home.
MAC_EARLIER_FOLDER="Library/Application Support/Luke Host"
# Where a Linux box's install that came before put Luke host and its service.
EARLIER_INSTALL_DIR="/opt/luke-host"
EARLIER_UNIT_FILE="/etc/systemd/system/$UNIT"
# The oldest macOS it installs on: the release's launcher reads its own path
# with readlink -f, which macOS has had since 12.3.
MAC_MIN_VERSION="12.3"
# The folder that stands where systemd runs the box; a test points it elsewhere.
SYSTEMD_RUN_DIR="${LUKE_HOST_SYSTEMD_RUN_DIR:-/run/systemd/system}"
# How long a Mac's install waits for its running LaunchAgent to stop before it
# swaps the release; a test points it at none.
MAC_STOP_WAIT_SECONDS="${LUKE_HOST_MAC_STOP_WAIT_SECONDS:-30}"
# Whether the box is WSL2, which require_supported_os reads from /proc/version.
ON_WSL=false

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

# The account's files, under its home, by the names the header lists. Note
# that they are set once the home is known, as account_paths does.
account_paths() {
  RELEASES="$HOME/.local/share/luke-host"
  LINK="$HOME/.local/bin/luke-host"
  UNIT_FILE="$HOME/.config/systemd/user/$UNIT"
  PLIST="$HOME/Library/LaunchAgents/$MAC_LABEL.plist"
  MAC_LOG="$HOME/Library/Logs/Luke Host/luke-host.log"
}

# The computer's own architecture. On a Mac it reads the hardware, so Apple
# silicon is still arm64 from a shell running under Rosetta, where uname -m
# says x86_64.
hardware_machine() {
  if [ "$(uname -s)" = "Darwin" ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ]; then
    echo arm64
  else
    uname -m
  fi
}

# Refuses a computer Luke host does not run on, as the script's first word on
# it, before it changes anything: its kernel ($1), its machine ($2), and its
# /proc/version ($3). WSL2's names its kernel microsoft-standard (and WSL2 since
# 5.10) and is let through, setting ON_WSL; WSL1's names Microsoft alone.
require_supported_os() {
  case "$1" in
    Linux) ;;
    Darwin)
      case "$2" in
        arm64) ;;
        *) fail "Luke does not run agents on Intel Macs." ;;
      esac
      ;;
    *) fail "Luke host runs on Linux, not $1." ;;
  esac
  case "$3" in
    *microsoft-standard* | *WSL2*) ON_WSL=true ;;
    *[Mm]icrosoft* | *WSL*)
      fail "Luke host needs WSL2, and this is WSL1, which has no Linux kernel. Upgrade it with: wsl --set-version <distro> 2"
      ;;
  esac
}

# Refuses a macOS older than MAC_MIN_VERSION, $1 as `sw_vers -productVersion`
# prints it, naming the version it needs.
require_macos_version() {
  major="${1%%.*}"
  minor="${1#"$major"}"
  minor="${minor#.}"
  minor="${minor%%.*}"
  case "$major" in '' | *[!0-9]*) major=0 ;; esac
  case "$minor" in '' | *[!0-9]*) minor=0 ;; esac
  need_major="${MAC_MIN_VERSION%%.*}"
  need_minor="${MAC_MIN_VERSION#*.}"
  if [ "$major" -gt "$need_major" ] || { [ "$major" -eq "$need_major" ] && [ "$minor" -ge "$need_minor" ]; }; then
    return 0
  fi
  fail "Luke host needs macOS $MAC_MIN_VERSION or later, and this Mac runs macOS ${1:-of a version it did not say}. Update macOS, then run this again."
}

# Refuses a run as root under sudo from another account, whose files would
# land in root's account rather than the one that typed the command, and a
# run with no home to install into. On a Mac it refuses root as well, which
# has no login session for a LaunchAgent to run in. Note that a session sudo
# opened as another account than root, which installs into that account, is
# let through, and on Linux refused by require_user_manager where its user
# manager cannot be reached.
require_own_account() {
  if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then
    fail "Run it without sudo, as the account whose agents Luke host should run: curl -fsSL $ORIGIN/install.sh | sh"
  fi
  if [ "$(uname -s)" = "Darwin" ] && [ "$(id -u)" -eq 0 ]; then
    fail "Run it from the Mac account whose agents Luke host should run, not as root: curl -fsSL $ORIGIN/install.sh | sh"
  fi
  [ -n "${HOME:-}" ] && [ -d "$HOME" ] || fail "This account has no home folder to install Luke host into (HOME is ${HOME:-not set})."
}

# Refuses an install that came before, which this one would run beside, and
# names its own uninstall command. Note that it is never moved, so its agents'
# folders and its box's pairing are the member's to give up.
require_no_earlier_install() {
  if [ "$(uname -s)" = "Darwin" ]; then
    earlier="$HOME/$MAC_EARLIER_FOLDER"
    [ -e "$earlier" ] || return 0
    fail "Luke host is already installed for this account in $earlier, by an earlier install. Remove it first with: sudo '$earlier/luke-host/bin/luke-host' uninstall — then run this again."
  fi
  [ -e "$EARLIER_INSTALL_DIR" ] || [ -e "$EARLIER_UNIT_FILE" ] || return 0
  fail "Luke host is already installed on this box under $EARLIER_INSTALL_DIR, by an earlier install. Remove it first with: sudo $EARLIER_INSTALL_DIR/bin/luke-host uninstall — then run this again."
}

# Refuses a box not run by systemd, or whose systemd user manager for this
# account cannot be reached, which the host's service runs under, saying under
# WSL how to turn systemd on.
require_user_manager() {
  if ! command -v systemctl >/dev/null 2>&1 || [ ! -d "$SYSTEMD_RUN_DIR" ]; then
    if [ "$ON_WSL" = true ]; then
      fail "Luke host needs systemd. Turn it on with [boot] systemd=true in /etc/wsl.conf, run wsl --shutdown in Windows, and run this again."
    fi
    fail "Luke host needs systemd."
  fi
  systemctl --user show-environment >/dev/null 2>&1 ||
    fail "Could not reach the systemd user manager of $(id -un), which Luke host runs under. Run this from a login of that account, over SSH or at its console, rather than through su or sudo."
}

# Refuses a computer without git, which agents make their worktrees with, or
# without a tool to check a download's SHA-256 with.
require_tools() {
  if ! git --version >/dev/null 2>&1; then
    if [ "$(uname -s)" = "Darwin" ]; then
      fail "Luke host needs git, which its agents make their worktrees with. Install it with: xcode-select --install — then run this again."
    fi
    fail "Luke host needs git, which its agents make their worktrees with. Install it with your package manager, then run this again."
  fi
  command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 ||
    fail "Luke host needs sha256sum (coreutils) or shasum to check its download."
}

# Answers whether the account named $1 lingers, its user manager kept running
# while it is logged out.
lingering() {
  [ "$(loginctl show-user "$1" --property=Linger --value 2>/dev/null)" = yes ]
}

# Turns lingering on for this account, so the service keeps running after it
# logs out: on its own where the account may, never asking for a password,
# and only where that is refused with sudo, saying why first. Fails, with
# nothing installed, where neither turns it on.
enable_lingering() {
  user="$(id -un)"
  if lingering "$user"; then
    ok "Lingering is on for $user, so Luke host keeps running after you log out"
    return 0
  fi
  if loginctl --no-ask-password enable-linger >/dev/null 2>&1 && lingering "$user"; then
    ok "Turned lingering on for $user, so Luke host keeps running after you log out"
    return 0
  fi
  printf 'Luke host keeps running after you log out only with lingering on for %s, which this account may not turn on by itself.\n' "$user"
  printf 'Turning it on with sudo, the one thing this script asks sudo for: sudo loginctl enable-linger %s\n' "$user"
  if command -v sudo >/dev/null 2>&1 && sudo loginctl enable-linger "$user" && lingering "$user"; then
    ok "Turned lingering on for $user, so Luke host keeps running after you log out"
    return 0
  fi
  fail "Could not turn lingering on for $user, so nothing was installed: without it Luke host would stop when you log out. Have an administrator of this box run sudo loginctl enable-linger $user, then run this again."
}

# Fails unless the file's SHA-256 is the one given: $1 the file, $2 its digest.
# Note that a Mac has shasum where Linux has sha256sum.
check_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$1" | cut -d ' ' -f 1)"
  else
    actual="$(shasum -a 256 "$1" | cut -d ' ' -f 1)"
  fi
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

# Writes the service's unit, run through current so a release is switched by
# moving that link, restarted only when it crashes, since the daemon exits 0
# once Luke refuses the box's secret, and started with the user manager, which
# lingering starts at boot.
write_unit() {
  mkdir -p "$(dirname "$UNIT_FILE")"
  cat >"$UNIT_FILE" <<UNIT_EOF
[Unit]
Description=Luke host
Documentation=https://tryluke.dev

[Service]
Type=simple
ExecStart=$RELEASES/current/bin/luke-host run
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
UNIT_EOF
}

# Writes the LaunchAgent to $1, running the release through current, logging
# to $2. It runs at login, and again after a crash but not after a clean exit,
# the daemon's answer to its host being removed in Luke. Note that the state
# root is the release's launcher's to name, and that there is no ProcessType,
# since a Background job's CPU and disk are throttled and its agents are work
# the member asked for.
write_launch_agent() {
  cat >"$1" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$MAC_LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>$RELEASES/current/bin/luke-host</string>
		<string>run</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>StandardOutPath</key>
	<string>$2</string>
	<key>StandardErrorPath</key>
	<string>$2</string>
</dict>
</plist>
PLIST_EOF
}

# Stops the LaunchAgent of the user whose uid is $1 and waits until launchd
# lists it no more, so no daemon of it is left running a release about to be
# swapped; refuses, having changed nothing, where it does not stop.
stop_launch_agent() {
  agent="gui/$1/$MAC_LABEL"
  launchctl bootout "$agent" >/dev/null 2>&1 || true
  stopping=0
  while launchctl print "$agent" >/dev/null 2>&1; do
    [ "$stopping" -lt "$MAC_STOP_WAIT_SECONDS" ] ||
      fail "Could not stop Luke host for this account, so nothing was changed. Stop it with launchctl bootout $agent, then run this again."
    sleep 1
    stopping=$((stopping + 1))
  done
}

# Starts the LaunchAgent written to $2 in the login session of the user whose
# uid is $1, where they are logged in; where they are not, or launchd will not
# start it from here, says it starts at their next login. Answers whether it
# started.
start_launch_agent() {
  if ! launchctl print "gui/$1" >/dev/null 2>&1; then
    ok "Installed $MAC_LABEL, which starts at this account's next login"
    return 1
  fi
  if ! launchctl bootstrap "gui/$1" "$2"; then
    printf '! launchctl could not start %s from here, so it starts at this account'"'"'s next login. To start it now, run this again from Terminal on the Mac.\n' "$MAC_LABEL"
    return 1
  fi
  ok "Started $MAC_LABEL (starts at login)"
  return 0
}

# Stops the service before its release's folder is swapped for the same
# version's, so no daemon runs from a folder taken away under it. Note that a
# new version's folder stands beside the running one's, which needs no stop.
stop_service() {
  if [ "$(uname -s)" = "Darwin" ]; then
    stop_launch_agent "$(id -u)"
  else
    systemctl --user stop "$UNIT" >/dev/null 2>&1 || true
  fi
}

# Unpacks the checked tarball $1 into the releases, as versions/$VERSION, and
# points current and the command's link at it. Note that it is unpacked into
# $work, a folder of the releases' own, so the version's folder appears whole.
install_release() {
  mkdir -p "$RELEASES/versions" "$work/unpacked"
  tar -xzf "$1" -C "$work/unpacked" || fail "Could not unpack ${1##*/}"
  [ -x "$work/unpacked/luke-host/bin/luke-host" ] || fail "${1##*/} holds no luke-host."
  target="$RELEASES/versions/$VERSION"
  if [ -e "$target" ]; then
    stop_service
    mv "$target" "$work/replaced"
  fi
  mv "$work/unpacked/luke-host" "$target"
  ln -sfn "versions/$VERSION" "$RELEASES/current"
  mkdir -p "$(dirname "$LINK")"
  ln -sfn "$RELEASES/current/bin/luke-host" "$LINK"
  ok "Installed Luke host $VERSION to $target"
}

# Removes every release but the one current names, once the service runs it.
remove_other_releases() {
  for release in "$RELEASES/versions"/*; do
    [ -e "$release" ] && [ "$release" != "$RELEASES/versions/$VERSION" ] || continue
    rm -rf "$release"
  done
}

# Connects the box through the release just installed, which prints the link
# and the code and waits for them to be approved, or answers at once where the
# box is connected already; ends the script where it is not connected, by the
# code connect ended with, the service not started.
connect_box() {
  code=0
  "$LINK" connect --origin "$ORIGIN" || code=$?
  [ "$code" -eq 0 ] && return 0
  printf '%s Luke host is installed but was not started, since this box is not connected. Run the install command again for a new code: curl -fsSL %s/install.sh | sh\n' "$CROSS" "$ORIGIN" >&2
  exit "$code"
}

# Starts the systemd user service on the release just installed, enabled so
# lingering starts it at boot.
start_unit() {
  write_unit
  systemctl --user daemon-reload
  systemctl --user enable "$UNIT" >/dev/null 2>&1 || fail "Could not enable $UNIT."
  systemctl --user restart "$UNIT" ||
    fail "Could not start $UNIT. See journalctl --user -u $UNIT"
  ok "Started $UNIT, which keeps running after you log out"
}

# Starts the LaunchAgent on the release just installed, in this user's login
# session where they are logged in, and says it runs only while they are.
start_mac_agent() {
  uid="$(id -u)"
  stop_launch_agent "$uid"
  mkdir -p "$(dirname "$PLIST")" "$(dirname "$MAC_LOG")"
  write_launch_agent "$PLIST" "$MAC_LOG"
  chmod 644 "$PLIST"
  start_launch_agent "$uid" "$PLIST" || true
  printf 'It runs while %s is logged in, so on a Mac nobody sits at, turn on automatic login for %s.\n' "$(id -un)" "$(id -un)"
}

# The release's tarball for this computer, by its name, address and SHA-256,
# set as target_*; fails where the release carries none for it.
release_target() {
  if [ "$(uname -s)" = "Darwin" ]; then
    target_name="darwin-arm64"
    target_url="$URL_DARWIN_ARM64"
    target_sha256="$SHA256_DARWIN_ARM64"
  else
    case "$(uname -m)" in
      x86_64 | amd64)
        target_name="linux-x64"
        target_url="$URL_X64"
        target_sha256="$SHA256_X64"
        ;;
      aarch64 | arm64)
        target_name="linux-arm64"
        target_url="$URL_ARM64"
        target_sha256="$SHA256_ARM64"
        ;;
      *) fail "Luke host runs on x64 and arm64, not $(uname -m)." ;;
    esac
  fi
  [ -n "$target_sha256" ] || fail "Luke host $VERSION has no release for $target_name yet."
}

# Installs, connects and starts Luke host in this account, the options parsed.
main() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --origin)
        [ "$#" -ge 2 ] || fail "--origin needs a value"
        ORIGIN="$2"
        shift 2
        ;;
      --origin=*)
        ORIGIN="${1#--origin=}"
        shift
        ;;
      --token | --token=*)
        fail "Luke host no longer takes an install token. Run it without sudo, and approve the code it shows in Luke: curl -fsSL $ORIGIN/install.sh | sh"
        ;;
      *) fail "Unknown option: $1" ;;
    esac
  done

  [ -n "$VERSION" ] || fail "Luke host has no release yet."
  case "$ORIGIN" in
    https://*) ;;
    *) fail "--origin must be an https:// address, not $ORIGIN" ;;
  esac
  kernel="$(uname -s)"
  require_supported_os "$kernel" "$(hardware_machine)" "$(cat /proc/version 2>/dev/null || true)"
  if [ "$kernel" = "Darwin" ]; then
    require_macos_version "$(sw_vers -productVersion 2>/dev/null || true)"
  fi
  require_own_account
  account_paths
  require_no_earlier_install
  [ "$kernel" = "Darwin" ] || require_user_manager
  require_tools
  release_target

  printf 'Luke host %s for %s, for %s\n' "$VERSION" "$target_name" "$(id -un)"
  [ "$kernel" = "Darwin" ] || enable_lingering

  mkdir -p "$RELEASES"
  work="$(mktemp -d "$RELEASES/.install.XXXXXX")"
  trap 'rm -rf "$work"' EXIT
  tarball="luke-host-$VERSION-$target_name.tar.gz"
  download "$target_url" "$work/$tarball"
  check_sha256 "$work/$tarball" "$target_sha256"
  ok "Downloaded and checked $tarball (sha256 matches)"
  install_release "$work/$tarball"

  connect_box
  if [ "$kernel" = "Darwin" ]; then
    start_mac_agent
  else
    start_unit
  fi
  remove_other_releases

  printf '\nConnected. This box gets ready in Luke, then you can pick it under a task'"'"'s Runs on.\n'
  printf 'To upgrade later, run the same command again.\n'
  case ":${PATH:-}:" in
    *":$HOME/.local/bin:"*) printf 'To remove it: luke-host uninstall\n' ;;
    *) printf 'To remove it: %s uninstall\n' "$LINK" ;;
  esac
  # Note that a systemd service does not keep a WSL distro up: WSL stops it about
  # 15 seconds after its last window closes, unless instanceIdleTimeout is -1.
  if [ "$ON_WSL" = true ]; then
    printf 'Under WSL, Windows stops %s about 15 seconds after its last WSL window closes: keep one open, or set [general] instanceIdleTimeout=-1 in %%UserProfile%%\\.wslconfig (WSL 2.5 or later).\n' "$UNIT"
  fi
}

# A test sources the script up to here, to call its functions and read what it carries.
[ -z "${LUKE_HOST_INSTALL_LIBRARY:-}" ] || return 0

# Note that the whole script is read before any of it runs, since sh reads a piped script as it goes.
main "$@"
