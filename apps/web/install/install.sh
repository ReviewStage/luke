#!/bin/sh
set -eu

VERSION="@@VERSION@@"
SHA256_X64="@@SHA256_X64@@"
SHA256_ARM64="@@SHA256_ARM64@@"
URL_X64="@@URL_X64@@"
URL_ARM64="@@URL_ARM64@@"
SHA256_DARWIN_ARM64="@@SHA256_DARWIN_ARM64@@"
URL_DARWIN_ARM64="@@URL_DARWIN_ARM64@@"
CLI_VERSION="@@CLI_VERSION@@"
CLI_SHA256_X64="@@CLI_SHA256_X64@@"
CLI_SHA256_ARM64="@@CLI_SHA256_ARM64@@"
CLI_SHA256_DARWIN_ARM64="@@CLI_SHA256_DARWIN_ARM64@@"
CLI_URL_X64="@@CLI_URL_X64@@"
CLI_URL_ARM64="@@CLI_URL_ARM64@@"
CLI_URL_DARWIN_ARM64="@@CLI_URL_DARWIN_ARM64@@"

ORIGIN="@@ORIGIN@@"
PRODUCT="Vespin host"
UNIT="vespin-host.service"
MAC_LABEL="dev.vespin.host.standalone"
MAC_MIN_VERSION="13.5"
SYSTEMD_RUN_DIR="${APP_HOST_SYSTEMD_RUN_DIR:-/run/systemd/system}"
MAC_STOP_WAIT_SECONDS="${APP_HOST_MAC_STOP_WAIT_SECONDS:-30}"
ON_WSL=false
TYPED_LINK='~/.local/bin/vespin-host'

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

account_paths() {
  RELEASES="$HOME/.local/share/vespin-host"
  LINK="$HOME/.local/bin/vespin-host"
  UNIT_FILE="$HOME/.config/systemd/user/$UNIT"
  PLIST="$HOME/Library/LaunchAgents/$MAC_LABEL.plist"
  MAC_LOG="$HOME/Library/Logs/Vespin Host/vespin-host.log"
}

hardware_machine() {
  if [ "$(uname -s)" = "Darwin" ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ]; then
    echo arm64
  else
    uname -m
  fi
}

require_supported_os() {
  case "$1" in
    Linux) ;;
    Darwin)
      case "$2" in
        arm64) ;;
        *) fail "Vespin does not run agents on Intel Macs." ;;
      esac
      ;;
    *) fail "Vespin host runs on Linux, not $1." ;;
  esac
  case "$3" in
    *microsoft-standard* | *WSL2*) ON_WSL=true ;;
    *[Mm]icrosoft* | *WSL*)
      fail "Vespin host needs WSL2, and this is WSL1, which has no Linux kernel. Upgrade it with: wsl --set-version <distro> 2"
      ;;
  esac
}

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
  fail "$PRODUCT needs macOS $MAC_MIN_VERSION or later, and this Mac runs macOS ${1:-of a version it did not say}. Update macOS, then run this again."
}

require_own_account() {
  if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then
    fail "Run it without sudo, as the account whose agents Vespin host should run: curl -fsSL $ORIGIN/install.sh | sh"
  fi
  if [ "$(uname -s)" = "Darwin" ] && [ "$(id -u)" -eq 0 ]; then
    fail "Run it from the Mac account whose agents Vespin host should run, not as root: curl -fsSL $ORIGIN/install.sh | sh"
  fi
  [ -n "${HOME:-}" ] && [ -d "$HOME" ] || fail "This account has no home folder to install Vespin host into (HOME is ${HOME:-not set})."
}

require_user_manager() {
  if ! command -v systemctl >/dev/null 2>&1 || [ ! -d "$SYSTEMD_RUN_DIR" ]; then
    if [ "$ON_WSL" = true ]; then
      fail "Vespin host needs systemd. Turn it on with [boot] systemd=true in /etc/wsl.conf, run wsl --shutdown in Windows, and run this again."
    fi
    fail "Vespin host needs systemd."
  fi
  systemctl --user show-environment >/dev/null 2>&1 ||
    fail "Could not reach the systemd user manager of $(id -un), which Vespin host runs under. Run this from a login of that account, over SSH or at its console, rather than through su or sudo."
}

require_tools() {
  if ! git --version >/dev/null 2>&1; then
    if [ "$(uname -s)" = "Darwin" ]; then
      fail "Vespin host needs git, which its agents make their worktrees with. Install it with: xcode-select --install — then run this again."
    fi
    fail "Vespin host needs git, which its agents make their worktrees with. Install it with your package manager, then run this again."
  fi
  command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 ||
    fail "Vespin host needs sha256sum (coreutils) or shasum to check its download."
}

lingering() {
  [ "$(loginctl show-user "$1" --property=Linger --value 2>/dev/null)" = yes ]
}

enable_lingering() {
  user="$(id -un)"
  if lingering "$user"; then
    ok "Lingering is on for $user, so Vespin host keeps running after you log out"
    return 0
  fi
  if loginctl --no-ask-password enable-linger >/dev/null 2>&1 && lingering "$user"; then
    ok "Turned lingering on for $user, so Vespin host keeps running after you log out"
    return 0
  fi
  printf 'Vespin host keeps running after you log out only with lingering on for %s, which this account may not turn on by itself.\n' "$user"
  printf 'Turning it on with sudo, the one thing this script asks sudo for: sudo loginctl enable-linger %s\n' "$user"
  if command -v sudo >/dev/null 2>&1 && sudo loginctl enable-linger "$user" && lingering "$user"; then
    ok "Turned lingering on for $user, so Vespin host keeps running after you log out"
    return 0
  fi
  fail "Could not turn lingering on for $user, so nothing was installed: without it Vespin host would stop when you log out. Have an administrator of this box run sudo loginctl enable-linger $user, then run this again."
}

check_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$1" | cut -d ' ' -f 1)"
  else
    actual="$(shasum -a 256 "$1" | cut -d ' ' -f 1)"
  fi
  [ "$actual" = "$2" ] || fail "The download's checksum is $actual, not $2. Nothing was installed."
}

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --proto '=https' --tlsv1.2 -o "$2" "$1" || fail "Could not download $1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1" || fail "Could not download $1"
  else
    fail "$PRODUCT needs curl or wget to download its release."
  fi
}

write_unit() {
  mkdir -p "$(dirname "$UNIT_FILE")"
  cat >"$UNIT_FILE" <<UNIT_EOF
[Unit]
Description=Vespin host
Documentation=https://vespin.dev

[Service]
Type=simple
ExecStart=$RELEASES/current/bin/vespin-host run
Restart=always
RestartSec=60

[Install]
WantedBy=default.target
UNIT_EOF
}

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
		<string>$RELEASES/current/bin/vespin-host</string>
		<string>run</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>ThrottleInterval</key>
	<integer>60</integer>
	<key>StandardOutPath</key>
	<string>$2</string>
	<key>StandardErrorPath</key>
	<string>$2</string>
</dict>
</plist>
PLIST_EOF
}

stop_launch_agent() {
  agent="gui/$1/$MAC_LABEL"
  launchctl bootout "$agent" >/dev/null 2>&1 || true
  stopping=0
  while launchctl print "$agent" >/dev/null 2>&1; do
    [ "$stopping" -lt "$MAC_STOP_WAIT_SECONDS" ] ||
      fail "Could not stop Vespin host for this account, so nothing was changed. Stop it with launchctl bootout $agent, then run this again."
    sleep 1
    stopping=$((stopping + 1))
  done
}

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

stop_unit() {
  systemctl --user stop "$1" >/dev/null 2>&1 || true
  case "$(systemctl --user is-active "$1" 2>/dev/null)" in
    active | activating | deactivating | reloading | refreshing)
      fail "Could not stop $1, so nothing was changed. Stop it with systemctl --user stop $1, then run this again."
      ;;
  esac
}

stop_service() {
  if [ "$(uname -s)" = "Darwin" ]; then
    stop_launch_agent "$(id -u)"
    return 0
  fi
  stop_unit "$UNIT"
}

install_release() {
  mkdir -p "$RELEASES/versions" "$work/unpacked"
  tar -xzf "$1" -C "$work/unpacked" || fail "Could not unpack ${1##*/}"
  [ -x "$work/unpacked/vespin-host/bin/vespin-host" ] || fail "${1##*/} holds no vespin-host."
  target="$RELEASES/versions/$VERSION"
  if [ -e "$target" ]; then
    stop_service
    mv "$target" "$work/replaced"
  fi
  mv "$work/unpacked/vespin-host" "$target"
  ln -sfn "versions/$VERSION" "$RELEASES/current"
  mkdir -p "$(dirname "$LINK")"
  ln -sfn "$RELEASES/current/bin/vespin-host" "$LINK"
  ok "Installed Vespin host $VERSION to $target"
}

remove_other_releases() {
  for release in "$RELEASES/versions"/*; do
    [ -e "$release" ] && [ "$release" != "$RELEASES/versions/$VERSION" ] || continue
    rm -rf "$release"
  done
}

connect_box() {
  code=0
  "$LINK" connect --origin "$ORIGIN" || code=$?
  [ "$code" -eq 0 ] && return 0
  printf '%s This box is not connected yet. Vespin host is installed and follows it once it is. For a new code, run: %s connect --origin %s\n' "$CROSS" "$TYPED_LINK" "$ORIGIN" >&2
  exit "$code"
}

enable_unit() {
  write_unit
  systemctl --user daemon-reload
  systemctl --user enable "$UNIT" >/dev/null 2>&1 || fail "Could not enable $UNIT."
  systemctl --user start "$UNIT" ||
    fail "Could not start $UNIT. See journalctl --user -u $UNIT"
  ok "Enabled $UNIT, which keeps running after you log out"
}

restart_unit() {
  systemctl --user restart "$UNIT" ||
    fail "Could not start $UNIT. See journalctl --user -u $UNIT"
  ok "Started $UNIT on Vespin host $VERSION"
}

load_mac_agent() {
  mkdir -p "$(dirname "$PLIST")" "$(dirname "$MAC_LOG")"
  write_launch_agent "$PLIST" "$MAC_LOG"
  chmod 644 "$PLIST"
  uid="$(id -u)"
  launchctl print "gui/$uid/$MAC_LABEL" >/dev/null 2>&1 ||
    launchctl bootstrap "gui/$uid" "$PLIST" >/dev/null 2>&1 || true
}

restart_mac_agent() {
  uid="$(id -u)"
  stop_launch_agent "$uid"
  start_launch_agent "$uid" "$PLIST" || true
  printf 'It runs while %s is logged in, so on a Mac nobody sits at, turn on automatic login for %s.\n' "$(id -un)" "$(id -un)"
}

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
      *) fail "Vespin host runs on x64 and arm64, not $(uname -m)." ;;
    esac
  fi
  [ -n "$target_sha256" ] || fail "Vespin host $VERSION has no release for $target_name yet."
}

cli_paths() {
  CLI_RELEASES="$HOME/.local/share/vespin-cli"
  CLI_LINK="$HOME/.local/bin/vespin"
}

require_cli_target() {
  case "$1-$2" in
    Darwin-arm64)
      cli_target_name="darwin-arm64"
      cli_target_url="$CLI_URL_DARWIN_ARM64"
      cli_target_sha256="$CLI_SHA256_DARWIN_ARM64"
      ;;
    Linux-x86_64 | Linux-amd64)
      cli_target_name="linux-x64"
      cli_target_url="$CLI_URL_X64"
      cli_target_sha256="$CLI_SHA256_X64"
      ;;
    Linux-aarch64 | Linux-arm64)
      cli_target_name="linux-arm64"
      cli_target_url="$CLI_URL_ARM64"
      cli_target_sha256="$CLI_SHA256_ARM64"
      ;;
    *) fail "Vespin CLI has no release for $1 on $2. Install it with npm instead, on Node 20 or later: npm i -g vespin" ;;
  esac
}

require_cli_account() {
  if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then
    fail "Run it without sudo, as the account that will use vespin: curl -fsSL $ORIGIN/install.sh | sh -s cli"
  fi
  [ -n "${HOME:-}" ] && [ -d "$HOME" ] || fail "This account has no home folder to install Vespin CLI into (HOME is ${HOME:-not set})."
  command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 ||
    fail "Vespin CLI needs sha256sum (coreutils) or shasum to check its download."
}

install_cli_release() {
  mkdir -p "$CLI_RELEASES/versions" "$work/unpacked"
  tar -xzf "$1" -C "$work/unpacked" || fail "Could not unpack ${1##*/}"
  [ -x "$work/unpacked/vespin/bin/vespin" ] || fail "${1##*/} holds no vespin."
  target="$CLI_RELEASES/versions/$CLI_VERSION"
  [ ! -e "$target" ] || mv "$target" "$work/replaced"
  mv "$work/unpacked/vespin" "$target"
  mkdir -p "$(dirname "$CLI_LINK")"
  ln -sfn "$target/bin/vespin" "$CLI_LINK"
  ok "Installed Vespin CLI $CLI_VERSION to $target"
}

remove_other_cli_releases() {
  for release in "$CLI_RELEASES/versions"/*; do
    [ -e "$release" ] && [ "$release" != "$CLI_RELEASES/versions/$CLI_VERSION" ] || continue
    rm -rf "$release"
  done
}

main_cli() {
  [ "$#" -eq 0 ] || fail "Unknown option: $1"
  PRODUCT="Vespin CLI"
  [ -n "$CLI_VERSION" ] || fail "Vespin CLI has no release yet. Install it with npm instead, on Node 20 or later: npm i -g vespin"
  kernel="$(uname -s)"
  require_cli_target "$kernel" "$(hardware_machine)"
  if [ "$kernel" = "Darwin" ]; then
    require_macos_version "$(sw_vers -productVersion 2>/dev/null || true)"
  fi
  require_cli_account
  cli_paths
  [ -n "$cli_target_sha256" ] || fail "Vespin CLI $CLI_VERSION has no release for $cli_target_name yet."

  installed="$CLI_RELEASES/versions/$CLI_VERSION/bin/vespin"
  if [ -x "$installed" ] && [ "$(readlink "$CLI_LINK" 2>/dev/null || true)" = "$installed" ]; then
    ok "Vespin CLI $CLI_VERSION is installed already, at $CLI_LINK"
  else
    printf 'Vespin CLI %s for %s, for %s\n' "$CLI_VERSION" "$cli_target_name" "$(id -un)"
    mkdir -p "$CLI_RELEASES"
    work="$(mktemp -d "$CLI_RELEASES/.install.XXXXXX")"
    trap 'rm -rf "$work"' EXIT
    tarball="vespin-$CLI_VERSION-$cli_target_name.tar.gz"
    download "$cli_target_url" "$work/$tarball"
    check_sha256 "$work/$tarball" "$cli_target_sha256"
    ok "Downloaded and checked $tarball (sha256 matches)"
    install_cli_release "$work/$tarball"
  fi
  remove_other_cli_releases

  case ":${PATH:-}:" in
    *":$(dirname "$CLI_LINK"):"*) printf '\nRun vespin login to sign in.\n' ;;
    *)
      printf '\n%s is not on your PATH. Add it to your shell'"'"'s profile:\n' "$(dirname "$CLI_LINK")"
      printf '  export PATH="$HOME/.local/bin:$PATH"\n'
      printf 'Then run vespin login to sign in.\n'
      ;;
  esac
  printf 'To upgrade later, run vespin update.\n'
}

main() {
  if [ "${1:-}" = cli ]; then
    shift
    main_cli "$@"
    return 0
  fi
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
      *) fail "Unknown option: $1" ;;
    esac
  done

  [ -n "$VERSION" ] || fail "Vespin host has no release yet."
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
  [ "$kernel" = "Darwin" ] || require_user_manager
  require_tools
  release_target

  printf 'Vespin host %s for %s, for %s\n' "$VERSION" "$target_name" "$(id -un)"
  [ "$kernel" = "Darwin" ] || enable_lingering

  mkdir -p "$RELEASES"
  work="$(mktemp -d "$RELEASES/.install.XXXXXX")"
  trap 'rm -rf "$work"' EXIT
  tarball="vespin-host-$VERSION-$target_name.tar.gz"
  download "$target_url" "$work/$tarball"
  check_sha256 "$work/$tarball" "$target_sha256"
  ok "Downloaded and checked $tarball (sha256 matches)"
  install_release "$work/$tarball"
  if [ "$kernel" = "Darwin" ]; then
    load_mac_agent
  else
    enable_unit
  fi

  connect_box
  if [ "$kernel" = "Darwin" ]; then
    restart_mac_agent
  else
    restart_unit
  fi
  remove_other_releases

  printf '\n'
  ok "Ready. Pick it under a task's Runs on in Vespin."
  printf 'To remove it: %s uninstall\n' "$TYPED_LINK"
  if [ "$ON_WSL" = true ]; then
    printf 'Under WSL, Windows stops %s about 15 seconds after its last WSL window closes: keep one open, or set [general] instanceIdleTimeout=-1 in %%UserProfile%%\\.wslconfig (WSL 2.5 or later).\n' "$UNIT"
  fi
}

[ -z "${APP_HOST_INSTALL_LIBRARY:-}" ] || return 0

main "$@"
