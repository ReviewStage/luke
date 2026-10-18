import { ACCOUNT_STATUS, type AccountSnapshot } from "@luke/credentials/snapshot";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { ACT_KIND } from "@luke/host/acts";
import { HOST_CAPABILITY } from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { UPDATE_STATUS } from "@luke/settings/update";
import { updateInSidebar } from "@luke/settings/update-row";
import {
  ConfirmDialog,
  DIALOG_TONE,
  ExternalIcon,
  GearIcon,
  IconButton,
  KeyboardIcon,
  NAV_ITEM_VARIANT,
  NavItem,
  ProviderMark,
  riseAbove,
  UpdateIcon,
  useConfirmDialog,
  useMenu,
} from "@luke/ui";
import { ACTOR_KIND, type Actor, accountActor, SOMEONE_REASON } from "@luke/ui/actor-model";
import type { UpdateControl } from "@luke/voice/settings-controls";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import {
  LifeBuoyIcon,
  LightbulbIcon,
  LogOutIcon,
  MailIcon,
  MessageSquareIcon,
  NewspaperIcon,
  UserRoundIcon,
} from "lucide-react";
import { useAct } from "../act";
import { ACTOR_SIZE, ActorMark } from "../actor-ref";
import { runAppCommand } from "../app-commands";
import { appPlatform } from "../app-platform";
import { useOpenPerson } from "../person-door";
import { Tooltip } from "../tooltip";
import { useCapability } from "../use-app-state";
import { ActionMenu, type MenuEntry } from "./action-menu";

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

/** The account's place while no one is signed in: someone's outline. */
const NOBODY_SIGNED_IN: Actor = { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.UNNAMED };

/** The account's face: the signed-in person's (`actor-ref.tsx`), or someone's outline while no one is signed in. */
function AccountAvatar({ account }: { account: AccountSnapshot }): React.JSX.Element {
  if (account.status !== ACCOUNT_STATUS.SIGNED_IN) {
    return <ActorMark actor={NOBODY_SIGNED_IN} size={ACTOR_SIZE.ACCOUNT} />;
  }
  return <ActorMark actor={accountActor(account)} size={ACTOR_SIZE.ACCOUNT} />;
}

/**
 * A newer release with something to press, between the account and the
 * gear: Restart, the very act Settings' Restart to update runs, once the
 * release is downloaded; or, once installing it failed, the download from
 * the releases page that Settings offers in its place, in the failure's red,
 * its hint saying what went wrong. One word each, so the account's name
 * keeps its room, and a narrow sidebar draws the glyph alone, named still
 * and its hint saying the rest. It draws nothing in any other state, so the
 * row carries no control with nothing to do.
 */
function SidebarUpdate({ updates }: { updates: UpdateControl }): React.JSX.Element | null {
  const { update } = updates;
  const offered = useCapability(HOST_CAPABILITY.UPDATES);
  if (!offered || !updateInSidebar(update)) return null;
  if (update.status === UPDATE_STATUS.READY) {
    return (
      <Tooltip label={`Restart to update to ${update.latestVersion}`}>
        <button
          type="button"
          className="sidebar-update"
          aria-label="Restart"
          onClick={updates.onInstall}
        >
          <UpdateIcon />
          <span className="sidebar-update-word">Restart</span>
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
        aria-label="Download"
        onClick={updates.onOpenLatest}
      >
        <span className="sidebar-update-word">Download</span>
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
 * The account's menu, in Cursor's order: the reader's own page where the
 * window offers one, then Settings; what the Help menu
 * offers, the changelog before it, and the ways to write to the people who
 * make Luke after it; then Log out, while anyone is signed in to leave.
 */
function accountMenuGroups(
  signedIn: boolean,
  acts: {
    /** Opens the reader's own page; none outside the window, or before the account's id is known. */
    onProfile: (() => void) | undefined;
    onSettings: () => void;
    onOpenChangelog: () => void;
    onOpenIssues: () => void;
    onEmail: () => void;
    onLogOut: () => void;
  },
): MenuEntry[][] {
  const profile =
    acts.onProfile === undefined
      ? []
      : [{ label: "Your profile", icon: <UserRoundIcon />, onSelect: acts.onProfile }];
  const groups: MenuEntry[][] = [
    [
      ...profile,
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
  const { drawn, close, trigger } = useMenu(shown);
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
          reason: "Luke could not log out. Try again.",
        };
      }
    },
  );
  const openPerson = useOpenPerson();
  const accountId = account.status === ACCOUNT_STATUS.SIGNED_IN ? account.id : undefined;
  const groups = accountMenuGroups(signedIn, {
    onProfile:
      openPerson === undefined || accountId === undefined ? undefined : () => openPerson(accountId),
    onSettings,
    onOpenChangelog: () => tell(ACT_KIND.UPDATE_OPEN_CHANGELOG),
    onOpenIssues: () => appPlatform().openGitHub(ISSUES_URL),
    onEmail: () => tell(ACT_KIND.CONTACT_EMAIL),
    onLogOut: logOut.ask,
  });
  return (
    <>
      <NavItem
        variant={NAV_ITEM_VARIANT.IDENTITY}
        icon={<AccountAvatar account={account} />}
        menu={trigger(riseAbove)}
      >
        {signedIn ? (account.name ?? account.email) : "Not signed in"}
      </NavItem>
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
        <IconButton
          icon={<GearIcon />}
          label="Settings"
          aria-current={settingsOpen ? "page" : undefined}
          onClick={onSettings}
        />
      </Tooltip>
    </div>
  );
}
