import { ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { VERB } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { HOST_CAPABILITY } from "@repo/settings";
import { devBuildDetail } from "@repo/settings/dev-build";
import type { UpdateControl } from "@repo/settings/settings-controls";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { UPDATE_STATUS } from "@repo/settings/update";
import { updateInSidebar } from "@repo/settings/update-row";
import {
  BUTTON_SHAPE,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  type ButtonVariant,
  ExternalIcon,
  FoldingButton,
  type FoldingButtonHint,
  GearIcon,
  IconButton,
  KeyboardIcon,
  LIST_DENSITY,
  LIST_ROW_ACTIONS,
  LIST_ROW_INK,
  List,
  ListRow,
  NAV_ITEM_VARIANT,
  NavItem,
  OneLine,
  ProviderMark,
  RowHint,
  riseAbove,
  SidebarAccountRow,
  SidebarFoot as SidebarFootBox,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  Tooltip,
  UpdateIcon,
  useMenu,
} from "@repo/ui";
import { ACTOR_KIND, type Actor, accountActor, SOMEONE_REASON } from "@repo/ui/actor-model";
import { GLYPH } from "@repo/ui/icons";
import {
  LifeBuoyIcon,
  LightbulbIcon,
  LogOutIcon,
  MailIcon,
  MessageSquareIcon,
  NewspaperIcon,
  UserRoundIcon,
} from "lucide-react";
import { useMemo } from "react";
import { useAct } from "../act.js";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { runAppCommand } from "../app-commands.js";
import { appPlatform } from "../app-platform.js";
import { useCopyToast } from "../copy-feedback.js";
import { useOpenPerson } from "../person-door.js";
import { signOutSayingFailure } from "../settings/account-section.js";
import { APP_SLICE, useAppSlice, useCapability } from "../use-app-state.js";
import { ActionMenu, type MenuEntry } from "./action-menu.js";
import { OfflineMark } from "./offline-mark.js";
import { type RowMark, RowMarks } from "./task-actions.js";

/**
 * sidebar-foot.tsx -- the sidebar's last row: who is signed in and their menu, the Mac offline, a release on its way in, Send feedback, and Settings' gear.
 *
 * The row every desktop devtool keeps at the foot of its sidebar, the way
 * Cursor keeps it: the account's face and name at its start, which opens the
 * account's menu upward over the column, and the gear at its end, which goes
 * to Settings at once. Send feedback stands just before the gear, always in
 * sight, so word back to the people who make the app is one press away
 * rather than a menu deep. The Mac offline, and a newer release, each stand
 * between them as a small pill while they hold, and take no room while they
 * do not. The menu offers what the menu bar's Help menu offers, by the same
 * commands, with Settings at its head, the ways to reach the people who make
 * the app under it, and Sign out last, which acts on the press.
 */

/** Where Contact us > GitHub leads: our own issues, where CONTRIBUTING.md sends bugs and feature requests. */
const ISSUES_URL = "https://github.com/ReviewStage/vespin/issues";

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
 * One of the release's presses: a compact round pill, its glyph then its one word,
 * which a narrow foot folds to the glyph alone, named still. Its hint says
 * what a press does whether its word is drawn or not, since the word alone
 * says less.
 */
function UpdatePill({
  word,
  hint,
  icon,
  variant,
  onClick,
}: {
  word: string;
  hint: string;
  icon: React.JSX.Element;
  variant: ButtonVariant;
  onClick: () => void;
}): React.JSX.Element {
  const saying = useMemo<FoldingButtonHint>(
    () =>
      ({ children }) => <Tooltip label={hint}>{children}</Tooltip>,
    [hint],
  );
  return (
    <span className="sidebar-update flex flex-none">
      <FoldingButton
        label={word}
        icon={icon}
        variant={variant}
        shape={BUTTON_SHAPE.ROUND}
        size={BUTTON_SIZE.COMPACT}
        onClick={onClick}
        hint={saying}
      />
    </span>
  );
}

/**
 * A newer release with something to press, between the account and the
 * gear: Restart, the very act Settings' Restart to update runs, once the
 * release is downloaded, on the working blue's wash: news, not urgency; or,
 * once installing it failed, the download from the releases page that
 * Settings offers in its place, on the failure's red, its hint saying what
 * went wrong. One word each, so the account's name keeps its room. It
 * draws nothing in any other state, so the row carries no control with
 * nothing to do.
 */
function SidebarUpdate({ updates }: { updates: UpdateControl }): React.JSX.Element | null {
  const { update } = updates;
  const offered = useCapability(HOST_CAPABILITY.UPDATES);
  if (!offered || !updateInSidebar(update)) return null;
  if (update.status === UPDATE_STATUS.READY) {
    return (
      <UpdatePill
        word="Restart"
        hint={`Restart to update to ${update.latestVersion}`}
        icon={<UpdateIcon />}
        variant={BUTTON_VARIANT.WORKING_TINT}
        onClick={updates.onInstall}
      />
    );
  }
  // The sidebar carries a failure only once a release was named.
  if (update.status !== UPDATE_STATUS.ERROR || update.latestVersion === undefined) return null;
  return (
    <UpdatePill
      word="Download"
      hint={`Couldn't install ${update.latestVersion}. Download it from GitHub.`}
      icon={<ExternalIcon />}
      variant={BUTTON_VARIANT.DANGER_TINT}
      onClick={updates.onOpenLatest}
    />
  );
}

/**
 * A development build's row over the account's: the branch it was cut from,
 * as a sidebar row draws a place, which a press copies with its commit, so
 * builds run side by side are told apart without opening Settings. Hide
 * stands at its end under the pointer, as a task row's acts do, the name
 * giving way to it; it hides the row and the Dock band for a demo. A hidden
 * row keeps its place unseen and comes in under the pointer as Show branch,
 * the way back without the menu bar's View > Developer > Show Build Label.
 * A release, the web, and a fixture run, whose captures are the product's
 * pictures, draw none.
 */
function SidebarBuild(): React.JSX.Element | null {
  const run = useAppSlice(APP_SLICE.RUN);
  const facts = useAppSlice(APP_SLICE.WINDOW);
  const { press } = useAct();
  const copy = useCopyToast();
  if (run === undefined || run.packaged || run.fixtureMode) return null;
  const show = (shown: boolean) => void press(ACT_KIND.WINDOW_SHOW_BUILD_LABEL, { shown });
  if (facts?.buildLabelHidden === true) {
    return (
      <List label="Build" density={LIST_DENSITY.DENSE}>
        <ListRow
          leading={<GLYPH.SHOW />}
          title="Show branch"
          ink={LIST_ROW_INK.SIDEBAR}
          more={false}
          muted
          latent
          onPress={() => show(true)}
        />
      </List>
    );
  }
  const detail = devBuildDetail(run.commit);
  const branch = run.commit?.branch ?? detail;
  const hide: RowMark = {
    key: "hide",
    label: "Hide branch",
    icon: <GLYPH.HIDE />,
    onSelect: () => show(false),
  };
  return (
    <List label="Build" density={LIST_DENSITY.DENSE}>
      <ListRow
        leading={<GLYPH.BRANCH />}
        title={<OneLine words={branch}>{branch}</OneLine>}
        ink={LIST_ROW_INK.SIDEBAR}
        hint={{ Hint: RowHint, label: `Copy ${detail}` }}
        onPress={() => copy(detail, "Branch copied")}
        more={false}
        actionsAt={LIST_ROW_ACTIONS.HOVER}
        actions={<RowMarks marks={[hide]} />}
      />
    </List>
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
        <Text
          as={TEXT_ELEMENT.SPAN}
          variant={TEXT_VARIANT.INHERIT}
          truncate
          className="account-menu-name font-ui-semibold text-foreground"
        >
          {account.name}
        </Text>
      )}
      <Text
        as={TEXT_ELEMENT.SPAN}
        variant={TEXT_VARIANT.INHERIT}
        truncate
        className="account-menu-email text-muted-foreground"
      >
        {account.email}
      </Text>
    </>
  );
}

/**
 * The account's menu, in Cursor's order: the reader's own page where the
 * window offers one, then Settings; what the Help menu
 * offers, the changelog before it, and the ways to write to the people who
 * make the app after it; then Sign out, while anyone is signed in to leave.
 */
function accountMenuGroups(
  signedIn: boolean,
  /** Whether the window is an installed app's, whose menu bar's chords the Keyboard shortcuts page lists. */
  desktopApp: boolean,
  acts: {
    /** Opens the reader's own page; none outside the window, or before the account's id is known. */
    onProfile: (() => void) | undefined;
    onSettings: () => void;
    onOpenChangelog: () => void;
    onOpenIssues: () => void;
    onEmail: () => void;
    onSignOut: () => void;
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
      ...(desktopApp
        ? [
            {
              label: "Keyboard shortcuts",
              icon: <KeyboardIcon />,
              command: APP_COMMAND.KEYBOARD_SHORTCUTS,
              onSelect: () => runAppCommand(APP_COMMAND.KEYBOARD_SHORTCUTS),
            },
          ]
        : []),
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
  if (signedIn)
    groups.push([{ label: VERB.SIGN_OUT, icon: <LogOutIcon />, onSelect: acts.onSignOut }]);
  return groups;
}

/**
 * The foot's account button and the menu it raises. Sign out acts on the
 * press, as Settings' does, and a refusal is said in a toast
 * (`signOutSayingFailure`).
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
  const { press } = useAct();
  const signedIn = account.status === ACCOUNT_STATUS.SIGNED_IN;
  const { drawn, close, trigger } = useMenu(shown);
  const openPerson = useOpenPerson();
  const accountId = account.status === ACCOUNT_STATUS.SIGNED_IN ? account.id : undefined;
  const desktopApp = useCapability(HOST_CAPABILITY.DESKTOP_APP);
  const groups = accountMenuGroups(signedIn, desktopApp, {
    onProfile:
      openPerson === undefined || accountId === undefined ? undefined : () => openPerson(accountId),
    onSettings,
    onOpenChangelog: () => press(ACT_KIND.UPDATE_OPEN_CHANGELOG),
    onOpenIssues: () => appPlatform().openGitHub(ISSUES_URL),
    onEmail: () => press(ACT_KIND.CONTACT_EMAIL),
    onSignOut: () => void signOutSayingFailure(onSignOut),
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
    </>
  );
}

/**
 * The foot of the column: the account, which opens its menu; a release on
 * its way in, and the Mac offline, while they hold; Send feedback, which
 * opens the dialog the menu's own item does; and the gear, the one press to
 * Settings.
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
    <SidebarFootBox>
      <SidebarBuild />
      <SidebarAccountRow>
        <AccountMenu
          account={account}
          shown={shown}
          onSettings={onSettings}
          onSignOut={onSignOut}
        />
        <OfflineMark />
        <SidebarUpdate updates={updates} />
        <Tooltip label="Send feedback">
          <IconButton
            icon={<MessageSquareIcon />}
            label="Send feedback"
            onClick={() => runAppCommand(APP_COMMAND.SEND_FEEDBACK)}
          />
        </Tooltip>
        <Tooltip label="Settings" command={APP_COMMAND.SETTINGS}>
          <IconButton
            icon={<GearIcon />}
            label="Settings"
            aria-current={settingsOpen ? "page" : undefined}
            onClick={onSettings}
          />
        </Tooltip>
      </SidebarAccountRow>
    </SidebarFootBox>
  );
}
