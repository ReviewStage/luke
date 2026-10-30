#!/bin/sh
# install.sh -- installs Luke's host daemon on a Linux box (x64 or arm64) or an Apple silicon Mac, enrolls it with an install token, and upgrades it in place when run again without one.
#
# Served by the web app at /install.sh with the release, and the origin it
# was fetched from, written in (packages/service/src/agents/host-install-script-app.ts),
# and run as root:
#
#   curl -fsSL https://tryluke.dev/install.sh | sudo sh -s -- --token <token>
#
# Every agent runs in a smolvm VM of its own, with no mode that runs one
# without, so it refuses a box with no usable /dev/kvm before it changes
# anything. On Windows it runs inside WSL2 alone, whose kernel is Linux's; WSL1
# has none, so it is refused. It then downloads the release's tarball for the
# box's architecture and the pinned smolvm's, and checks each against the
# SHA-256 this script carries before anything of either is installed; installs the daemon to
# /opt/luke-host and smolvm to /opt/luke-smolvm, both owned by root, smolvm only
# where the box's is not the pinned release already; makes the luke-host user
# the daemon and every agent's VM run as, in the kvm group; enrolls the box under
# its hostname, which writes the box's device secret readable by luke-host
# alone; and installs and starts luke-host.service as that user, restarted only
# when it crashes, and told by its environment which smolvm to run. Before it
# enrolls or starts anything, it fetches Luke's sandbox image as luke-host, so
# the first agent does not wait for its 1.3 GB, and boots one throwaway VM from
# it as the daemon would, so a box that cannot boot one is told so here rather
# than by its first agent. smolvm's own state lives under luke-host's home. Run
# again without --token, it upgrades in place and keeps the box's enrollment.
# `sudo luke-host uninstall` removes it.
#
# On an Apple silicon Mac it installs for the user who ran the command under
# sudo, as GitHub's runner does on macOS, and refuses where there is none, as
# when root itself is logged in. It refuses a macOS older than
# MAC_MIN_VERSION, and checks no /dev/kvm, since smolvm runs on
# Hypervisor.framework there. It unpacks the
# release under that user's Application Support, owned by them, enrolls the
# Mac as that user, and installs a LaunchAgent in their ~/Library/LaunchAgents
# that runs the daemon at login, on a state folder of its own, and again after
# a crash but not after a clean exit, logging under their ~/Library/Logs. It
# starts the agent at once where that user is logged in, and otherwise at their
# next login: it runs only while they are. The daemon fetches its own smolvm
# (SMOLVM_MAC_PIN) and the sandbox image as it starts. It runs beside the
# desktop app's This Mac, whichever account each runs agents for.
#
# smolvm's own install script is never run: its release is fetched and checked
# here, as the daemon's is.
set -eu

VERSION="@@VERSION@@"
SHA256_X64="@@SHA256_X64@@"
SHA256_ARM64="@@SHA256_ARM64@@"
URL_X64="@@URL_X64@@"
URL_ARM64="@@URL_ARM64@@"
SHA256_DARWIN_ARM64="@@SHA256_DARWIN_ARM64@@"
URL_DARWIN_ARM64="@@URL_DARWIN_ARM64@@"

# The smolvm release Luke runs agents in, and Luke's sandbox image its VMs boot,
# held to the daemon's pins (SMOLVM_LINUX_PIN, SANDBOX_IMAGE in
# packages/agent-runner/src/pins.ts) by a test.
SMOLVM_VERSION="1.32.3"
SMOLVM_SHA256_X64="82b50f55b35828efbf02ec84c22274780be109c7f424a24646390abc44506afe"
SMOLVM_SHA256_ARM64="baea200aea86c405e31afd3a6f278b3bcf6370ea252d35e66b90ba3e849b9721"
SMOLVM_URL_X64="https://github.com/smol-machines/smolvm/releases/download/v1.32.3/smolvm-1.32.3-linux-x86_64.tar.gz"
SMOLVM_URL_ARM64="https://github.com/smol-machines/smolvm/releases/download/v1.32.3/smolvm-1.32.3-linux-arm64.tar.gz"
SANDBOX_IMAGE="ghcr.io/reviewstage/luke-sandbox:ea78580d96ce7256@sha256:f6ff07bdc663c9173a856a713e4caa02a725eedd3da4aed0029c662e3b0b33a5"
# The most smolvm's seed folder may hold, handed to every smolvm run as the
# daemon hands it (SMOLVM_SEED_CAP in pins.ts): about three seeds of the image.
# smolvm evicts the least recently used seed no machine uses once it builds one
# past it, of any image, so another image the user ran may be pulled again.
SMOLVM_SEED_MAX_BYTES="9663676416"

ORIGIN="@@ORIGIN@@"
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
# The folder that stands where systemd runs the box; a test points it elsewhere.
SYSTEMD_RUN_DIR="${LUKE_HOST_SYSTEMD_RUN_DIR:-/run/systemd/system}"
# Whether the box is WSL2, which require_supported_os reads from /proc/version.
ON_WSL=false
# Whether this run stopped a running luke-host.service to swap its files.
STOPPED_SERVICE=false
# The daemon exits with this (EX_CONFIG) where its smolvm is not the pinned
# release, and the unit leaves it stopped rather than start it over.
EXIT_REFUSED=78
# How long the script waits for the service's first word with Luke: its first
# start fetches the pinned Claude Code before it registers.
CONNECT_WAIT_SECONDS=300
# How long a Mac's install waits for its running LaunchAgent to stop before it
# swaps the release; a test points it at none.
MAC_STOP_WAIT_SECONDS="${LUKE_HOST_MAC_STOP_WAIT_SECONDS:-30}"
# How long fetching the sandbox image may take.
IMAGE_WAIT_SECONDS=1800
# A Mac's install, under the home of the user it is for: its LaunchAgent, by its
# label, the folder holding the release and its state, and its logs.
# `luke-host uninstall` names the three too.
MAC_LABEL="dev.reviewstage.luke.host.standalone"
MAC_APP_FOLDER="Library/Application Support/Luke Host"
MAC_LOG_FOLDER="Library/Logs/Luke Host"
# The oldest macOS it installs on: the release's launcher reads its own path
# with readlink -f, which macOS has had since 12.3, and smolvm needs macOS 11.
MAC_MIN_VERSION="12.3"
# The throwaway machine the boot check makes; every agent's is named luke-<id>,
# so this one never collides with one.
BOOT_MACHINE="install-boot-check"
# The workload and user every agent's machine is made with (smolvm-sandbox.ts).
BOOT_WORKLOAD='while true; do sleep 3600; done'
BOOT_WORKLOAD_USER="0:0"
# How long each step of the boot check may take, the image already fetched.
BOOT_WAIT_SECONDS=180
# How long stopping or deleting the throwaway machine may take.
BOOT_CLEANUP_SECONDS=60
# How long a command `timeout` signalled, at its deadline or on an interrupt it
# was handed, has to end before `timeout` kills it.
TIMEOUT_KILL_SECONDS=10

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
    if [ "$ON_WSL" = true ]; then
      printf '  Under WSL2 on Windows 11, turn on nested virtualization: [wsl2] nestedVirtualization=true in %%UserProfile%%\\.wslconfig, then wsl --shutdown.\n'
    else
      printf '  On a cloud VM, turn on nested virtualization or pick a bare-metal instance;\n'
      printf '  on a box of your own, turn on VT-x or AMD-V in its BIOS or UEFI settings.\n'
    fi
  } >&2
  exit 1
}

# Refuses a box not run by systemd, which the daemon's service needs, saying
# under WSL how to turn it on.
require_systemd() {
  command -v systemctl >/dev/null 2>&1 && [ -d "$SYSTEMD_RUN_DIR" ] && return 0
  if [ "$ON_WSL" = true ]; then
    fail "Luke host needs systemd. Turn it on with [boot] systemd=true in /etc/wsl.conf, run wsl --shutdown in Windows, and run this again."
  fi
  fail "Luke host needs systemd."
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

# Fails with why ($1), luke-host not started by this run. A service this run
# stopped to swap its files is started again on the box's enrollment, so a
# failed upgrade leaves it serving rather than offline; one stopped before the
# run stays stopped.
fail_unstarted() {
  [ "$STOPPED_SERVICE" = true ] || fail "$1. Luke host was not started."
  # Note that the unit is rewritten first, since the daemon just installed refuses to run under the previous release's, which names no smolvm.
  write_unit
  systemctl restart "$UNIT" ||
    fail "$1. $UNIT could not be started again either; see journalctl -u $UNIT."
  fail "$1. $UNIT was restarted on this box's existing enrollment."
}

# Runs smolvm as the luke-host user, in its home, as the daemon's service does,
# replacing the shell it runs in, so it is run in a subshell or in the
# background, where the shell's pid is the command's: $@ smolvm's arguments,
# after a timeout command and its seconds where $1 is --within <seconds>.
smolvm_exec() {
  limit=""
  if [ "$1" = "--within" ]; then
    command -v timeout >/dev/null 2>&1 && limit="timeout -k $TIMEOUT_KILL_SECONDS $2"
    shift 2
  fi
  cd "$HOST_HOME" && exec runuser -u "$HOST_USER" -- env \
    -u XDG_DATA_HOME -u XDG_CACHE_HOME -u XDG_CONFIG_HOME HOME="$HOST_HOME" \
    SMOLVM_IMAGE_SEED_MAX_BYTES="$SMOLVM_SEED_MAX_BYTES" \
    $limit "$SMOLVM" "$@"
}

# smolvm_exec in a subshell, as an ordinary command: it returns what smolvm did.
smolvm_as_host() {
  (smolvm_exec "$@")
}

# The last line smolvm printed in the file $1, or that it timed out where it
# exited $2 124, the timeout command's code.
smolvm_said() {
  if [ "$2" -eq 124 ]; then
    printf 'timed out'
    return 0
  fi
  last="$(grep -v '^[[:space:]]*$' "$1" | tail -n 1)"
  printf '%s' "${last:-exited $2}"
}

# Fetches Luke's sandbox image, about 1.3 GB, by smolvm's own documented way:
# a run of the image, which keeps the image for every VM after it.
fetch_sandbox_image() {
  printf 'Fetching the sandbox image (about 1.3 GB), so the first agent does not wait for it...\n'
  said="$work/image-said"
  code=0
  smolvm_as_host --within "$IMAGE_WAIT_SECONDS" machine run --net --image "$SANDBOX_IMAGE" -- true \
    >/dev/null 2>"$said" || code=$?
  if [ "$code" -ne 0 ]; then
    why="$(smolvm_said "$said" "$code")"
    fail_unstarted "Could not fetch the sandbox image (smolvm: $why)"
  fi
  ok "Fetched the sandbox image"
}

# Stops and deletes the boot check's machine, whatever it was left in, stopping
# it at once where a graceful stop fails, as the daemon does; fails where it
# could not be deleted, with what smolvm said written to the file $1.
remove_boot_machine() {
  smolvm_as_host --within "$BOOT_CLEANUP_SECONDS" machine stop --name "$BOOT_MACHINE" >/dev/null 2>&1 ||
    smolvm_as_host --within "$BOOT_CLEANUP_SECONDS" machine stop --name "$BOOT_MACHINE" --timeout 0 \
      >/dev/null 2>&1 || true
  smolvm_as_host --within "$BOOT_CLEANUP_SECONDS" machine delete --name "$BOOT_MACHINE" -f >/dev/null 2>"$1"
}

# The boot check's smolvm command, $@ as smolvm_as_host takes them, run in the
# background and waited for, so a signal the script traps is handled the moment
# it comes rather than once the command ends. It returns what smolvm did, and
# $boot_job is its pid while it runs, which is smolvm_exec's own: the command
# replaces the job's shell.
boot_run() {
  boot_status=0
  smolvm_exec "$@" &
  boot_job=$!
  wait "$boot_job" || boot_status=$?
  boot_job=""
  return "$boot_status"
}

# What an interrupt (INT or TERM) during the boot check does: ends the step in
# flight, deletes the boot check's machine, and fails like any other failure of
# the check, so a service this run stopped is started again. Note that a trap
# is the one thing here that holds: `timeout` runs its command in a process
# group of its own so that it can kill the whole group at the deadline, which
# is also why a terminal's Ctrl-C never reaches the command and a signal sent
# to this script alone is not passed on; `timeout --foreground` would give up
# that group kill to change the first and still leave the second, and neither
# would delete the machine.
boot_interrupted() {
  trap - INT TERM
  # Note that the step is waited out before the machine goes, since a create still finishing after the delete would leave the machine behind; `timeout` ends only once smolvm has, killing it after TIMEOUT_KILL_SECONDS where it ignores the TERM it is relayed.
  if [ -n "$boot_job" ]; then
    kill "$boot_job" 2>/dev/null || true
    wait "$boot_job" 2>/dev/null || true
  fi
  remove_boot_machine "$removal" || true
  fail_unstarted "The VM boot check was interrupted"
}

# Proves a VM boots before anything is started: one throwaway machine made from
# the pinned image as the daemon makes every agent's (smolvm-sandbox.ts), with
# the same smolvm, user and flags, nested where the box has $KVM_DEVICE on
# Linux, started, `true` run in it as luke-host, then stopped and deleted
# whether it booted, failed, or was interrupted. It fails with the step and
# smolvm's last line, and where the machine booted but could not be deleted.
require_vm_boots() {
  boot_nested=""
  if [ "$(uname -s)" = "Linux" ] && [ -e "$KVM_DEVICE" ]; then
    boot_nested="--nested"
  fi
  boot_user="$(id -u "$HOST_USER"):$(id -g "$HOST_USER")"
  # Note that the files are made in $work, so its EXIT trap removes them.
  said="$work/boot-said"
  removal="$work/boot-removal"
  boot_job=""
  trap boot_interrupted INT TERM
  # Note that one an interrupted run left behind is cleared first, so the name is free.
  remove_boot_machine "$removal" || true
  boot_step=create
  code=0
  boot_run --within "$BOOT_WAIT_SECONDS" machine create --name "$BOOT_MACHINE" \
    --image "$SANDBOX_IMAGE" --net --user "$BOOT_WORKLOAD_USER" $boot_nested \
    -- sh -c "$BOOT_WORKLOAD" >/dev/null 2>"$said" || code=$?
  if [ "$code" -eq 0 ]; then
    boot_step=start
    boot_run --within "$BOOT_WAIT_SECONDS" machine start --name "$BOOT_MACHINE" \
      >/dev/null 2>"$said" || code=$?
  fi
  if [ "$code" -eq 0 ]; then
    boot_step=exec
    boot_run --within "$BOOT_WAIT_SECONDS" machine exec --name "$BOOT_MACHINE" \
      --user "$boot_user" -- true >/dev/null 2>"$said" || code=$?
  fi
  removed=0
  remove_boot_machine "$removal" || removed=$?
  trap - INT TERM
  if [ "$code" -ne 0 ]; then
    why="$(smolvm_said "$said" "$code")"
    fail_unstarted "No VM booted (smolvm machine $boot_step: $why)"
  fi
  if [ "$removed" -ne 0 ]; then
    why="$(smolvm_said "$removal" "$removed")"
    fail_unstarted "A VM booted, but smolvm could not delete it (smolvm machine delete --name $BOOT_MACHINE: $why)"
  fi
  ok "Booted a VM from the sandbox image"
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

# Sets mac_user to the user a Mac's install is for, the one who ran the command
# under sudo, and refuses where there is none, as when root itself is logged in.
require_mac_user() {
  mac_user="${SUDO_USER:-}"
  if [ -z "$mac_user" ] || [ "$mac_user" = "root" ]; then
    fail "Run it with sudo from the Mac account its agents should run as, not as root: curl -fsSL $ORIGIN/install.sh | sudo sh -s -- --token <token>"
  fi
}

# Writes the LaunchAgent to $1: the release in $2 run as the user it is
# installed for, on the state folder $3, which a release build would otherwise
# take to be the desktop app's, logging to $4. It runs at login, and again after
# a crash but not after a clean exit, the daemon's answer to its host being
# removed in Luke. Note that there is no ProcessType, since a Background job's
# CPU and disk are throttled and its agents' VMs are work the member asked for.
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
		<string>$2/bin/luke-host</string>
		<string>run</string>
	</array>
	<key>EnvironmentVariables</key>
	<dict>
		<key>LUKE_HOST_STATE_ROOT</key>
		<string>$3</string>
	</dict>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>StandardOutPath</key>
	<string>$4</string>
	<key>StandardErrorPath</key>
	<string>$4</string>
</dict>
</plist>
PLIST_EOF
}

# Stops the LaunchAgent of the user whose uid is $1 and waits until launchd
# lists it no more, so no daemon of it is left writing under the files about to
# be swapped; refuses, having changed nothing, where it does not stop.
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
# uid is $1, where they are logged in; where they are not, says it starts at
# their next login. Answers whether it started.
start_launch_agent() {
  if launchctl print "gui/$1" >/dev/null 2>&1; then
    launchctl bootstrap "gui/$1" "$2" || fail "launchctl could not start $MAC_LABEL for this account."
    ok "Started $MAC_LABEL (starts at login)"
    return 0
  fi
  ok "Installed $MAC_LABEL, which starts at this account's next login"
  return 1
}

# Installs, enrolls and starts Luke host on an Apple silicon Mac, for the user
# who ran the command under sudo, with the token parsed below where there is one.
install_darwin() {
  require_mac_user
  home="$(dscl . -read "/Users/$mac_user" NFSHomeDirectory 2>/dev/null | sed -n 's/^NFSHomeDirectory: //p')"
  [ -n "$home" ] && [ -d "$home" ] || fail "Could not find $mac_user's home folder."
  uid="$(id -u "$mac_user")"
  group="$(id -gn "$mac_user")"
  app="$home/$MAC_APP_FOLDER"
  install="$app/luke-host"
  state="$app/state"
  logs="$home/$MAC_LOG_FOLDER"
  log="$logs/luke-host.log"
  agents="$home/Library/LaunchAgents"
  plist="$agents/$MAC_LABEL.plist"
  [ -n "$SHA256_DARWIN_ARM64" ] || fail "Luke host $VERSION has no release for macOS yet."
  if [ -z "$token" ] && [ ! -f "$state/device.json" ]; then
    fail "This Mac is not enrolled yet. Run the command from Settings › Hosts › Add hosts, with its --token."
  fi

  printf 'Luke host %s for darwin-arm64, for %s\n' "$VERSION" "$mac_user"
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  tarball="luke-host-$VERSION-darwin-arm64.tar.gz"
  download "$URL_DARWIN_ARM64" "$work/$tarball"
  check_sha256 "$work/$tarball" "$SHA256_DARWIN_ARM64"
  ok "Downloaded and checked $tarball (sha256 matches)"
  mkdir "$work/unpacked"
  tar -xzf "$work/$tarball" -C "$work/unpacked" || fail "Could not unpack $tarball"
  [ -x "$work/unpacked/luke-host/bin/luke-host" ] || fail "$tarball holds no luke-host."

  # Note that a running daemon is stopped, and gone, before its files are swapped, which stops every agent it runs, as on Linux.
  stop_launch_agent "$uid"
  mkdir -p "$app" "$logs" "$agents"
  chown "$mac_user:$group" "$agents"
  rm -rf "$install.new" "$install.old"
  mv "$work/unpacked/luke-host" "$install.new"
  if [ -d "$install" ]; then
    mv "$install" "$install.old"
  fi
  mv "$install.new" "$install"
  rm -rf "$install.old"
  # Note that the state is left as it stands, the user's since its enroll ran as them, so no walk of it meets a file a daemon takes away.
  chown "$mac_user:$group" "$app"
  chown -R "$mac_user:$group" "$install" "$logs"
  chmod 700 "$app"
  mkdir -p "$(dirname "$LINK")"
  ln -sf "$install/bin/luke-host" "$LINK"
  ok "Installed to $install"

  name="$(scutil --get ComputerName 2>/dev/null || hostname -s)"
  if [ -n "$token" ]; then
    # Note that the token goes in on stdin, never an argument another user could read.
    if ! enrolled="$(cd "$app" && printf '%s\n' "$token" | sudo -u "$mac_user" -H env LUKE_HOST_STATE_ROOT="$state" \
      "$install/bin/luke-host" enroll --name "$name" --origin "$ORIGIN")"; then
      if [ -f "$state/device.json" ] && [ -f "$plist" ]; then
        start_launch_agent "$uid" "$plist" >/dev/null || true
        fail "Not enrolled again: $install was upgraded and started again on this Mac's existing enrollment."
      fi
      exit 1
    fi
    ok "$enrolled"
  else
    ok "Kept this Mac's enrollment"
  fi

  write_launch_agent "$plist" "$install" "$state" "$log"
  chown "$mac_user:$group" "$plist"
  chmod 644 "$plist"
  before="$( (wc -l <"$log") 2>/dev/null | tr -d ' ')"
  [ -n "$before" ] || before=0
  if ! start_launch_agent "$uid" "$plist"; then
    printf '\n%s is enrolled, and Luke host starts on it when %s logs in.\n' "$name" "$mac_user"
  else
    waited=0
    connected=false
    while [ "$waited" -lt "$CONNECT_WAIT_SECONDS" ]; do
      if tail -n "+$((before + 1))" "$log" 2>/dev/null | grep -q "Connected to Luke"; then
        connected=true
        break
      fi
      sleep 2
      waited=$((waited + 2))
    done
    if [ "$connected" = true ]; then
      ok "Connected to Luke"
    else
      printf '! Not connected to Luke yet. Follow it with: tail -f "%s"\n' "$log"
    fi
    printf '\n%s is ready. Pick it under a task'"'"'s Runs on.\n' "$name"
  fi
  printf 'It runs while %s is logged in, so on a Mac nobody sits at, turn on automatic login for %s.\n' "$mac_user" "$mac_user"
  printf 'To upgrade later, run the same command without --token.\n'
  printf 'To remove it: sudo luke-host uninstall\n'
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
require_supported_os "$(uname -s)" "$(hardware_machine)" "$(cat /proc/version 2>/dev/null || true)"
if [ "$(uname -s)" = "Darwin" ]; then
  require_macos_version "$(sw_vers -productVersion 2>/dev/null || true)"
else
  require_kvm
fi
[ "$(id -u)" -eq 0 ] || fail "Run it as root: curl -fsSL $ORIGIN/install.sh | sudo sh -s -- --token <token>"
if [ "$(uname -s)" = "Darwin" ]; then
  install_darwin
  exit 0
fi
require_systemd
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
  STOPPED_SERVICE=true
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

# Note that both come before the box is enrolled, so a box that cannot boot a
# VM keeps its token for another try, and before the service is started.
fetch_sandbox_image
require_vm_boots

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

printf '\n%s is ready. Pick it under a task'"'"'s Runs on.\n' "$name"
printf 'To upgrade later, run the same command without --token.\n'
printf 'To remove it: sudo luke-host uninstall\n'
# Note that a systemd service does not keep a WSL distro up: WSL stops it about
# 15 seconds after its last window closes, unless instanceIdleTimeout is -1.
if [ "$ON_WSL" = true ]; then
  printf 'Under WSL, Windows stops %s about 15 seconds after its last WSL window closes: keep one open, or set [general] instanceIdleTimeout=-1 in %%UserProfile%%\\.wslconfig (WSL 2.5 or later).\n' "$UNIT"
fi
