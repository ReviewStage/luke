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
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  LifeBuoyIcon,
  LogOutIcon,
  MailIcon,
  MessageSquareIcon,
  NewspaperIcon,
  UserRoundIcon,
} from "lucide-react";
import { useMemo } from "react";
import { pressMutation } from "../act-mutations.js";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { runAppCommand } from "../app-commands.js";
import { appPlatform } from "../app-platform.js";
import { useCopyToast } from "../copy-feedback.js";
import { useOpenPerson } from "../person-door.js";
import { signOutSayingFailure } from "../settings/account-section.js";
import { appStateQuery, selectCapability, selectRun, selectWindow } from "../use-app-state.js";
import { ActionMenu, type MenuEntry } from "./action-menu.js";
import { OfflineMark } from "./offline-mark.js";
import { type RowMark, RowMarks } from "./task-actions.js";

const ISSUES_URL = "https://github.com/ReviewStage/vespin/issues";

const NOBODY_SIGNED_IN: Actor = { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.UNNAMED };

export function AccountAvatar({ account }: { account: AccountSnapshot }): React.JSX.Element {
  if (account.status !== ACCOUNT_STATUS.SIGNED_IN) {
    return <ActorMark actor={NOBODY_SIGNED_IN} size={ACTOR_SIZE.ACCOUNT} />;
  }
  return (
    <ReplayMask>
      <ActorMark actor={accountActor(account)} size={ACTOR_SIZE.ACCOUNT} />
    </ReplayMask>
  );
}

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

function SidebarUpdate({ updates }: { updates: UpdateControl }): React.JSX.Element | null {
  const { update } = updates;
  const offered =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.UPDATES) }).data === true;
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

function SidebarBuild(): React.JSX.Element | null {
  const run = useQuery({ ...appStateQuery, select: selectRun }).data;
  const facts = useQuery({ ...appStateQuery, select: selectWindow }).data;
  const { mutate: showBuildLabel } = useMutation(pressMutation(ACT_KIND.WINDOW_SHOW_BUILD_LABEL));
  const copy = useCopyToast();
  if (run === undefined || run.packaged || run.fixtureMode) return null;
  const show = (shown: boolean) => showBuildLabel({ shown });
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
        title={
          <OneLine words={branch}>
            <ReplayMask>{branch}</ReplayMask>
          </OneLine>
        }
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

export function AccountHeading({
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

function accountMenuGroups(
  signedIn: boolean,
  desktopApp: boolean,
  acts: {
    onProfile: (() => void) | undefined;
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
    ...(profile.length === 0 ? [] : [profile]),
    [
      { label: "Changelog", icon: <NewspaperIcon />, onSelect: acts.onOpenChangelog },
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

export function useAccountMenuGroups(
  account: AccountSnapshot,
  onSignOut: () => Promise<void>,
): MenuEntry[][] {
  const { mutate: openChangelog } = useMutation(pressMutation(ACT_KIND.UPDATE_OPEN_CHANGELOG));
  const { mutate: sendEmail } = useMutation(pressMutation(ACT_KIND.CONTACT_EMAIL));
  const openPerson = useOpenPerson();
  const accountId = account.status === ACCOUNT_STATUS.SIGNED_IN ? account.id : undefined;
  const desktopApp =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.DESKTOP_APP) }).data ===
    true;
  return accountMenuGroups(account.status === ACCOUNT_STATUS.SIGNED_IN, desktopApp, {
    onProfile:
      openPerson === undefined || accountId === undefined ? undefined : () => openPerson(accountId),
    onOpenChangelog: () => openChangelog(),
    onOpenIssues: () => appPlatform().openGitHub(ISSUES_URL),
    onEmail: () => sendEmail(),
    onSignOut: () => void signOutSayingFailure(onSignOut),
  });
}

function AccountMenu({
  account,
  shown,
  onSignOut,
}: {
  account: AccountSnapshot;
  shown: boolean;
  onSignOut: () => Promise<void>;
}): React.JSX.Element {
  const signedIn = account.status === ACCOUNT_STATUS.SIGNED_IN;
  const { drawn, close, trigger } = useMenu(shown);
  const groups = useAccountMenuGroups(account, onSignOut);
  return (
    <>
      <NavItem
        variant={NAV_ITEM_VARIANT.IDENTITY}
        icon={<AccountAvatar account={account} />}
        menu={trigger(riseAbove)}
      >
        {signedIn ? <ReplayMask>{account.name ?? account.email}</ReplayMask> : "Not signed in"}
      </NavItem>
      {drawn === undefined ? null : (
        <ActionMenu
          label="Account"
          replayUnmasked
          menu={drawn}
          heading={signedIn ? <AccountHeading account={account} /> : undefined}
          groups={groups}
          onClose={close}
        />
      )}
    </>
  );
}

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
  shown: boolean;
  settingsOpen: boolean;
  onSettings: () => void;
  onSignOut: () => Promise<void>;
}): React.JSX.Element {
  return (
    <SidebarFootBox>
      <SidebarBuild />
      <SidebarAccountRow>
        <AccountMenu account={account} shown={shown} onSignOut={onSignOut} />
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
