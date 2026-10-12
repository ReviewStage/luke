import { ACCOUNT_STATUS, type AccountSnapshot } from "@sidecar/credentials/snapshot";
import { GearIcon, KeyboardIcon, UpdateIcon, UserIcon } from "@sidecar/panel";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import {
  LifeBuoyIcon,
  LightbulbIcon,
  LogOutIcon,
  MailIcon,
  MessageSquareIcon,
  NewspaperIcon,
} from "lucide-react";
import { useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { UPDATE_STATUS } from "#shared/messages/update";
import { APP_COMMAND } from "#shared/shortcuts";
import { GitHubMark } from "../account-marks";
import { useAct } from "../act";
import { runAppCommand } from "../app-commands";
import { ConfirmDialog, DIALOG_TONE, useConfirmDialog } from "../settings/confirm-dialog";
import type { UpdateControl } from "../settings/controls";
import { Tooltip } from "../tooltip";
import { updateInSidebar, updateRow } from "../update-row";
import { ActionMenu, type MenuEntry, riseAbove, useActionMenu } from "./action-menu";

/**
 * sidebar-foot.tsx -- the sidebar's last row: who is signed in and their menu, a release on its way in, and Settings' gear.
 *
 * The row every desktop devtool keeps at the foot of its sidebar, the way
 * Cursor keeps it: the account's face and name at its start, which opens the
 * account's menu upward over the column, and the gear at its end, which goes
 * to Settings at once. A newer release stands between them as a small pill
 * while there is one, and takes no room while there is not. The menu offers
 * what the menu bar's Help menu offers, by the same commands, with Settings
 * at its head, the ways to reach the people who make Luke under it, and
 * Log out last, which asks first as Settings' Sign out does.
 */

/** Where Contact us > GitHub leads: Luke's own issues, where CONTRIBUTING.md sends bugs and feature requests. */
const ISSUES_URL = "https://github.com/ReviewStage/luke/issues";

/**
 * The account's face: the provider's photo when one travelled and loads,
 * otherwise the first letter of who it is, otherwise a person glyph while no
 * one is signed in. A photo that fails is remembered by its address for as
 * long as the sidebar stands, so a new address gets its own chance. Note that
 * we let a remount try the address again, because a failure is as often a
 * launch with no network as a dead link, and the empty `alt` means a retry
 * that fails again draws no broken-image glyph.
 */
function AccountAvatar({ account }: { account: AccountSnapshot }): React.JSX.Element {
  const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined);
  if (account.status !== ACCOUNT_STATUS.SIGNED_IN) {
    return (
      <span className="sidebar-avatar sidebar-avatar-neutral" aria-hidden="true">
        <UserIcon />
      </span>
    );
  }
  const { pictureUrl } = account;
  if (pictureUrl !== undefined && pictureUrl !== failedUrl) {
    return (
      <img
        className="sidebar-avatar"
        src={pictureUrl}
        alt=""
        referrerPolicy="no-referrer"
        draggable={false}
        onError={() => setFailedUrl(pictureUrl)}
      />
    );
  }
  return (
    <span className="sidebar-avatar" aria-hidden="true">
      {(account.name ?? account.email).slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * A newer release on its way in, between the account and the gear: a quiet
 * count while it downloads, then Update, the restart that installs it, which
 * is the very act Settings' Restart to update runs; or, once installing it
 * failed, the download from the releases page that Settings offers in its
 * place, its hint saying what went wrong. It draws nothing in any other
 * state, so the row carries no control with nothing to do, and it is the one
 * place outside Settings that says a release waits.
 */
function SidebarUpdate({ updates }: { updates: UpdateControl }): React.JSX.Element | null {
  const { update } = updates;
  if (!updateInSidebar(update)) return null;
  switch (update.status) {
    case UPDATE_STATUS.READY:
      return (
        <Tooltip label={`Luke ${update.latestVersion} is ready. Restart to update.`}>
          <button type="button" className="sidebar-update" onClick={updates.onInstall}>
            Update
          </button>
        </Tooltip>
      );
    case UPDATE_STATUS.DOWNLOADING:
      return (
        <Tooltip label={updateRow(update).detail}>
          <span className="sidebar-update sidebar-update-progress" role="status">
            <UpdateIcon />
            {update.progress ? `${Math.round(update.progress.percent)}%` : null}
          </span>
        </Tooltip>
      );
    default:
      return (
        <Tooltip label={updateRow(update).detail}>
          <button type="button" className="sidebar-update" onClick={updates.onOpenLatest}>
            Download
          </button>
        </Tooltip>
      );
  }
}

/** Who the menu is about, over its items: the account's name, and its email muted under it. */
function AccountHeading({
  account,
}: {
  account: Extract<AccountSnapshot, { status: typeof ACCOUNT_STATUS.SIGNED_IN }>;
}): React.JSX.Element {
  return (
    <>
      {account.name === undefined ? null : (
        <span className="account-menu-name">{account.name}</span>
      )}
      <span className="account-menu-email">{account.email}</span>
    </>
  );
}

/**
 * The account's menu, in Cursor's order: Settings; what the Help menu
 * offers, the changelog before it, and the ways to write to the people who
 * make Luke after it; then Log out, while anyone is signed in to leave.
 */
function accountMenuGroups(
  signedIn: boolean,
  acts: {
    onSettings: () => void;
    onOpenChangelog: () => void;
    onOpenIssues: () => void;
    onEmail: () => void;
    onLogOut: () => void;
  },
): MenuEntry[][] {
  const groups: MenuEntry[][] = [
    [
      {
        label: "Settings",
        icon: <GearIcon />,
        command: APP_COMMAND.SETTINGS,
        onSelect: acts.onSettings,
      },
    ],
    [
      { label: "Changelog", icon: <NewspaperIcon />, onSelect: acts.onOpenChangelog },
      {
        label: "Send feedback…",
        icon: <MessageSquareIcon />,
        onSelect: () => runAppCommand(APP_COMMAND.SEND_FEEDBACK),
      },
      {
        label: "Suggest a feature…",
        icon: <LightbulbIcon />,
        onSelect: () => runAppCommand(APP_COMMAND.SUGGEST_FEATURE),
      },
      {
        label: "Keyboard shortcuts",
        icon: <KeyboardIcon />,
        command: APP_COMMAND.KEYBOARD_SHORTCUTS,
        onSelect: () => runAppCommand(APP_COMMAND.KEYBOARD_SHORTCUTS),
      },
      {
        label: "Contact us",
        icon: <LifeBuoyIcon />,
        items: [
          { label: "GitHub", icon: <GitHubMark />, onSelect: acts.onOpenIssues },
          { label: "Email", icon: <MailIcon />, onSelect: acts.onEmail },
        ],
      },
    ],
  ];
  if (signedIn) groups.push([{ label: "Log out", icon: <LogOutIcon />, onSelect: acts.onLogOut }]);
  return groups;
}

/**
 * The foot's account button and the menu it raises. Log out asks first, in a
 * dialog over the window, as Settings' Sign out asks in its row: getting back
 * in costs a whole trip through the browser.
 */
function AccountMenu({
  account,
  shown,
  onSettings,
  onSignOut,
}: {
  account: AccountSnapshot;
  shown: boolean;
  onSettings: () => void;
  onSignOut: () => Promise<void>;
}): React.JSX.Element {
  const { tell } = useAct();
  const signedIn = account.status === ACCOUNT_STATUS.SIGNED_IN;
  const { open, show, close } = useActionMenu(shown);
  const logOut = useConfirmDialog(
    { subject: signedIn, surfaceOpen: shown },
    // A sign-out main refused keeps the dialog up saying so, rather than
    // closing on an account still signed in.
    async (): Promise<ActionResult> => {
      try {
        await onSignOut();
        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      } catch {
        return {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: "Luke could not log out, so you are still signed in. Try again in a moment.",
        };
      }
    },
  );
  const groups = accountMenuGroups(signedIn, {
    onSettings,
    onOpenChangelog: () => tell(ACT_KIND.UPDATE_OPEN_CHANGELOG),
    onOpenIssues: () => tell(ACT_KIND.GITHUB_OPEN, { url: ISSUES_URL }),
    onEmail: () => tell(ACT_KIND.CONTACT_EMAIL),
    onLogOut: logOut.ask,
  });
  return (
    <>
      <button
        type="button"
        className="sidebar-item sidebar-account"
        aria-haspopup="menu"
        aria-expanded={open !== undefined}
        onClick={(event) => {
          if (open !== undefined) {
            close(true);
            return;
          }
          show(riseAbove(event.currentTarget), event.currentTarget);
        }}
      >
        <AccountAvatar account={account} />
        <span className="sidebar-account-name">
          {signedIn ? (account.name ?? account.email) : "Not signed in"}
        </span>
      </button>
      {open === undefined ? null : (
        <ActionMenu
          label="Account"
          menu={open}
          heading={signedIn ? <AccountHeading account={account} /> : undefined}
          groups={groups}
          onClose={close}
        />
      )}
      <ConfirmDialog
        confirm={logOut}
        question={{
          title: signedIn ? `Log out of ${account.email}?` : "Log out?",
          body: "Your plans stay with your account. Signing back in takes a trip through the browser.",
          verb: "Log out",
          running: "Logging out",
          tone: DIALOG_TONE.PRIMARY,
        }}
      />
    </>
  );
}

/**
 * The foot of the column: the account, which opens its menu; a release on
 * its way in, while there is one; and the gear, the one press to Settings.
 */
export function SidebarFoot({
  account,
  updates,
  shown,
  settingsOpen,
  onSettings,
  onSignOut,
}: {
  account: AccountSnapshot;
  updates: UpdateControl;
  /** Whether the sidebar is in sight; folded away, nothing it opened stands over the window. */
  shown: boolean;
  /** Whether Settings is the page on show, which the gear marks. */
  settingsOpen: boolean;
  onSettings: () => void;
  onSignOut: () => Promise<void>;
}): React.JSX.Element {
  return (
    <div className="sidebar-account-row">
      <AccountMenu account={account} shown={shown} onSettings={onSettings} onSignOut={onSignOut} />
      <SidebarUpdate updates={updates} />
      <Tooltip label="Settings" command={APP_COMMAND.SETTINGS}>
        <button
          type="button"
          className="icon-button sidebar-settings"
          aria-label="Settings"
          aria-current={settingsOpen ? "page" : undefined}
          onClick={onSettings}
        >
          <GearIcon />
        </button>
      </Tooltip>
    </div>
  );
}
