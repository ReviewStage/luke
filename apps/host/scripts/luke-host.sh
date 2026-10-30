#!/bin/sh
# luke-host -- the host's one command: `uninstall` removes Luke host from the account it is installed in, with no sudo, with its service, its agents' folders, its state and its releases; or, for an install that came before, as root, from a Linux box with the smolvm the install script put beside it and, with the luke-host user's home, smolvm's state and every machine left behind, or from a Mac for the user who runs it under sudo, with its LaunchAgent, its folder, its logs, and the machines and folders of the agents it made, by the record its daemon keeps of them; every other command is the daemon's own (lib/luke-host.mjs), run on the Node the release carries.
#
# Shipped as bin/luke-host in every release tarball, a Mac's among them
# (scripts/package.ts). The account install unpacks each release into
# ~/.local/share/luke-host/versions/<version>, points
# ~/.local/share/luke-host/current at the one that runs, and links
# ~/.local/bin/luke-host to current/bin/luke-host; its state root is
# ~/.local/state/luke-host, and a systemd --user unit or a LaunchAgent runs it.
# An install that came before put the release in /opt/luke-host, or on a Mac
# in ~/Library/Application Support/Luke Host, linked from /usr/local/bin.
set -eu

root="$(dirname "$(dirname "$(readlink -f "$0")")")"
HOST_USER="luke-host"
UNIT="luke-host.service"
SMOLVM_DIR="/opt/luke-smolvm"
# Where the account install puts Luke host, under the home of the account it
# runs as, by the names apps/web/install/install.sh gives them: the releases,
# the state root, the command's link, and on Linux the folder of its unit.
ACCOUNT_RELEASES=".local/share/luke-host"
ACCOUNT_STATE=".local/state/luke-host"
ACCOUNT_LINK=".local/bin/luke-host"
ACCOUNT_UNIT_FOLDER=".config/systemd/user"
# Where a Mac's install puts its LaunchAgent and its log, under the home of the user it runs as.
MAC_LABEL="dev.reviewstage.luke.host.standalone"
MAC_LOG_FOLDER="Library/Logs/Luke Host"
# Where a Mac's install that came before put Luke host, under the home of the user it ran as.
MAC_APP_FOLDER="Library/Application Support/Luke Host"
# The daemon's record of the agents whose folder and VM it made, an empty file named for each, in its state root (OWNED_FOLDER in packages/host/src/local-agent-state.ts).
OWNED_AGENTS="owned-agents"
# Every agent's folder, one per agent under its id, under the home (DEVICE_AGENT_FOLDER.ROOT in packages/features/src/device-agent-wire.ts).
AGENTS_FOLDER=".luke/agents"

# The home of the account whose install this release is, where it is one: the
# release stands in a version folder of that home's releases.
account_home() {
  case "$root" in
    */"$ACCOUNT_RELEASES"/versions/*) printf '%s\n' "${root%/"$ACCOUNT_RELEASES"/versions/*}" ;;
    *) return 1 ;;
  esac
}

# Stops and removes the account's systemd --user unit, refusing, with nothing
# removed, while it still runs or while this account's systemd cannot be
# reached to stop the unit it holds.
remove_user_unit() {
  unit_file="$HOME/$ACCOUNT_UNIT_FOLDER/$UNIT"
  systemctl --user disable --now "$UNIT" >/dev/null 2>&1 || true
  # Note that is-active prints nothing where this account's systemd cannot be reached, as under su or sudo.
  standing="$(systemctl --user is-active "$UNIT" 2>/dev/null)" || true
  case "$standing" in
    inactive | failed | unknown) ;;
    "")
      if [ -e "$unit_file" ]; then
        printf 'Could not reach the systemd of %s to stop %s, so nothing was removed. Run this again from a login of that account, over SSH or at its console, rather than through su or sudo.\n' "$(id -un)" "$UNIT" >&2
        exit 1
      fi
      ;;
    *)
      printf 'Could not stop %s, so nothing was removed. Stop it with systemctl --user stop %s, then run this again.\n' "$UNIT" "$UNIT" >&2
      exit 1
      ;;
  esac
  if [ -e "$unit_file" ]; then
    rm -f "$unit_file"
    systemctl --user daemon-reload >/dev/null 2>&1 || true
    printf 'Stopped and removed %s.\n' "$unit_file"
  fi
}

# Boots out and removes the account's LaunchAgent and its log, refusing, with
# nothing removed, while it is still loaded. Note that a Mac's install that
# came before wrote its LaunchAgent under the same label, so one that runs
# another install's release is left as it stands.
remove_launch_agent() {
  plist="$HOME/Library/LaunchAgents/$MAC_LABEL.plist"
  if [ -e "$plist" ] && ! grep -qF "$HOME/$ACCOUNT_RELEASES/" "$plist"; then
    return
  fi
  agent="gui/$(id -u)/$MAC_LABEL"
  launchctl bootout "$agent" >/dev/null 2>&1 || true
  if launchctl print "$agent" >/dev/null 2>&1; then
    printf 'Could not stop Luke host, so nothing was removed. Stop it with launchctl bootout %s, then run this again.\n' "$agent" >&2
    exit 1
  fi
  if [ -e "$plist" ]; then
    rm -f "$plist"
    printf 'Stopped and removed %s.\n' "$plist"
  fi
  if [ ! -e "$HOME/$MAC_APP_FOLDER" ] && [ -e "$HOME/$MAC_LOG_FOLDER" ]; then
    rm -rf "${HOME:?}/$MAC_LOG_FOLDER"
    printf 'Removed %s.\n' "$HOME/$MAC_LOG_FOLDER"
  fi
}

# Removes the account install this release is, run as that account with no
# sudo: its service stopped and removed, then the folders of the agents its
# daemon made (~/.luke/agents/<id>, by the record it keeps of them), its
# state root, its releases and its link, saying each. Before it changes
# anything it says that the agents' folders go, with any work in them that
# was not pushed, and asks to go on where a person runs it at a terminal.
# Note that ~/.luke/clones stays, since every Luke install for the account
# shares it, and so does an install that came before, under /opt or a Mac's
# Application Support, which is removed with its own sudo luke-host
# uninstall, said where one stands.
uninstall_account() {
  home="$1"
  if [ "$(readlink -f "${HOME:-/}")" != "$home" ]; then
    printf 'This Luke host is installed in the account whose home is %s. Run luke-host uninstall as that account, without sudo.\n' "$home" >&2
    exit 1
  fi
  agents=0
  for owned in "$HOME/$ACCOUNT_STATE/$OWNED_AGENTS"/*; do
    [ -e "$owned" ] && [ -e "$HOME/$AGENTS_FOLDER/${owned##*/}" ] || continue
    agents=$((agents + 1))
  done
  if [ "$agents" -gt 0 ]; then
    printf 'This removes the folders under %s of the agents Luke host ran here (%s). Work in them that was not pushed goes with them.\n' "$HOME/$AGENTS_FOLDER" "$agents" >&2
    if [ -t 0 ]; then
      printf 'Remove Luke host and those folders? [y/N] ' >&2
      read -r go_on || go_on=""
      case "$go_on" in
        y | Y | yes | Yes | YES) ;;
        *)
          printf 'Nothing was removed.\n' >&2
          exit 1
          ;;
      esac
    fi
  fi
  case "$(uname -s)" in
    Darwin) remove_launch_agent ;;
    *) remove_user_unit ;;
  esac
  for owned in "$HOME/$ACCOUNT_STATE/$OWNED_AGENTS"/*; do
    [ -e "$owned" ] || continue
    folder="${HOME:?}/$AGENTS_FOLDER/${owned##*/}"
    [ -e "$folder" ] || continue
    rm -rf "$folder"
    printf 'Removed %s.\n' "$folder"
  done
  rmdir "${HOME:?}/$AGENTS_FOLDER" "${HOME:?}/.luke" 2>/dev/null || true
  for folder in "${HOME:?}/$ACCOUNT_STATE" "${HOME:?}/$ACCOUNT_RELEASES"; do
    [ -e "$folder" ] || continue
    rm -rf "$folder"
    printf 'Removed %s.\n' "$folder"
  done
  # Note that the link is read as the install wrote it, since its target is gone by now and a link to nothing resolves to nothing.
  link="$HOME/$ACCOUNT_LINK"
  case "$(readlink "$link" 2>/dev/null)" in
    "$HOME/$ACCOUNT_RELEASES"/* | "$home/$ACCOUNT_RELEASES"/*)
      rm -f "$link"
      printf 'Removed %s.\n' "$link"
      ;;
  esac
  if [ -e "$HOME/.luke/clones" ]; then
    printf 'Kept the clones in %s, which every Luke install for this account shares.\n' "$HOME/.luke/clones"
  fi
  if [ -e /opt/luke-host ] || [ -e "/etc/systemd/system/$UNIT" ]; then
    printf 'Left the install of Luke host under /opt/luke-host as it stands. Remove it with: sudo /opt/luke-host/bin/luke-host uninstall\n'
  fi
  if [ -e "$HOME/$MAC_APP_FOLDER" ]; then
    printf "Left the install of Luke host in %s as it stands. Remove it with: sudo '%s' uninstall\n" "$HOME/$MAC_APP_FOLDER" "$HOME/$MAC_APP_FOLDER/luke-host/bin/luke-host"
  fi
  printf 'Luke host is removed from this account. Remove it in Settings › Hosts too, if it is still listed.\n'
}

# Removes a Mac's install for the user who ran the command under sudo: its
# LaunchAgent booted out, which stops the daemon and every agent's VM with it,
# then each of its agents' machine deleted and folder (~/.luke/agents/<id>)
# removed, and its LaunchAgent, folder (the release and the Mac's secret) and
# logs removed. Note that ~/.luke/clones and ~/.luke/worktrees stay, since every
# Luke install on the Mac shares them, the desktop app's own repositories among
# them.
# Note that the machines are smolvm's, kept in the user's own smolvm store rather than the
# state, so each is deleted by name, with the smolvm the daemon fetched, before
# the state goes; smolvm's cache of the sandbox image stays with that store.
# Note that the store and ~/.luke/agents are shared with every Luke app profile
# whose This Mac runs beside this install, so only the agents the daemon's
# record names are removed, and ~/.luke/agents and ~/.luke only where nothing
# else stands in them.
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
  for owned in "$app/state/$OWNED_AGENTS"/*; do
    [ -e "$owned" ] || continue
    id="${owned##*/}"
    for smolvm in "$app"/state/agent-tools/smolvm/*/smolvm; do
      [ -x "$smolvm" ] || continue
      sudo -u "$user" -H "$smolvm" machine delete --name "luke-$id" -f >/dev/null 2>&1 || true
    done
    rm -rf "${home:?}/.luke/agents/$id"
  done
  # Note that the link is read as the install wrote it, before its target goes, since a link to nothing resolves to nothing.
  if [ "$(readlink /usr/local/bin/luke-host 2>/dev/null)" = "$app/luke-host/bin/luke-host" ]; then
    rm -f /usr/local/bin/luke-host
  fi
  rm -rf "$app" "$home/$MAC_LOG_FOLDER"
  rmdir "$home/.luke/agents" "$home/.luke" 2>/dev/null || true
  printf 'Luke host is removed from this Mac for %s. Remove it in Settings › Hosts too, if it is still listed.\n' "$user"
}

uninstall() {
  if home="$(account_home)"; then
    uninstall_account "$home"
    return
  fi
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
# Note that the account install's state root is named here, so a command run by hand, a connect among them, reads and writes the record its service runs on.
if home="$(account_home)"; then
  LUKE_HOST_STATE_ROOT="${LUKE_HOST_STATE_ROOT:-$home/$ACCOUNT_STATE}"
  export LUKE_HOST_STATE_ROOT
fi
exec "$root/node/bin/node" "$root/lib/luke-host.mjs" "$@"
