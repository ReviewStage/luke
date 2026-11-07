#!/bin/sh
# vespin-host -- the host's one command: `uninstall` removes the host from Vespin and from the account it is installed in, with no sudo, with its service, its agents' folders, its state and its releases; every other command is the daemon's own (lib/vespin-host.mjs), run on the Node the release carries.
#
# Shipped as bin/vespin-host in every release tarball, a Mac's among them
# (scripts/release-layout.ts). The account install unpacks each release into
# ~/.local/share/vespin-host/versions/<version>, points
# ~/.local/share/vespin-host/current at the one that runs, and links
# ~/.local/bin/vespin-host to current/bin/vespin-host; its state root is
# ~/.local/state/vespin-host, and a systemd --user unit, vespin-host.service, or
# a LaunchAgent runs it.
set -eu

root="$(dirname "$(dirname "$(readlink -f "$0")")")"
# Where the account install puts the host, under the home of the account it
# runs as, by the names apps/web/install/install.sh gives them: the releases,
# the state root, the command's link, and on Linux the folder of its unit and
# the unit.
ACCOUNT_RELEASES=".local/share/vespin-host"
ACCOUNT_STATE=".local/state/vespin-host"
ACCOUNT_LINK=".local/bin/vespin-host"
ACCOUNT_UNIT_FOLDER=".config/systemd/user"
ACCOUNT_UNIT="vespin-host.service"
# Where a Mac's install puts its LaunchAgent and its log, under the home of the user it runs as.
MAC_LABEL="dev.vespin.host.standalone"
MAC_LOG_FOLDER="Library/Logs/Vespin Host"
# The daemon's record of the agents whose folder it made, an empty file named for each, in its state root (OWNED_FOLDER in packages/host/src/local-agent-state.ts).
OWNED_AGENTS="owned-agents"
# Every agent's folder, one per agent under its id, under the home (DEVICE_AGENT_FOLDER.ROOT in packages/features/src/device-agent-wire.ts).
AGENTS_FOLDER=".vespin/agents"

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
# reached to stop it.
remove_user_unit() {
  unit_file="$HOME/$ACCOUNT_UNIT_FOLDER/$ACCOUNT_UNIT"
  systemctl --user disable --now "$ACCOUNT_UNIT" >/dev/null 2>&1 || true
  # Note that is-active prints nothing where this account's systemd cannot be reached, as under su or sudo.
  standing="$(systemctl --user is-active "$ACCOUNT_UNIT" 2>/dev/null)" || true
  case "$standing" in
    inactive | failed | unknown) ;;
    "")
      if [ -e "$unit_file" ]; then
        printf 'Could not reach the systemd of %s to stop %s, so nothing was removed. Run this again from a login of that account, over SSH or at its console, rather than through su or sudo.\n' "$(id -un)" "$ACCOUNT_UNIT" >&2
        exit 1
      fi
      ;;
    *)
      printf 'Could not stop %s, so nothing was removed. Stop it with systemctl --user stop %s, then run this again.\n' "$ACCOUNT_UNIT" "$ACCOUNT_UNIT" >&2
      exit 1
      ;;
  esac
  [ -e "$unit_file" ] || return 0
  rm -f "$unit_file"
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  printf 'Stopped and removed %s.\n' "$unit_file"
}

# Boots out and removes the account's LaunchAgent and its log, refusing, with
# nothing removed, while it is still loaded.
remove_launch_agent() {
  plist="$HOME/Library/LaunchAgents/$MAC_LABEL.plist"
  agent="gui/$(id -u)/$MAC_LABEL"
  launchctl bootout "$agent" >/dev/null 2>&1 || true
  if launchctl print "$agent" >/dev/null 2>&1; then
    printf 'Could not stop Vespin host, so nothing was removed. Stop it with launchctl bootout %s, then run this again.\n' "$agent" >&2
    exit 1
  fi
  if [ -e "$plist" ]; then
    rm -f "$plist"
    printf 'Stopped and removed %s.\n' "$plist"
  fi
  if [ -e "$HOME/$MAC_LOG_FOLDER" ]; then
    rm -rf "${HOME:?}/$MAC_LOG_FOLDER"
    printf 'Removed %s.\n' "$HOME/$MAC_LOG_FOLDER"
  fi
}

# Removes the account install this release is, run as that account with no
# sudo: its service stopped and removed, then the folders of the agents its
# daemon made (~/.vespin/agents/<id>, by the record it keeps of them), its
# state root, its releases and its link, saying each. Before it changes
# anything it says that the agents' folders go, with any work in them that
# was not pushed, and asks to go on where a person runs it at a terminal.
# Note that ~/.vespin/clones stays, since every install for the account
# shares it, and so does a Linux account's lingering, said where it is on.
uninstall_account() {
  home="$1"
  if [ "$(readlink -f "${HOME:-/}")" != "$home" ]; then
    printf 'This Vespin host is installed in the account whose home is %s. Run ~/%s uninstall as that account, without sudo.\n' "$home" "$ACCOUNT_LINK" >&2
    exit 1
  fi
  agents=0
  for owned in "$HOME/$ACCOUNT_STATE/$OWNED_AGENTS"/*; do
    [ -e "$owned" ] && [ -e "$HOME/$AGENTS_FOLDER/${owned##*/}" ] || continue
    agents=$((agents + 1))
  done
  if [ "$agents" -gt 0 ]; then
    printf 'This removes the folders under %s of the agents Vespin host ran here (%s). Work in them that was not pushed goes with them.\n' "$HOME/$AGENTS_FOLDER" "$agents" >&2
    if [ -t 0 ]; then
      printf 'Remove Vespin host and those folders? [y/N] ' >&2
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
  kernel="$(uname -s)"
  case "$kernel" in
    Darwin) remove_launch_agent ;;
    *) remove_user_unit ;;
  esac
  # Note that the host leaves its account once its service has stopped and before its secret goes, so it leaves Settings › Hosts too, and that one whose service cannot be reached is still removed from the box, which says to remove it there.
  left=no
  if APP_HOST_STATE_ROOT="$HOME/$ACCOUNT_STATE" "$root/node/bin/node" "$root/lib/vespin-host.mjs" leave; then
    left=yes
  fi
  for owned in "$HOME/$ACCOUNT_STATE/$OWNED_AGENTS"/*; do
    [ -e "$owned" ] || continue
    folder="${HOME:?}/$AGENTS_FOLDER/${owned##*/}"
    [ -e "$folder" ] || continue
    rm -rf "$folder"
    printf 'Removed %s.\n' "$folder"
  done
  rmdir "${HOME:?}/$AGENTS_FOLDER" "${HOME:?}/.vespin" 2>/dev/null || true
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
  if [ -e "$HOME/.vespin/clones" ]; then
    printf 'Kept the clones in %s, which every Vespin install for this account shares.\n' "$HOME/.vespin/clones"
  fi
  # Note that lingering is left on, since another service of the account may need it to run while no one is logged in.
  if [ "$kernel" != Darwin ] && [ "$(loginctl show-user "$(id -un)" --property=Linger --value 2>/dev/null)" = yes ]; then
    printf 'Left lingering on for %s, since other services of this account may need it. Turn it off with: loginctl disable-linger\n' "$(id -un)"
  fi
  if [ "$left" = yes ]; then
    printf 'Vespin host is removed from this account and from Vespin.\n'
  else
    printf 'Vespin host is removed from this account. Remove it in Settings › Hosts too, if it is still listed.\n'
  fi
}

uninstall() {
  if ! home="$(account_home)"; then
    printf 'vespin-host uninstall removes an install the install script made, under ~/%s.\n' "$ACCOUNT_RELEASES" >&2
    exit 1
  fi
  uninstall_account "$home"
}

if [ "${1:-}" = "uninstall" ]; then
  uninstall
  exit 0
fi
# Note that the account install's state root is named here, so a command run by hand, a connect among them, reads and writes the record its service runs on.
if home="$(account_home)"; then
  APP_HOST_STATE_ROOT="${APP_HOST_STATE_ROOT:-$home/$ACCOUNT_STATE}"
  export APP_HOST_STATE_ROOT
fi
exec "$root/node/bin/node" "$root/lib/vespin-host.mjs" "$@"
