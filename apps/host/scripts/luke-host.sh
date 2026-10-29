#!/bin/sh
# luke-host -- the host's one command: `uninstall` removes Luke's host as root, from a Linux box with the smolvm the install script put beside it and, with the luke-host user's home, smolvm's state and every machine left behind, or from a Mac for the user who runs it under sudo, with its LaunchAgent, its folder, its logs, its agents' machines, and its agents' folders under ~/.luke/agents; every other command is the daemon's own (lib/luke-host.mjs), run on the Node the release carries.
#
# Shipped as bin/luke-host in every release tarball, a Mac's among them
# (scripts/package.ts), and linked from /usr/local/bin by the install script.
set -eu

root="$(dirname "$(dirname "$(readlink -f "$0")")")"
HOST_USER="luke-host"
UNIT="luke-host.service"
SMOLVM_DIR="/opt/luke-smolvm"
# Where a Mac's install put Luke host, under the home of the user it runs as, by
# the names apps/web/install/install.sh gives them.
MAC_LABEL="dev.reviewstage.luke.host.standalone"
MAC_APP_FOLDER="Library/Application Support/Luke Host"
MAC_LOG_FOLDER="Library/Logs/Luke Host"
# The Luke app's own state, whose device.json means its This Mac runs agents for the user, in the ~/.luke/agents folder that both share.
MAC_APP_STATE_FOLDER="Library/Application Support/Luke"

# Removes a Mac's install for the user who ran the command under sudo: its
# LaunchAgent booted out, which stops the daemon and every agent's VM with it,
# then each agent's machine deleted, and its LaunchAgent, folder (the release
# and the Mac's secret) and logs removed, with the agents' folders
# (~/.luke/agents), which stand under the user's home rather than the install's
# folder. Note that ~/.luke/clones and ~/.luke/worktrees stay, since every Luke
# install on the Mac shares them, the desktop app's own repositories among them.
# Note that the machines are smolvm's, kept in the user's own smolvm store rather than the
# state, so each is deleted by name, with the smolvm the daemon fetched, before
# the state goes; smolvm's cache of the sandbox image stays with that store.
# Note that the agents' folders are the Luke app's too, so they are left where
# its own state stands for this user, which the install refuses beside this one.
uninstall_darwin() {
  if [ "$(id -u)" -ne 0 ]; then
    printf 'Run it as root: sudo luke-host uninstall\n' >&2
    exit 1
  fi
  user="${SUDO_USER:-}"
  if [ -z "$user" ] || [ "$user" = "root" ]; then
    printf 'Run it with sudo from the Mac account Luke host was installed for: sudo luke-host uninstall\n' >&2
    exit 1
  fi
  home="$(dscl . -read "/Users/$user" NFSHomeDirectory 2>/dev/null | sed -n 's/^NFSHomeDirectory: //p')"
  if [ -z "$home" ]; then
    printf 'Could not find the home folder of %s.\n' "$user" >&2
    exit 1
  fi
  app="$home/$MAC_APP_FOLDER"
  agent="gui/$(id -u "$user")/$MAC_LABEL"
  launchctl bootout "$agent" >/dev/null 2>&1 || true
  # Note that nothing is removed while the LaunchAgent is still loaded, since its daemon and its agents' runners would run on with their folders gone.
  if launchctl print "$agent" >/dev/null 2>&1; then
    printf 'Could not stop Luke host for %s, so nothing was removed. Stop it with launchctl bootout %s, then run this again.\n' "$user" "$agent" >&2
    exit 1
  fi
  rm -f "$home/Library/LaunchAgents/$MAC_LABEL.plist"
  for smolvm in "$app"/state/agent-tools/smolvm/*/smolvm; do
    [ -x "$smolvm" ] || continue
    sudo -u "$user" -H "$smolvm" machine ls -q 2>/dev/null | while IFS= read -r machine; do
      case "$machine" in
        luke-*) sudo -u "$user" -H "$smolvm" machine delete --name "$machine" -f >/dev/null 2>&1 || true ;;
      esac
    done
  done
  # Note that the link is read as the install wrote it, before its target goes, since a link to nothing resolves to nothing.
  if [ "$(readlink /usr/local/bin/luke-host 2>/dev/null)" = "$app/luke-host/bin/luke-host" ]; then
    rm -f /usr/local/bin/luke-host
  fi
  rm -rf "$app" "$home/$MAC_LOG_FOLDER"
  if [ -e "$home/$MAC_APP_STATE_FOLDER/device.json" ]; then
    printf 'The Luke app runs agents on this Mac for %s too, so ~/.luke/agents was left in place.\n' "$user"
  else
    rm -rf "${home:?}/.luke/agents"
    rmdir "$home/.luke" 2>/dev/null || true
  fi
  printf 'Luke host is removed from this Mac for %s. Remove it in Settings › Hosts too, if it is still listed.\n' "$user"
}

uninstall() {
  case "$(uname -s)" in
    Linux) ;;
    Darwin)
      uninstall_darwin
      return
      ;;
    *)
      printf 'luke-host uninstall removes Luke host from a Linux box or a Mac only.\n' >&2
      exit 1
      ;;
  esac
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
# Note that the runner is named as the release's own, since a Mac daemon's default is the desktop app's copy beside its release, which a tarball has no sibling for.
LUKE_HOST_RUNNER_FOLDER="${LUKE_HOST_RUNNER_FOLDER:-$root/lib}"
export LUKE_HOST_RUNNER_FOLDER
exec "$root/node/bin/node" "$root/lib/luke-host.mjs" "$@"
