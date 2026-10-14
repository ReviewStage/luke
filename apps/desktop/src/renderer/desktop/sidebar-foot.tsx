import { ACCOUNT_STATUS, type AccountSnapshot } from "@sidecar/credentials/snapshot";
import { ExternalIcon, GearIcon, UpdateIcon, UserIcon } from "@sidecar/panel";
import { LifeBuoyIcon, MailIcon, MessageSquareIcon } from "lucide-react";
import { ACT_KIND } from "#shared/messages/acts";
import { UPDATE_STATUS } from "#shared/messages/update";
import { APP_COMMAND } from "#shared/shortcuts";
import { GitHubMark } from "../account-marks";
import { useAct } from "../act";
import { runAppCommand } from "../app-commands";
import { PersonAvatar } from "../person-avatar";
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
 * while there is one, and takes no room while there is not. The menu holds
 * three items and no option of its own: every option's home is Settings.
 */

/** Where Help > GitHub leads: Luke's own issues, where CONTRIBUTING.md sends bugs and feature requests. */
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
 * The account's menu: Settings, where every option has its one home; Send
 * feedback; and Help, the ways to reach the people who make Luke. Nothing
 * else: signing out is Account's in Settings, the changelog About's, and the
 * shortcuts and a feature's suggestion stay in the menu bar's Help.
 */
function accountMenuGroups(acts: {
  onSettings: () => void;
  onOpenIssues: () => void;
  onEmail: () => void;
}): MenuEntry[][] {
  return [
    [
      {
        label: "Settings",
        icon: <GearIcon />,
        command: APP_COMMAND.SETTINGS,
        onSelect: acts.onSettings,
      },
    ],
    [
      {
        label: "Send feedback",
        icon: <MessageSquareIcon />,
        onSelect: () => runAppCommand(APP_COMMAND.SEND_FEEDBACK),
      },
      {
        label: "Help",
        icon: <LifeBuoyIcon />,
        items: [
          { label: "GitHub", icon: <GitHubMark />, onSelect: acts.onOpenIssues },
          { label: "Email", icon: <MailIcon />, onSelect: acts.onEmail },
        ],
      },
    ],
  ];
}

/** The foot's account button and the menu it raises. */
function AccountMenu({
  account,
  shown,
  onSettings,
}: {
  account: AccountSnapshot;
  shown: boolean;
  onSettings: () => void;
}): React.JSX.Element {
  const { tell } = useAct();
  const signedIn = account.status === ACCOUNT_STATUS.SIGNED_IN;
  const { open, drawn, show, close } = useActionMenu(shown);
  const groups = accountMenuGroups({
    onSettings,
    onOpenIssues: () => tell(ACT_KIND.GITHUB_OPEN, { url: ISSUES_URL }),
    onEmail: () => tell(ACT_KIND.CONTACT_EMAIL),
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
      {drawn === undefined ? null : (
        <ActionMenu
          label="Account"
          menu={drawn}
          heading={signedIn ? <AccountHeading account={account} /> : undefined}
          groups={groups}
          onClose={close}
        />
      )}
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
}: {
  account: AccountSnapshot;
  updates: UpdateControl;
  /** Whether the sidebar is in sight; folded away, nothing it opened stands over the window. */
  shown: boolean;
  /** Whether Settings is the page on show, which the gear marks. */
  settingsOpen: boolean;
  onSettings: () => void;
}): React.JSX.Element {
  return (
    <div className="sidebar-account-row">
      <AccountMenu account={account} shown={shown} onSettings={onSettings} />
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
