import { ACCOUNT_STATUS, type AccountSnapshot } from "@sidecar/credentials/snapshot";
import { INTEGRATION_PROVIDER } from "@sidecar/hosted/integration-wire";
import { ExternalIcon, GearIcon, KeyboardIcon, UpdateIcon, UserIcon } from "@sidecar/panel";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import {
  LifeBuoyIcon,
  LightbulbIcon,
  LogOutIcon,
  MailIcon,
  MessageSquareIcon,
  NewspaperIcon,
} from "lucide-react";
import { ACT_KIND } from "#shared/messages/acts";
import { UPDATE_STATUS } from "#shared/messages/update";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAct } from "../act";
import { runAppCommand } from "../app-commands";
import { PersonAvatar } from "../person-avatar";
import { ProviderMark } from "../provider-marks";
import { ConfirmDialog, DIALOG_TONE, useConfirmDialog } from "../settings/confirm-dialog";
import type { UpdateControl } from "../settings/controls";
import { Tooltip } from "../tooltip";
import { updateInSidebar } from "../update-row";
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

/** The account's face: the signed-in person's (`person-avatar.tsx`), or a person glyph while no one is signed in. */
function AccountAvatar({ account }: { account: AccountSnapshot }): React.JSX.Element {
  if (account.status !== ACCOUNT_STATUS.SIGNED_IN) {
    return (
      <span className="sidebar-avatar sidebar-avatar-neutral" aria-hidden="true">
        <UserIcon />
      </span>
    );
  }
  return <PersonAvatar name={account.name ?? account.email} pictureUrl={account.pictureUrl} />;
}

/**
 * A newer release with something to press, between the account and the
 * gear: Restart, the very act Settings' Restart to update runs, once the
 * release is downloaded; or, once installing it failed, the download from
 * the releases page that Settings offers in its place, in the failure's red,
 * its hint saying what went wrong. One word each, so the account's name
 * keeps its room. It draws nothing in any other state, so the row carries no
 * control with nothing to do.
 */
function SidebarUpdate({ updates }: { updates: UpdateControl }): React.JSX.Element | null {
  const { update } = updates;
  if (!updateInSidebar(update)) return null;
  if (update.status === UPDATE_STATUS.READY) {
    return (
      <Tooltip label={`Restart to update to ${update.latestVersion}`}>
        <button type="button" className="sidebar-update" onClick={updates.onInstall}>
          <UpdateIcon />
          Restart
        </button>
      </Tooltip>
    );
  }
  // The sidebar carries a failure only once a release was named.
  if (update.status !== UPDATE_STATUS.ERROR || update.latestVersion === undefined) return null;
  return (
    <Tooltip label={`Couldn't install ${update.latestVersion}. Download it from GitHub.`}>
      <button
        type="button"
        className="sidebar-update"
        data-failed="true"
        onClick={updates.onOpenLatest}
      >
        Download
        <ExternalIcon />
      </button>
    </Tooltip>
  );
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
        label: "Send feedback",
        icon: <MessageSquareIcon />,
        onSelect: () => runAppCommand(APP_COMMAND.SEND_FEEDBACK),
      },
      {
        label: "Suggest a feature",
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
          {
            label: "GitHub",
            icon: <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />,
            onSelect: acts.onOpenIssues,
          },
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
 * dialog over the window, as Settings' Sign out does: getting back
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
  const { drawn, close, trigger } = useActionMenu(shown);
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
      <button type="button" className="sidebar-item sidebar-account" {...trigger(riseAbove)}>
        <AccountAvatar account={account} />
        <span className="sidebar-account-name">
          {signedIn ? (account.name ?? account.email) : "Not signed in"}
        </span>
      </button>
      {drawn === undefined ? null : (
        <ActionMenu
          label="Account"
          menu={drawn}
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
