import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { LINK_HOME } from "@repo/features/link-home";
import { LIVE_READ } from "@repo/features/live-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import type {
  WorkspaceSentry,
  WorkspaceSentryInstallation,
} from "@repo/features/sentry-install-wire";
import type { FailureSurface } from "@repo/features/shown-failure";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { SlackListedChannel } from "@repo/features/slack-bot-wire";
import { dayAndTimeText } from "@repo/features/time-format";
import { readingWords } from "@repo/features/words";
import type { WorkspaceSlack } from "@repo/features/workspace-integrations-live";
import {
  INVITATION_ROLE,
  type WorkspaceInvitation,
} from "@repo/features/workspace-invitation-wire";
import { managesWorkspace } from "@repo/features/workspace-role";
import {
  WORKSPACE_BOUNDS,
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
  workspaceSlugProblemOf,
} from "@repo/features/workspace-wire";
import { ACT_KIND, WORKSPACE_SLUG_REFUSAL } from "@repo/host/acts";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "@repo/settings/settings-anchors";
import { SETTINGS_SECTION } from "@repo/settings/settings-views";
import {
  BUTTON_VARIANT,
  Button,
  CHIP_LOOK,
  Chip,
  ChipName,
  CONFIRM_LOSS,
  ConfirmDialog,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  type DialogQuestion,
  ErrorState,
  FormField,
  GAP,
  INLINE_EDIT_LOOK,
  InlineEdit,
  type InlineEditEnd,
  MENU_DETAIL,
  OneLine,
  ProviderMark,
  SETTINGS_ROW_MARK_WIDTH,
  SETTINGS_ROW_STATE,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
  SettingsRow,
  SettingsRowActSlot,
  SettingsRowMark,
  type SettingsRowSkeletonShape,
  SettingsRowStateLine,
  SettingsRowsFold,
  SettingsRowsSkeleton,
  SettingsRowValue,
  SettingsSection,
  type SettingsSectionSkeletonShape,
  SettingsSectionsSkeleton,
  Stack,
  TEXT_FIELD_AUTO_COMPLETE,
  TextField,
  useConfirmDialog,
  useFilePicker,
  useMenu,
  usePageScroll,
  wholeWordsHint,
} from "@repo/ui";
import { ACTOR_KIND, memberActor, ROLE_WORDS, SOMEONE_REASON } from "@repo/ui/actor-model";
import { CONFIRM_STAGE } from "@repo/ui/confirm-state";
import {
  CrownIcon,
  ExternalLinkIcon,
  GLYPH,
  ImageUpIcon,
  ShieldIcon,
  UserIcon,
  UserRoundIcon,
  XIcon,
} from "@repo/ui/icons";
import { inputProblem } from "@repo/ui/reported-failure";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { VIRTUAL_ROWS_ANCHOR, VirtualRows } from "@repo/ui/virtual-rows";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useAccountPreferences } from "../account-choices.js";
import { actMutation, pressMutation } from "../act-mutations.js";
import { ACTOR_SIZE, ActorMark, actorMarkWidth, YouBadge } from "../actor-ref.js";
import { useCopyToast } from "../copy-feedback.js";
import { ActionMenu } from "../desktop/action-menu.js";
import { useFormDialog } from "../desktop/use-form-dialog.js";
import { sharedWords } from "../desktop/workspace-ref.js";
import { TILE_SIZE, WorkspaceTile } from "../desktop/workspace-tile.js";
import { confirmFailure, refusedShown, unreadShown } from "../failure-report.js";
import { memberRows } from "../member-rows.js";
import { useOpenPerson } from "../person-door.js";
import { HOST_READ_STATUS, useHostRead } from "../use-host-read.js";
import { useRefocusAfterEdit } from "../use-refocus-after-edit.js";
import { PHOTO_ACCEPT, photoOfFile } from "../workspace-photo.js";
import { useInviteDialog } from "./invite-dialog.js";
import { replayMaskedError } from "./marks.js";
import { MenuRow } from "./menu-row.js";
import { WORKSPACE_CONNECTIONS } from "./pages.js";
import { shownWorkspace } from "./settings-rows.js";
import { AddSlackChannel, SlackBotChannelRows } from "./slack-bot-channels.js";
import { SwitchRow } from "./switch-row.js";
import { GitHubAccountRows, type ShownConnection } from "./workspace-github-accounts.js";
import {
  AddTokenRepository,
  TOKEN_REPOSITORIES_READ,
  TokenOwnerRows,
  useTokenRepositories,
} from "./workspace-token-repositories.js";

/**
 * workspace-page.tsx -- Settings' Workspace page: the workspace the sidebar lists, its members and invitations, its integrations, and the way out of it.
 *
 * The page shows the workspace the tasks' sidebar lists and no other, so
 * there is one choice of workspace in the window: a Settings link that names
 * another lists it in the sidebar first. It is drawn in the shape of the
 * other Settings pages, one kind of thing to a group. Its first row is the
 * workspace as Account's first row is the account: its tile, its name, who
 * shares it, and for an owner or an admin Rename and the photo's acts, and
 * for the owner Change slug; an account's first workspace is named by its
 * owner's account name, so it offers no Rename. The members follow as the service
 * holds them now, each with their email and their role in one column; the
 * owner makes a member an admin, an admin a member or the owner, and
 * removes anyone else, and an admin removes members. Under them, an owner
 * or an admin invites people by address and role, an admin as a member alone,
 * sees the invitations still pending with each one's accept link, which the
 * service has emailed to the invitee and which can still be copied and sent
 * by hand, and cancels one. Workspace connections holds what the workspace
 * connects for everyone, named apart from the account's own Integrations
 * page, each drawn as Settings › Integrations draws its rows. GitHub,
 * the one place a workspace's repositories are set: every GitHub
 * account whose installation of our GitHub App is connected and active,
 * then every owner of a repository a member added on their own token, each
 * the same row inset under GitHub's, its picture on GitHub, its count of
 * repositories, and their names folded under it
 * (`workspace-github-accounts.tsx`);
 * an owner or an admin connects the first with Connect, and once one is,
 * Manage on GitHub opens the one GitHub page that both adds an account and
 * chooses an account's repositories, where which accounts and repositories
 * we reach is managed, so nothing here disconnects one. A member sees
 * the same list, or is told to ask. Last, anyone but the owner leaves, and
 * the owner hands the workspace to an admin first.
 *
 * Its rows are the Settings kit's: a row's one constructive act stands at
 * its end, and the rest are its ⋯'s (`menu-row.tsx`), each act that cannot
 * be undone asking first in the confirm dialog, whose refusal is said where
 * it was asked. The page draws whole: while the members or the invitations
 * are being read their loading lines hold the page back (`SettingsLine`),
 * and a read that failed says so with Retry.
 */

/** The photo's acts in the identity row's ⋯. */
const PHOTO_WORDS = {
  UPLOAD: "Upload photo",
  REPLACE: "Replace photo",
  REMOVE: "Remove photo",
  /** What goes with a removed photo, which the confirm says in one line. */
  REMOVE_BODY: "The photo is deleted, and the workspace is marked by its first letter instead.",
} as const;

/** The member's removal, which the menu item and its confirm both say. */
const REMOVE_MEMBER = "Remove from workspace";

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

/** What the toast says once an invitation's accept link is on the clipboard. */
const INVITE_LINK_COPIED = "Invite link copied";

/** What a list's line says where its read did not land, in `ErrorState`'s words. */
const READ_FAILED = {
  MEMBERS: "The members could not be read.",
  INVITATIONS: "The invitations could not be read.",
  SENTRY: "The workspace's Sentry could not be read.",
  SLACK_BOT: "The workspace's Slack bot could not be read.",
} as const;

/**
 * What the leave says: the row's line, and the dialog's body and what it
 * names as staying and stopping. Tasks and agents are the workspace's; an
 * agent's every step runs as its starter, read through their membership, so
 * one still working when its starter leaves stops at its next step, and a
 * run of an automation starts as its creator, so one whose creator left
 * fails as `creator-left`.
 */
const LEAVE_WORDS = {
  RUNNING: "Leaving",
  LINE: "You lose its tasks, agents, and inbox until someone invites you again.",
  TASKS: (name: string) => `Tasks you wrote stay in ${name}.`,
  AGENTS: "Agents you started that are still working stop.",
  AUTOMATIONS: "Automations you created stop running.",
  INVITATIONS: "Invitations you sent stay valid.",
  AUTOMATIONS_NAMED: (names: readonly string[]) =>
    names.length === 1
      ? `An automation you created stops running: ${names[0]}.`
      : `${names.length} automations you created stop running: ${names.join(", ")}.`,
  OWNER: "You're its owner. Make an admin the owner first, then you can leave.",
  OWNER_NO_ADMIN:
    "You're its owner. Make a member an admin, then make them the owner, and you can leave.",
  OWN: (name: string | undefined) =>
    name === undefined
      ? "Your own workspace isn't affected."
      : `Your own workspace, ${name}, isn't affected.`,
} as const;

/** The role changes in a member's ⋯, the owner's alone. */
const ROLE_ACT = {
  MAKE_ADMIN: "Make admin",
  MAKE_MEMBER: "Make member",
  MAKE_OWNER: "Make owner",
} as const;

/** What the handover says: its press, its question's body, and its running verb. The old owner becomes an admin, one way. */
const TRANSFER_WORDS = {
  VERB: "Transfer ownership",
  RUNNING: "Transferring",
  BODY: "You become an admin. The new owner can change anyone's role and remove anyone, you included, and only they can give it back.",
} as const;

/**
 * The one question either door to the handover asks, a member row's Make
 * owner and the owner's Transfer ownership: its title names the new owner
 * where the door already knows them, and the act waits on the workspace's
 * name typed, since only the new owner can give it back.
 */
function transferAsk(
  workspace: Workspace,
  heir: string | undefined,
): { gate: string; question: DialogQuestion } {
  const to = heir === undefined ? "" : ` to ${heir}`;
  return {
    gate: workspace.name,
    question: {
      title: `Transfer ownership of ${workspace.name}${to}?`,
      body: TRANSFER_WORDS.BODY,
      verb: TRANSFER_WORDS.VERB,
      running: TRANSFER_WORDS.RUNNING,
      loss: CONFIRM_LOSS.AFFECTS_OTHERS,
      replayUnmasked: true,
      titleReplayMasked: true,
    },
  };
}

/** The outline face an invited address wears until it is a member, so its words stand in the members' column. */
const INVITED_ACTOR = { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.UNNAMED } as const;

/**
 * What every integration's row says under its name, GitHub's, Slack's, and
 * Sentry's alike: Connected once it is, else that it is not, and to a member,
 * who cannot connect it, whom to ask.
 */
const CONNECTION_LINE = {
  CONNECTED: "Connected",
  MANAGES: "Not connected.",
  MEMBER: "Not connected. Ask an owner or admin.",
} as const;

/** What an integration's row presses to connect it, the same word on every row. */
const CONNECT = "Connect";

/** An integration's line under its name, by whether it is connected and whether the reader may connect it. */
function connectionLine(connected: boolean, manages: boolean): React.ReactNode {
  if (!connected) return manages ? CONNECTION_LINE.MANAGES : CONNECTION_LINE.MEMBER;
  return (
    <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
      {CONNECTION_LINE.CONNECTED}
    </SettingsRowStateLine>
  );
}

/** The chevrons folding an integration's own rows under its row, each closed until pressed. */
const GITHUB_FOLD = "GitHub accounts";
const SLACK_BOT_FOLD = "Slack settings";

/** GitHub's own mark, which leads its row as a provider's leads Settings › Integrations'. */
const GITHUB_MARK = (
  <SettingsRowMark>
    <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />
  </SettingsRowMark>
);

/** Sentry's own mark, which leads its row as GitHub's leads GitHub's. */
const SENTRY_MARK = (
  <SettingsRowMark>
    <ProviderMark provider={INTEGRATION_PROVIDER.SENTRY} />
  </SettingsRowMark>
);

/** Slack's own mark, which leads Slack's row as Sentry's leads Sentry's. */
const SLACK_MARK = (
  <SettingsRowMark>
    <ProviderMark provider={INTEGRATION_PROVIDER.SLACK} />
  </SettingsRowMark>
);

/**
 * What a refused act answers in the dialog that asked: its refusal's own
 * words, which main makes `WORKSPACE_NOT_PERMITTED_REFUSAL` where the
 * account's role is why, and the act's own sentence otherwise.
 */
function refusedWith(refused: Error): ActionResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason: refused.message };
}

/** The most rows that stand for the members while they are read, however many the workspace counts. */
const MEMBERS_SKELETON_MOST = 5;

/** How tall a member's row is taken to stand before it is measured, a face beside a name over an email, in pixels. */
const MEMBER_ESTIMATE_PX = 60;

/** A member's row while the members are read: their face at a card's size, the email under the name, the role and the ⋯. */
const MEMBER_ROW_SKELETON: SettingsRowSkeletonShape = {
  described: true,
  mark: actorMarkWidth(ACTOR_SIZE.CARD),
  controls: [SETTINGS_SKELETON_CONTROL.VALUE, SETTINGS_SKELETON_CONTROL.MORE],
};

/** An invitation's row while the invitations are read: the invited face, the role and expiry under the email, Copy link and the ⋯. */
const INVITATION_ROW_SKELETON: SettingsRowSkeletonShape = {
  described: true,
  mark: actorMarkWidth(ACTOR_SIZE.CARD),
  controls: [SETTINGS_SKELETON_CONTROL.BUTTON, SETTINGS_SKELETON_CONTROL.MORE],
};

/** The services the Workspace connections group draws a row for, in order, each by its own row. */
const WORKSPACE_INTEGRATIONS = [
  { service: INTEGRATION_PROVIDER.GITHUB, Row: WorkspaceGitHub },
  { service: INTEGRATION_PROVIDER.SLACK, Row: WorkspaceSlackBotRow },
  { service: INTEGRATION_PROVIDER.SENTRY, Row: WorkspaceSentryRow },
] as const;

/**
 * The page's groups before the workspaces are read: the identity, unheaded,
 * its tile at a card's size; the members; and a row to each integration, its
 * mark leading and its press at its end.
 */
const WORKSPACE_SKELETON: readonly SettingsSectionSkeletonShape[] = [
  {
    headed: false,
    rows: [
      {
        described: true,
        mark: actorMarkWidth(ACTOR_SIZE.CARD),
        controls: [SETTINGS_SKELETON_CONTROL.BUTTON],
      },
    ],
  },
  { headed: true, rows: [MEMBER_ROW_SKELETON] },
  {
    headed: true,
    rows: WORKSPACE_INTEGRATIONS.map(() => ({
      described: true,
      mark: SETTINGS_ROW_MARK_WIDTH,
      controls: [SETTINGS_SKELETON_CONTROL.BUTTON],
    })),
  },
];

/** A list as the page reads it: still reading, read, or refused with a line. */
type ListRead<Item> = { readonly items: readonly Item[] } | { readonly failed: string } | undefined;

/** A card's line where the read of its rows did not land: the read failure, then Retry, in the rows' place. */
function ReadFailed({
  line,
  surface,
  onRetry,
}: {
  line: string;
  /** Where the read failed, which its report names. */
  surface: FailureSurface;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <SettingsLine>
      <ErrorState failure={unreadShown(surface)} onRetry={onRetry}>
        {line}
      </ErrorState>
    </SettingsLine>
  );
}

/**
 * What the reader may do to another member, by both their roles, as the
 * service holds it: the owner makes a member an admin, an admin a member or
 * the owner, though never in the account's own first workspace, which is
 * named for its creator, and removes anyone but itself; an admin removes
 * members alone. Nobody acts on themselves, whose way out is Leave.
 */
function memberActs(workspace: Workspace, member: WorkspaceMember, self: boolean) {
  const owner = workspace.role === WORKSPACE_ROLE.OWNER && !self;
  const admin = member.role === WORKSPACE_ROLE.ADMIN;
  return {
    promote: owner && member.role === WORKSPACE_ROLE.MEMBER,
    demote: owner && admin,
    transfer: owner && admin && workspace.personal !== true,
    remove: !self && removes(workspace.role, member.role),
  };
}

/**
 * Whether the reader's role removes a member of `role`: the owner an admin
 * or a member, and an admin a member alone, as the service holds it.
 */
function removes(reader: Workspace["role"], role: WorkspaceMember["role"]): boolean {
  if (reader === WORKSPACE_ROLE.OWNER) return role !== WORKSPACE_ROLE.OWNER;
  return reader === WORKSPACE_ROLE.ADMIN && role === WORKSPACE_ROLE.MEMBER;
}

/**
 * The workspace's members as the host holds them while the page stands
 * (`LIVE_READ.WORKSPACE_MEMBERS`): whatever moves them, here or elsewhere,
 * is drawn there, a write of the page's own from its answer on. Retry reads
 * them again.
 */
function useMembersRead(workspace: Workspace) {
  const { rows, status, retry } = useHostRead(LIVE_READ.WORKSPACE_MEMBERS, workspace.id);
  const read: ListRead<WorkspaceMember> =
    rows !== undefined
      ? { items: rows.members }
      : status === HOST_READ_STATUS.FAILED
        ? { failed: READ_FAILED.MEMBERS }
        : undefined;
  return { read, retry };
}

/**
 * One member's row: their face, their name with You on the reader's own,
 * their email under it, and their role as the row's value in one column,
 * then in its ⋯ their profile, where the window offers one, whose page
 * holds their Copy link, and what the reader may do to them (`memberActs`).
 * Make admin and Make member take hold at once, since either is undone by
 * the other; Make owner and Remove from workspace ask first, and a removal
 * confirmed takes the row away at once, as the host draws it on the press.
 * A role change refused is said under the row, and a removal refused, its
 * row back, in a toast. A row with no ⋯ in a list where others have one
 * keeps the ⋯'s room, so every role ends in the same place. The row is
 * `@repo/ui`'s `SettingsRow` led by the face, through `MenuRow`.
 */
function MemberRow({
  workspace,
  member,
  readerId,
  slotted,
}: {
  workspace: Workspace;
  member: WorkspaceMember;
  /** The reader's account id, whose own row wears You. */
  readerId: string | undefined;
  /** Whether the list's rows may carry a ⋯, so one without keeps its room. */
  slotted: boolean;
}): React.JSX.Element {
  const { mutateAsync: sendWorkspaceTransfer } = useMutation(
    actMutation(ACT_KIND.WORKSPACE_TRANSFER),
  );
  const { mutateAsync: sendWorkspaceMemberRole } = useMutation(
    actMutation(ACT_KIND.WORKSPACE_MEMBER_ROLE),
  );
  const { mutate: sendWorkspaceMemberRemove } = useMutation(
    pressMutation(ACT_KIND.WORKSPACE_MEMBER_REMOVE),
  );
  const workspaceId = workspace.id;
  const { userId } = member;
  const may = memberActs(workspace, member, userId === readerId);
  const [refusal, setRefusal] = useState<string>();
  const answered = () => ACCEPTED;
  // Note that the dialog lets go at once, since the row it stands in goes with the removal the host draws on the press.
  const remove = useConfirmDialog(
    { subject: may.remove, surfaceOpen: true },
    () => {
      sendWorkspaceMemberRemove({ workspaceId, userId });
      return Promise.resolve(ACCEPTED);
    },
    confirmFailure(FAILURE_SURFACE.WORKSPACE_MEMBER_REMOVE, { workspaceId }),
  );
  const makeOwner = useConfirmDialog(
    { subject: may.transfer, surfaceOpen: true },
    () => sendWorkspaceTransfer({ workspaceId, userId }).then(answered, refusedWith),
    confirmFailure(FAILURE_SURFACE.WORKSPACE_TRANSFER, { workspaceId }),
  );
  const giveRole = (role: WorkspaceInvitation["role"]) => {
    setRefusal(undefined);
    sendWorkspaceMemberRole({ workspaceId, userId, role }).catch((refused: Error) =>
      setRefusal(refused.message),
    );
  };
  const openPerson = useOpenPerson();
  // Note that Open profile is the one way to the person, whose page holds their Copy link.
  const profileActs = [
    ...(openPerson === undefined
      ? []
      : [
          {
            label: "Open profile",
            icon: <UserRoundIcon />,
            onSelect: () => openPerson(userId, member.name, workspaceId),
          },
        ]),
  ];
  const roleActs = [
    ...(may.promote
      ? [
          {
            label: ROLE_ACT.MAKE_ADMIN,
            icon: <ShieldIcon />,
            onSelect: () => giveRole(INVITATION_ROLE.ADMIN),
          },
        ]
      : []),
    ...(may.demote
      ? [
          {
            label: ROLE_ACT.MAKE_MEMBER,
            icon: <UserIcon />,
            onSelect: () => giveRole(INVITATION_ROLE.MEMBER),
          },
        ]
      : []),
    ...(may.transfer
      ? [{ label: ROLE_ACT.MAKE_OWNER, icon: <CrownIcon />, onSelect: makeOwner.ask }]
      : []),
  ];
  const removeActs = may.remove
    ? [
        {
          label: REMOVE_MEMBER,
          icon: <GLYPH.REMOVE />,
          danger: true,
          onSelect: remove.ask,
        },
      ]
    : [];
  const acting = profileActs.length + roleActs.length + removeActs.length > 0;
  return (
    <Stack gap={GAP.NONE}>
      <MenuRow
        thing={member.name}
        actions={[profileActs, roleActs, removeActs]}
        row={{
          leading: (
            <ReplayMask>
              <ActorMark actor={memberActor(member, readerId)} size={ACTOR_SIZE.CARD} />
            </ReplayMask>
          ),
          label: (
            // The person card's own wrapper, so You stands off the name as it does on the card.
            <span className="actor-card-name inline-flex items-center gap-item-gap">
              <ReplayMask>{member.name}</ReplayMask>
              {userId === readerId ? <YouBadge /> : null}
            </span>
          ),
          description: (
            <OneLine hint={wholeWordsHint(member.email)}>
              <ReplayMask>{member.email}</ReplayMask>
            </OneLine>
          ),
          error: replayMaskedError(refusedShown(refusal, FAILURE_SURFACE.WORKSPACE_MEMBER)),
          control: (
            <>
              <SettingsRowValue>{ROLE_WORDS[member.role]}</SettingsRowValue>
              {slotted && !acting ? <SettingsRowActSlot /> : null}
            </>
          ),
        }}
      />
      <ConfirmDialog
        open
        confirm={remove}
        question={{
          title: `Remove ${member.name} from this workspace?`,
          body: "They lose its tasks, agents, and inbox until they are invited again.",
          verb: "Remove member",
          running: "Removing",
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
          replayUnmasked: true,
          titleReplayMasked: true,
        }}
      />
      <ConfirmDialog open confirm={makeOwner} {...transferAsk(workspace, member.name)} />
    </Stack>
  );
}

/**
 * The automations the reader made in the workspace, by name, which a leave
 * stops, held while the leave is asked, so one made in another window
 * meanwhile is named too; undefined until the list is read, and where the
 * service does not say whose they are, which the dialog says without names.
 */
function useOwnAutomations(workspaceId: string, asked: boolean): readonly string[] | undefined {
  const { rows } = useHostRead(LIVE_READ.AUTOMATIONS, asked ? workspaceId : undefined);
  if (rows === undefined || rows.some((each) => each.mine === undefined)) return undefined;
  return rows.filter((each) => each.mine === true).map((each) => each.name);
}

/**
 * The leave for a member or an admin: drawn as Account's Delete account is,
 * its name, a line saying what goes, and the red button, which asks first,
 * naming what stays and what stops, the automations the reader made among
 * them by name where the service says whose they are. A leave the service
 * carried says so in the window's toast as the window turns to the personal
 * workspace, where it rests with no task open; a refusal, offline among them, is said in the dialog,
 * which stays open to try again.
 */
function MemberLeave({
  workspace,
  ownName,
  onLeft,
}: {
  workspace: Workspace;
  ownName: string | undefined;
  onLeft: () => void;
}): React.JSX.Element {
  const { mutateAsync: sendWorkspaceLeave } = useMutation(actMutation(ACT_KIND.WORKSPACE_LEAVE));
  const workspaceId = workspace.id;
  const leave = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    () =>
      sendWorkspaceLeave({ workspaceId }).then(() => {
        onLeft();
        return ACCEPTED;
      }, refusedWith),
    confirmFailure(FAILURE_SURFACE.WORKSPACE_LEAVE),
  );
  const ownAutomations = useOwnAutomations(workspaceId, leave.stage !== CONFIRM_STAGE.RESTING);
  const automationsLine =
    ownAutomations === undefined
      ? LEAVE_WORDS.AUTOMATIONS
      : ownAutomations.length === 0
        ? undefined
        : LEAVE_WORDS.AUTOMATIONS_NAMED(ownAutomations);
  return (
    <>
      <SettingsRow
        label={
          <>
            Leave <ReplayMask>{workspace.name}</ReplayMask>
          </>
        }
        description={LEAVE_WORDS.LINE}
      >
        {() => (
          <Button
            variant={BUTTON_VARIANT.DANGER_OUTLINE}
            busy={leave.busy}
            busyLabel={LEAVE_WORDS.RUNNING}
            onClick={leave.ask}
          >
            Leave
          </Button>
        )}
      </SettingsRow>
      <ConfirmDialog
        open
        confirm={leave}
        question={{
          title: `Leave ${workspace.name}?`,
          body: LEAVE_WORDS.LINE,
          verb: `Leave ${workspace.name}`,
          running: LEAVE_WORDS.RUNNING,
          loss: CONFIRM_LOSS.IRREVERSIBLE,
        }}
      >
        <ul className="leave-consequences m-0 pl-ui-16 text-body text-muted-foreground [&>li+li]:mt-ui-4">
          <li>{LEAVE_WORDS.TASKS(workspace.name)}</li>
          <li>{LEAVE_WORDS.AGENTS}</li>
          {automationsLine === undefined ? null : <li>{automationsLine}</li>}
          {/* An invitation is the workspace's, so one an admin sent outlives their leaving; a member sends none. */}
          {workspace.role === WORKSPACE_ROLE.ADMIN ? <li>{LEAVE_WORDS.INVITATIONS}</li> : null}
          <li>{LEAVE_WORDS.OWN(ownName)}</li>
        </ul>
      </ConfirmDialog>
    </>
  );
}

/**
 * The admins the owner may hand the workspace to, as the transfer dialog's
 * field chip, each in the shared menu as every people menu lists them
 * (`memberRows`): face, name, email beside it, and card.
 */
function HeirChip({
  id,
  admins,
  chosen,
  onChoose,
}: {
  /** The id the dialog's field names the chip by. */
  id: string;
  admins: readonly WorkspaceMember[];
  chosen: WorkspaceMember;
  onChoose: (heir: WorkspaceMember) => void;
}): React.JSX.Element {
  const menu = useMenu(true);
  const door = useRef<HTMLButtonElement | null>(null);
  // Note that a container holds the chip wide enough for a name, because width is its place's.
  return (
    <>
      <div className="grid min-w-heir-least max-w-full self-start">
        <Chip
          look={CHIP_LOOK.FIELD}
          chevron
          ref={door}
          id={id}
          aria-label={`New owner: ${chosen.name}`}
          {...menu.trigger()}
        >
          <ReplayMask>
            <ActorMark actor={memberActor(chosen, undefined)} size={ACTOR_SIZE.INLINE} />
          </ReplayMask>
          <ChipName>
            <ReplayMask>{chosen.name}</ReplayMask>
          </ChipName>
        </Chip>
      </div>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label="New owner"
          menu={menu.drawn}
          groups={[
            memberRows(admins, undefined).map((row) => ({
              // Note that an admin is keyed by their id, because two may share a name.
              key: row.member.userId,
              label: row.label,
              detail: row.detail,
              detailPlace: MENU_DETAIL.BESIDE,
              icon: row.icon,
              card: row.card,
              checked: row.member.userId === chosen.userId,
              onSelect: () => onChoose(row.member),
            })),
          ]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/**
 * The owner's leave, which waits on the workspace being handed over: the
 * row says so, and with an admin to hand it to offers Transfer ownership,
 * the confirm dialog with the admin to make the owner as its field, the
 * first admin unless another is chosen; with none it says to make one
 * first. The roles the service answers after the handover stand in the
 * members at once, and the reader's own new role arrives with the followed
 * workspaces, which turns this row into a member's leave.
 */
function OwnerLeave({
  workspace,
  members,
}: {
  workspace: Workspace;
  members: ListRead<WorkspaceMember>;
}): React.JSX.Element {
  const { mutateAsync: sendWorkspaceTransfer } = useMutation(
    actMutation(ACT_KIND.WORKSPACE_TRANSFER),
  );
  // Note that the admins stand in the order the menu lists them, so the first offered is the first listed.
  const admins = memberRows(
    members !== undefined && "items" in members
      ? members.items.filter((each) => each.role === WORKSPACE_ROLE.ADMIN)
      : [],
    undefined,
  ).map((row) => row.member);
  const [chosenId, setChosenId] = useState<string>();
  const heir = admins.find((each) => each.userId === chosenId) ?? admins[0];
  const transfer = useConfirmDialog(
    { subject: heir !== undefined, surfaceOpen: true },
    () =>
      heir === undefined
        ? Promise.resolve(ACCEPTED)
        : sendWorkspaceTransfer({ workspaceId: workspace.id, userId: heir.userId }).then(
            () => ACCEPTED,
            refusedWith,
          ),
    confirmFailure(FAILURE_SURFACE.WORKSPACE_TRANSFER),
  );
  return (
    <>
      <SettingsRow
        label={
          <>
            Leave <ReplayMask>{workspace.name}</ReplayMask>
          </>
        }
        description={heir === undefined ? LEAVE_WORDS.OWNER_NO_ADMIN : LEAVE_WORDS.OWNER}
      >
        {() =>
          heir === undefined ? null : (
            <Button
              variant={BUTTON_VARIANT.OUTLINE}
              busy={transfer.busy}
              busyLabel={TRANSFER_WORDS.RUNNING}
              onClick={() => transfer.ask()}
            >
              {TRANSFER_WORDS.VERB}
            </Button>
          )
        }
      </SettingsRow>
      {/* Note that the new owner goes unnamed in the title, because the field below chooses them. */}
      {heir === undefined ? null : (
        <ConfirmDialog open confirm={transfer} {...transferAsk(workspace, undefined)}>
          <FormField label="New owner">
            {(field) => (
              <HeirChip
                id={field.id}
                admins={admins}
                chosen={heir}
                onChoose={(each) => setChosenId(each.userId)}
              />
            )}
          </FormField>
        </ConfirmDialog>
      )}
    </>
  );
}

/**
 * The page's last group, the way out of the workspace: a member's or an
 * admin's leave, or the owner's, which waits on a handover; none for the
 * owner of the account's own first workspace, which cannot be left or
 * handed over.
 */
function LeaveGroup({
  workspace,
  members,
  ownName,
  onLeft,
}: {
  workspace: Workspace;
  members: ListRead<WorkspaceMember>;
  /** The name of the account's own workspace, which a leave leaves alone; absent from a service that names none. */
  ownName: string | undefined;
  onLeft: () => void;
}): React.JSX.Element | null {
  const owner = workspace.role === WORKSPACE_ROLE.OWNER;
  if (owner && workspace.personal === true) return null;
  return (
    <SettingsSection anchor={SETTINGS_SECTION.LEAVE}>
      {owner ? (
        <OwnerLeave workspace={workspace} members={members} />
      ) : (
        <MemberLeave workspace={workspace} ownName={ownName} onLeft={onLeft} />
      )}
    </SettingsSection>
  );
}

/** The chosen workspace's members, as `useMembersRead` holds them. */
function TeamMembers({
  workspace,
  readerId,
  members,
  onRetry,
}: {
  workspace: Workspace;
  readerId: string | undefined;
  members: ListRead<WorkspaceMember>;
  onRetry: () => void;
}): React.JSX.Element {
  if (members === undefined) {
    return (
      <SettingsRowsSkeleton
        label={readingWords("the members")}
        rows={Array.from(
          { length: Math.min(workspace.memberCount ?? 1, MEMBERS_SKELETON_MOST) },
          () => MEMBER_ROW_SKELETON,
        )}
      />
    );
  }
  if ("failed" in members)
    return (
      <ReadFailed
        line={members.failed}
        surface={FAILURE_SURFACE.WORKSPACE_MEMBERS_READ}
        onRetry={onRetry}
      />
    );
  return <MemberRows workspace={workspace} readerId={readerId} members={members.items} />;
}

/**
 * The members' rows, drawing only those near the view (`VirtualRows`) in
 * the page's own scroller, so a large workspace draws as quickly as a small
 * one; the row whose ⋯ holds the keyboard stays drawn wherever the page is
 * scrolled.
 */
function MemberRows({
  workspace,
  readerId,
  members,
}: {
  workspace: Workspace;
  readerId: string | undefined;
  members: readonly WorkspaceMember[];
}): React.JSX.Element {
  const { scroller, shiftedBy } = usePageScroll();
  const keys = useMemo(() => members.map((member) => member.userId), [members]);
  return (
    <VirtualRows
      scroller={scroller}
      shiftedBy={shiftedBy}
      keys={keys}
      estimate={MEMBER_ESTIMATE_PX}
      anchor={VIRTUAL_ROWS_ANCHOR.START}
      holdsFocus
      aria-label="Members"
    >
      {(index) => {
        const member = members[index];
        return member === undefined ? null : (
          <MemberRow
            workspace={workspace}
            member={member}
            readerId={readerId}
            slotted={managesWorkspace(workspace)}
          />
        );
      }}
    </VirtualRows>
  );
}

/**
 * Members' Invite, at the end of the section's head, for an owner or an
 * admin: an outline `Button` that opens the card inviting addresses
 * (`useInviteDialog`), where a link or a search result naming the
 * invitations lands.
 */
function InviteButton({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const invite = useInviteDialog({
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    owner: workspace.role === WORKSPACE_ROLE.OWNER,
  });
  return (
    <div {...searchAnchorProps(SETTINGS_SECTION.INVITATIONS)}>
      <Button variant={BUTTON_VARIANT.OUTLINE} onClick={invite.ask}>
        Invite
      </Button>
      {invite.dialog}
    </div>
  );
}

/**
 * The workspace's invitations still pending, for an owner or an admin, under
 * the members, and nothing where none is: each under the outline face a
 * person not yet in wears, saying as what and until when, with its link to
 * copy and Cancel invitation in its ⋯, which asks first in the accent rather
 * than red: inviting the address again undoes it, but the link already sent
 * to the invitee stops working. A cancel is drawn by the host on the press,
 * and one refused, its invitation back, is said in a toast. Each is a
 * `SettingsRow` led by the face, through `MenuRow`, Copy link its outline
 * `Button`.
 */
function Invitations({ workspaceId }: { workspaceId: string }): React.JSX.Element {
  const { mutate: sendWorkspaceInvitationCancel } = useMutation(
    pressMutation(ACT_KIND.WORKSPACE_INVITATION_CANCEL),
  );
  const copy = useCopyToast();
  const {
    rows: pending,
    status,
    retry,
  } = useHostRead(LIVE_READ.WORKSPACE_INVITATIONS, workspaceId);

  const cancel = (invitationId: string) =>
    sendWorkspaceInvitationCancel({ workspaceId, invitationId });

  // Note that the question goes with its invitation, canceled or accepted meanwhile.
  const [canceling, setCanceling] = useState<WorkspaceInvitation>();
  const cancellation = useConfirmDialog(
    {
      subject: canceling !== undefined && (pending ?? []).some((one) => one.id === canceling.id),
      surfaceOpen: true,
    },
    () => {
      if (canceling !== undefined) cancel(canceling.id);
      return Promise.resolve(ACCEPTED);
    },
    confirmFailure(FAILURE_SURFACE.WORKSPACE_INVITATION_CANCEL),
  );

  return (
    <>
      {status === HOST_READ_STATUS.FAILED ? (
        <ReadFailed
          line={READ_FAILED.INVITATIONS}
          surface={FAILURE_SURFACE.WORKSPACE_INVITATIONS_READ}
          onRetry={retry}
        />
      ) : pending === undefined ? (
        <SettingsRowsSkeleton
          label={readingWords("the invitations")}
          rows={[INVITATION_ROW_SKELETON]}
        />
      ) : null}
      {(pending ?? []).map((one) => (
        <MenuRow
          key={one.id}
          thing={one.email}
          alone
          actions={[
            {
              label: "Cancel invitation",
              icon: <XIcon />,
              danger: true,
              onSelect: () => {
                setCanceling(one);
                cancellation.ask();
              },
            },
          ]}
          row={{
            leading: <ActorMark actor={INVITED_ACTOR} size={ACTOR_SIZE.CARD} />,
            label: (
              <OneLine hint={wholeWordsHint(one.email)}>
                <ReplayMask>{one.email}</ReplayMask>
              </OneLine>
            ),
            description: (
              <>
                Invited as {ROLE_WORDS[one.role]} · Expires{" "}
                <ReplayMask>{dayAndTimeText(Date.parse(one.expiresAt))}</ReplayMask>
              </>
            ),
            // We send no mail: the accept link is copied and sent by hand.
            control: (
              <Button
                variant={BUTTON_VARIANT.OUTLINE}
                onClick={() => copy(one.acceptUrl, INVITE_LINK_COPIED)}
              >
                Copy link
              </Button>
            ),
          }}
        />
      ))}
      <ConfirmDialog
        open
        confirm={cancellation}
        question={{
          title: "Cancel invitation?",
          body: `The link sent to ${canceling?.email ?? ""} stops working. Inviting the address again sends a new one.`,
          verb: "Cancel invitation",
          running: "Canceling",
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
          replayUnmasked: true,
          bodyReplayMasked: true,
        }}
      />
    </>
  );
}

/**
 * The GitHub accounts connected to the workspace and active, the first
 * linked first: every one a service with several lists, else the one a
 * service from before them names. Note that one suspended or removed on
 * GitHub counts as none, because the store never forgets a removed one and
 * agents reach nothing through it.
 */
function connectionsOf(workspace: Workspace): readonly ShownConnection[] {
  const listed =
    workspace.githubInstallations ?? (workspace.github === null ? [] : [workspace.github]);
  return listed.filter((connection) => connection.active);
}

/**
 * The workspace's GitHub, for an owner or an admin: Connect while none is,
 * which installs our GitHub App on a GitHub account for this
 * workspace, and once one is, Manage on GitHub, which opens the same page:
 * GitHub lists every account there, to install the App on another or to
 * configure one it is on, so one door does both. Either press opens the
 * browser through the one connect, whose return to the app adds the
 * installation to this workspace; a page that could not be opened says why
 * under the row. The row is `@repo/ui`'s `SettingsRow` led by GitHub's mark,
 * its press the outline `Button`.
 */
function ManagedGitHub({
  workspace,
  connections,
  add,
  addRefusal,
  chevron,
}: {
  workspace: Workspace;
  connections: readonly ShownConnection[];
  /** Add repository, which stands before the row's own press and draws nothing without the reader's token. */
  add: React.ReactNode;
  /** What the last add was refused with, said under the row. */
  addRefusal: string | undefined;
  /** The chevron folding GitHub's accounts under the row, last at its end. */
  chevron: React.ReactNode;
}): React.JSX.Element {
  const { mutateAsync: sendWorkspaceGithubConnect } = useMutation(
    actMutation(ACT_KIND.WORKSPACE_GITHUB_CONNECT),
  );
  const workspaceId = workspace.id;
  const [refusal, setRefusal] = useState<string>();
  // Note that a second press while the browser is being sent is taken as none, because an install begun again replaces the first one's intent.
  const [opening, setOpening] = useState(false);
  const underWay = useRef(false);
  const open = () => {
    if (underWay.current) return;
    underWay.current = true;
    setOpening(true);
    setRefusal(undefined);
    sendWorkspaceGithubConnect({ workspaceId })
      .catch((refused: Error) => setRefusal(refused.message))
      .finally(() => {
        underWay.current = false;
        setOpening(false);
      });
  };
  const connected = connections.length > 0;
  return (
    <Stack gap={GAP.NONE}>
      <SettingsRow
        leading={GITHUB_MARK}
        label="GitHub"
        description={connectionLine(connected, true)}
        error={replayMaskedError(
          refusedShown(refusal ?? addRefusal, FAILURE_SURFACE.WORKSPACE_GITHUB),
        )}
      >
        {() => (
          <>
            {add}
            {connected ? (
              <Button
                variant={BUTTON_VARIANT.OUTLINE}
                icon={<ExternalLinkIcon aria-hidden="true" />}
                busy={opening}
                busyLabel="Opening GitHub"
                onClick={open}
              >
                Manage on GitHub
              </Button>
            ) : (
              <Button
                variant={BUTTON_VARIANT.OUTLINE}
                busy={opening}
                busyLabel="Connecting"
                onClick={open}
              >
                {CONNECT}
              </Button>
            )}
            {chevron}
          </>
        )}
      </SettingsRow>
    </Stack>
  );
}

/**
 * The workspace's GitHub: an owner's or an admin's to connect, and for a
 * member, read only, or the ask to have it; then every account connected,
 * the same for both, and every owner of a repository a member added on
 * their own token (`workspace-token-repositories.tsx`), which a member
 * whose own token is saved adds from GitHub's row, and none else is
 * offered it.
 */
function WorkspaceGitHub({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const connections = connectionsOf(workspace);
  const repositories = useTokenRepositories(workspace.id);
  const [addRefusal, setAddRefusal] = useState<string>();
  const add = (
    <AddTokenRepository
      workspaceId={workspace.id}
      repositories={repositories}
      onRefused={setAddRefusal}
    />
  );
  // Note that the token rows say their read while it is out or failed, so GitHub folds those lines too.
  const owns =
    connections.length > 0 ||
    repositories.read !== TOKEN_REPOSITORIES_READ.READY ||
    repositories.listed.length > 0;
  return (
    <SettingsRowsFold
      label={GITHUB_FOLD}
      head={(chevron) =>
        managesWorkspace(workspace) ? (
          <ManagedGitHub
            workspace={workspace}
            connections={connections}
            add={add}
            addRefusal={addRefusal}
            chevron={chevron}
          />
        ) : (
          <SettingsRow
            leading={GITHUB_MARK}
            label="GitHub"
            description={connectionLine(connections.length > 0, false)}
            error={replayMaskedError(refusedShown(addRefusal, FAILURE_SURFACE.WORKSPACE_GITHUB))}
          >
            {() => (
              <>
                {add}
                {chevron}
              </>
            )}
          </SettingsRow>
        )
      }
      rows={
        owns ? (
          <>
            <GitHubAccountRows workspaceId={workspace.id} connections={connections} />
            <TokenOwnerRows repositories={repositories} />
          </>
        ) : undefined
      }
    />
  );
}

/**
 * The workspace's Sentry, for an owner or an admin: Connect
 * while none stands, which opens Sentry's install page in the browser, an
 * install that could not be begun saying why under the row; and once one
 * stands, a ⋯ whose menu disconnects each installation, which asks first.
 * A disconnect stops its alerts firing this workspace's automations; the
 * integration stays installed on Sentry until the organization removes it
 * there, which the dialog says.
 */
function ManagedSentry({
  workspace,
  sentry,
}: {
  workspace: Workspace;
  sentry: WorkspaceSentry;
}): React.JSX.Element {
  const { mutateAsync: sendWorkspaceSentryInstall } = useMutation(
    actMutation(ACT_KIND.WORKSPACE_SENTRY_INSTALL),
  );
  const { mutateAsync: sendWorkspaceSentryDisconnect } = useMutation(
    actMutation(ACT_KIND.WORKSPACE_SENTRY_DISCONNECT),
  );
  const workspaceId = workspace.id;
  const [refusal, setRefusal] = useState<string>();
  const [installing, setInstalling] = useState(false);
  const underWay = useRef(false);
  const [leaving, setLeaving] = useState<WorkspaceSentryInstallation>();
  const install = () => {
    if (underWay.current) return;
    underWay.current = true;
    setInstalling(true);
    setRefusal(undefined);
    sendWorkspaceSentryInstall({ workspaceId })
      .catch((refused: Error) => setRefusal(refused.message))
      .finally(() => {
        underWay.current = false;
        setInstalling(false);
      });
  };
  // Note that the question stands only while its installation is still listed, so a read that drops it dismisses it.
  const stillListed =
    leaving !== undefined &&
    sentry.installations.some((one) => one.installationId === leaving.installationId);
  const disconnect = useConfirmDialog(
    { subject: stillListed, surfaceOpen: true },
    () =>
      leaving === undefined
        ? Promise.resolve(ACCEPTED)
        : sendWorkspaceSentryDisconnect({
            workspaceId,
            installationId: leaving.installationId,
          }).then(() => ACCEPTED, refusedWith),
    confirmFailure(FAILURE_SURFACE.WORKSPACE_SENTRY_DISCONNECT),
  );
  const actions = [
    sentry.installations.map((installation) => ({
      // Note that a lone installation's act says only Disconnect, since the menu offers no other to tell it from.
      label:
        installation.account === undefined || sentry.installations.length === 1
          ? "Disconnect"
          : `Disconnect ${installation.account}`,
      replayMasked: installation.account !== undefined && sentry.installations.length > 1,
      icon: <GLYPH.DISCONNECT />,
      danger: true,
      onSelect: () => {
        setLeaving(installation);
        disconnect.ask();
      },
    })),
  ].filter((group) => group.length > 0);
  return (
    <Stack gap={GAP.NONE}>
      <MenuRow
        thing="Sentry"
        // Note that a lone installation's Disconnect draws as a button of its own, and several share the ⋯.
        alone
        actions={actions}
        row={{
          leading: SENTRY_MARK,
          label: "Sentry",
          description: connectionLine(sentry.installations.length > 0, true),
          error: replayMaskedError(refusedShown(refusal, FAILURE_SURFACE.WORKSPACE_SENTRY)),
          control:
            sentry.installations.length > 0 ? null : (
              <Button
                variant={BUTTON_VARIANT.OUTLINE}
                busy={installing}
                busyLabel="Opening Sentry"
                onClick={install}
              >
                {CONNECT}
              </Button>
            ),
          // Note that Sentry folds nothing, so it keeps the chevron's room for its controls to end in GitHub's and Slack's column.
          chevron: <SettingsRowActSlot />,
        }}
      />
      <ConfirmDialog
        open
        confirm={disconnect}
        question={{
          title: `Disconnect Sentry from ${workspace.name}?`,
          replayUnmasked: true,
          titleReplayMasked: true,
          body: `Its alerts and new issues stop triggering this workspace's automations. Uninstall ${PRODUCT_NAME} in Sentry's settings to remove it there too.`,
          verb: "Disconnect Sentry",
          running: "Disconnecting",
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
        }}
      />
    </Stack>
  );
}

/**
 * The workspace's Sentry: drawn only where the deployment holds our
 * Sentry integration, an owner's or an admin's to install for everyone,
 * and for a member, read only, where it is installed or the ask to have it;
 * a read that did not land says so in the row's place, with Retry. It is
 * drawn as the host holds the workspace's integrations, followed live on
 * the service, so an install finished in the browser draws as it lands.
 */
function WorkspaceSentryRow({ workspace }: { workspace: Workspace }): React.JSX.Element | null {
  const read = useHostRead(LIVE_READ.WORKSPACE_INTEGRATIONS, workspace.id);
  if (read.rows === undefined) {
    return read.status === HOST_READ_STATUS.FAILED ? (
      <ReadFailed
        line={READ_FAILED.SENTRY}
        surface={FAILURE_SURFACE.WORKSPACE_SENTRY_READ}
        onRetry={read.retry}
      />
    ) : null;
  }
  const { sentry } = read.rows;
  if (!sentry.configured) return null;
  if (managesWorkspace(workspace)) {
    return <ManagedSentry workspace={workspace} sentry={sentry} />;
  }
  return (
    <SettingsRow
      leading={SENTRY_MARK}
      label="Sentry"
      description={connectionLine(sentry.installations.length > 0, false)}
    >
      {() => null}
    </SettingsRow>
  );
}

/**
 * The workspace's Slack bot, for an owner or an admin: Connect
 * while it is not connected, which asks Slack which team the bot answers
 * for and keeps it, a connect that failed saying why under the row; and
 * once it is, a ⋯ whose menu disconnects it, which asks first, as the
 * page's other rows hold their acts. A disconnect stops the bot writing to
 * the workspace's members; the bot stays installed in Slack, which the
 * dialog says. Add channel stands beside the ⋯ once Slack has listed the
 * team's channels (`channels`).
 */
function ManagedSlackBot({
  workspace,
  slack,
  channels,
  chevron,
}: {
  workspace: Workspace;
  slack: WorkspaceSlack;
  channels: readonly SlackListedChannel[] | undefined;
  /** The chevron folding the bot's rows under its row, last at its end. */
  chevron: React.ReactNode;
}): React.JSX.Element {
  const { mutateAsync: sendWorkspaceSlackBotConnect } = useMutation(
    actMutation(ACT_KIND.WORKSPACE_SLACK_BOT_CONNECT),
  );
  const { mutateAsync: sendWorkspaceSlackBotDisconnect } = useMutation(
    actMutation(ACT_KIND.WORKSPACE_SLACK_BOT_DISCONNECT),
  );
  const workspaceId = workspace.id;
  const [refusal, setRefusal] = useState<string>();
  const [addRefusal, setAddRefusal] = useState<string>();
  const [connecting, setConnecting] = useState(false);
  const underWay = useRef(false);
  const connect = () => {
    if (underWay.current) return;
    underWay.current = true;
    setConnecting(true);
    setRefusal(undefined);
    sendWorkspaceSlackBotConnect({ workspaceId })
      .catch((refused: Error) => setRefusal(refused.message))
      .finally(() => {
        underWay.current = false;
        setConnecting(false);
      });
  };
  const disconnect = useConfirmDialog(
    { subject: slack.team !== undefined, surfaceOpen: true },
    () => sendWorkspaceSlackBotDisconnect({ workspaceId }).then(() => ACCEPTED, refusedWith),
    confirmFailure(FAILURE_SURFACE.WORKSPACE_SLACK_BOT_DISCONNECT),
  );
  const actions =
    slack.team === undefined
      ? []
      : [
          [
            {
              label: "Disconnect",
              icon: <GLYPH.DISCONNECT />,
              danger: true,
              onSelect: () => disconnect.ask(),
            },
          ],
        ];
  return (
    <Stack gap={GAP.NONE}>
      <MenuRow
        thing="Slack"
        alone
        actions={actions}
        row={{
          leading: SLACK_MARK,
          label: "Slack",
          description: connectionLine(slack.team !== undefined, true),
          error: replayMaskedError(
            refusedShown(refusal, FAILURE_SURFACE.WORKSPACE_SLACK_BOT) ??
              refusedShown(addRefusal, FAILURE_SURFACE.WORKSPACE_SLACK_BOT_CHANNEL),
          ),
          control:
            slack.team !== undefined ? (
              channels === undefined ? null : (
                <AddSlackChannel
                  workspaceId={workspaceId}
                  channels={channels}
                  onRefused={setAddRefusal}
                />
              )
            ) : (
              <Button
                variant={BUTTON_VARIANT.OUTLINE}
                busy={connecting}
                busyLabel="Connecting"
                onClick={connect}
              >
                {CONNECT}
              </Button>
            ),
          chevron,
        }}
      />
      <ConfirmDialog
        open
        confirm={disconnect}
        question={{
          title: `Disconnect the Slack bot from ${workspace.name}?`,
          replayUnmasked: true,
          titleReplayMasked: true,
          body: `${PRODUCT_NAME} stops messaging this workspace's members in Slack. The bot stays installed in Slack until a Slack admin removes it.`,
          verb: "Disconnect Slack bot",
          running: "Disconnecting",
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
        }}
      />
    </Stack>
  );
}

/**
 * The reader's own Slack notifications, under the bot's row once it is
 * connected: one switch, on until they turn it off, which holds in every
 * workspace whose bot is connected. It is their account's preference, which
 * no row of the workspace carries, so it draws the account's preferences
 * row the host holds for the session (`LIVE_READ.ACCOUNT_PREFERENCES`),
 * drawn once that row is read; the host draws a turn over the row on the
 * press, and a refusal puts it back.
 */
function SlackNotificationsRow({ workspaceId }: { workspaceId: string }): React.JSX.Element | null {
  const { mutateAsync: sendWorkspaceSlackBotNotifications } = useMutation(
    actMutation(ACT_KIND.WORKSPACE_SLACK_BOT_NOTIFICATIONS),
  );
  const on = useAccountPreferences().data?.slackNotifications;
  if (on === undefined) return null;
  return (
    <SwitchRow
      label="Slack notifications"
      labelReplayUnmasked
      checked={on}
      changed={!on}
      onChange={(notifications) =>
        sendWorkspaceSlackBotNotifications({ workspaceId, notifications }).then(
          () => ACCEPTED,
          refusedWith,
        )
      }
    />
  );
}

/**
 * An owner's or an admin's bot row, and folded under it, where the bot is
 * connected, its repositories and channels (`slack-bot-channels.tsx`) and
 * the reader's own switch: the channels are Slack's own list, which the host
 * holds while the row shows.
 */
function ManagedSlackBotRows({
  workspace,
  slack,
}: {
  workspace: Workspace;
  slack: WorkspaceSlack;
}): React.JSX.Element {
  const channels = useHostRead(LIVE_READ.SLACK_CHANNELS, workspace.id);
  return (
    <SettingsRowsFold
      label={SLACK_BOT_FOLD}
      head={(chevron) => (
        <ManagedSlackBot
          workspace={workspace}
          slack={slack}
          channels={channels.rows}
          chevron={chevron}
        />
      )}
      rows={
        slack.team === undefined ? undefined : (
          <>
            <SlackBotChannelRows workspace={workspace} slack={slack} channels={channels.rows} />
            <SlackNotificationsRow workspaceId={workspace.id} />
          </>
        )
      }
    />
  );
}

/** The bot's row, and folded under it, where the bot is connected, an owner's or admin's repositories and channels and the reader's own switch. */
function SlackBotRows({
  workspace,
  slack,
}: {
  workspace: Workspace;
  slack: WorkspaceSlack;
}): React.JSX.Element {
  if (managesWorkspace(workspace))
    return <ManagedSlackBotRows workspace={workspace} slack={slack} />;
  // Note that the rows stand side by side as the card's own, as GitHub's do, so the card rules a line between each.
  return (
    <SettingsRowsFold
      label={SLACK_BOT_FOLD}
      head={(chevron) => (
        <SettingsRow
          leading={SLACK_MARK}
          label="Slack"
          description={connectionLine(slack.team !== undefined, false)}
        >
          {() => chevron}
        </SettingsRow>
      )}
      rows={
        slack.team === undefined ? undefined : <SlackNotificationsRow workspaceId={workspace.id} />
      }
    />
  );
}

/**
 * The workspace's Slack bot: drawn only where the deployment holds
 * our bot, an owner's or an admin's to connect for everyone, and for a
 * member, read only, where it is connected or the ask to have it, with
 * the reader's own Slack notifications under it once it is connected; a
 * read that did not land says so in the row's place, with Retry. It is
 * drawn as the host holds the workspace's integrations, as Sentry's is.
 */
function WorkspaceSlackBotRow({ workspace }: { workspace: Workspace }): React.JSX.Element | null {
  const read = useHostRead(LIVE_READ.WORKSPACE_INTEGRATIONS, workspace.id);
  if (read.rows === undefined) {
    return read.status === HOST_READ_STATUS.FAILED ? (
      <ReadFailed
        line={READ_FAILED.SLACK_BOT}
        surface={FAILURE_SURFACE.WORKSPACE_SLACK_BOT_READ}
        onRetry={read.retry}
      />
    ) : null;
  }
  const { slack } = read.rows;
  if (!slack.configured) return null;
  return <SlackBotRows workspace={workspace} slack={slack} />;
}

/** What Settings' Workspace page is handed: the workspaces, the one the sidebar lists, and the fall back after a leave. */
export interface WorkspaceSettingsControl {
  /** Every workspace the account is a member of, its first one first. */
  workspaces: readonly Workspace[];
  /** The workspace the sidebar lists, which the page shows; absent before the workspaces are read. */
  workspaceId: string | undefined;
  /** Lands the window on the account's own workspace, at rest with no task open, once a workspace is left. */
  onLeft: (workspaceId: string) => void;
  /** Whether the read the workspaces arrive with failed, so none will arrive until it is asked again. */
  listFailed: boolean;
  /** Asks for the workspaces again. */
  onRetryList: () => void;
}

/** What the slug's dialog says: the ⋯ item that opens it, which is its title too, and its act. */
const SLUG_WORDS = {
  CHANGE: "Change slug",
  SAVE: "Save",
  SAVING: "Saving",
} as const;

/** The slug's dialog: the press that opens the card, and the card. */
interface SlugAsk {
  ask: () => void;
  dialog: React.JSX.Element;
}

/**
 * The workspace's slug, which its owner alone changes, from the identity
 * row's ⋯: the slug every link to the workspace is written under, typed in
 * a dialog of its own, the address it makes said under it as it is typed,
 * and what is wrong with its shape said there too, in the words the service
 * refuses it with. Each opening starts from the slug as it stands. Save
 * stands the new slug at once, as the host draws it on the press, and closes
 * the card; one the service refuses, as one another workspace holds, goes
 * back, its words in a toast. The slug it leaves stays the workspace's, so
 * no link written under it stops opening.
 */
function useSlugDialog(workspace: Workspace): SlugAsk {
  const { mutate: sendWorkspaceSlugSet } = useMutation(pressMutation(ACT_KIND.WORKSPACE_SLUG_SET));
  const workspaceId = workspace.id;
  const standing = workspace.slug ?? "";
  const [slug, setSlug] = useState(standing);
  const field = useRef<HTMLInputElement | null>(null);
  const problem = workspaceSlugProblemOf(slug);
  const shown = problem === undefined ? undefined : WORKSPACE_SLUG_REFUSAL[problem];
  const confirm = useConfirmDialog(
    { subject: workspace.role === WORKSPACE_ROLE.OWNER, surfaceOpen: true },
    () => {
      sendWorkspaceSlugSet({ workspaceId, slug });
      return Promise.resolve(ACCEPTED);
    },
    confirmFailure(FAILURE_SURFACE.WORKSPACE_WRITE, { workspaceId }),
  );
  const form = useFormDialog(confirm, problem === undefined && slug !== standing);
  const dialog = (
    <Dialog
      open={form.open}
      title={SLUG_WORDS.CHANGE}
      replayUnmasked
      busy={form.settling}
      initialFocus={field}
      onDismiss={form.dismiss}
      actions={
        <DialogActions
          onCancel={form.dismiss}
          act={{
            verb: SLUG_WORDS.SAVE,
            tone: DIALOG_TONE.PRIMARY,
            running: SLUG_WORDS.SAVING,
            ...form.act,
          }}
        />
      }
    >
      <FormField
        label="Slug"
        description={
          <>
            {LINK_HOME.HOST}/<ReplayMask>{slug}</ReplayMask>
          </>
        }
        error={inputProblem(shown)}
      >
        {(control) => (
          <TextField
            ref={field}
            field={control}
            autoComplete={TEXT_FIELD_AUTO_COMPLETE.OFF}
            spellCheck={false}
            autoCorrect={false}
            value={slug}
            disabled={form.settling}
            onEnter={form.submit}
            onChange={setSlug}
          />
        )}
      </FormField>
    </Dialog>
  );
  return {
    ask: () => {
      setSlug(standing);
      confirm.ask();
    },
    dialog,
  };
}

/**
 * The page's first row, drawn as Account's account row is: the workspace's
 * tile, its name, and who shares it in one line, then for an owner or an
 * admin Rename, and the photo's acts in its ⋯, beside the owner's Change
 * slug (`useSlugDialog`). Rename opens
 * the name in place on its own line, as the sidebar renames a task, and
 * Return or a press elsewhere sends what was typed with its ends trimmed,
 * while Escape, an empty name, or the same one renames nothing; an account's
 * first workspace is named by its owner's account name, so it offers no
 * Rename. Upload photo picks a PNG, JPEG, or WebP image and sends it drawn
 * square; Remove photo, where one is set, asks first. The new name stands
 * at once, as the host draws it on the press, and the photo once the
 * service answers it; a refusal, its name back, or a file that cannot be a
 * photo, is said under the row until the next try.
 * The row is `@repo/ui`'s `SettingsRow` led by the tile, through `MenuRow`,
 * and Rename its outline `Button`.
 */
function WorkspaceIdentity({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const { mutateAsync: sendWorkspacePhotoSet } = useMutation(
    actMutation(ACT_KIND.WORKSPACE_PHOTO_SET),
  );
  const { mutateAsync: sendWorkspaceRename } = useMutation(actMutation(ACT_KIND.WORKSPACE_RENAME));
  const workspaceId = workspace.id;
  const manages = managesWorkspace(workspace);
  const renamable = manages && workspace.personal !== true;
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [refusal, setRefusal] = useState<string>();
  const button = useRef<HTMLButtonElement | null>(null);
  const set = workspace.photoVersion !== undefined;
  const remove = useConfirmDialog(
    { subject: manages && set, surfaceOpen: true },
    () => sendWorkspacePhotoSet({ workspaceId, photo: null }).then(() => ACCEPTED, refusedWith),
    confirmFailure(FAILURE_SURFACE.WORKSPACE_WRITE),
  );
  // Note that focus goes back to Rename once the edit ends, since the host draws the new name on the press.
  const endedByKey = useRefocusAfterEdit(editing, button);
  /** How many renames were asked, so a refusal of one a newer rename followed is not said under the newer name. */
  const renames = useRef(0);
  const end = ({ value: name, byKey }: InlineEditEnd) => {
    endedByKey(byKey);
    setEditing(false);
    if (name === undefined) return;
    renames.current += 1;
    const asked = renames.current;
    sendWorkspaceRename({ workspaceId, name }).catch((refused: Error) => {
      if (renames.current === asked) setRefusal(refused.message);
    });
  };
  const upload = (file: File) => {
    setRefusal(undefined);
    setUploading(true);
    photoOfFile(file)
      .then((read) => {
        if ("refusal" in read) throw new Error(read.refusal);
        return sendWorkspacePhotoSet({ workspaceId, photo: read.photo });
      })
      .then(
        () => undefined,
        (refused: Error) => setRefusal(refused.message),
      )
      .finally(() => setUploading(false));
  };
  const picker = useFilePicker({
    accept: PHOTO_ACCEPT,
    onFiles: ([picked]) => {
      if (picked !== undefined) upload(picked);
    },
  });
  const slugging = useSlugDialog(workspace);
  const slugActs =
    workspace.role === WORKSPACE_ROLE.OWNER
      ? [{ label: SLUG_WORDS.CHANGE, icon: <GLYPH.LINK />, onSelect: slugging.ask }]
      : [];
  const actions = manages
    ? [
        [
          {
            label: set ? PHOTO_WORDS.REPLACE : PHOTO_WORDS.UPLOAD,
            icon: <ImageUpIcon />,
            disabled: uploading || remove.busy,
            onSelect: () => {
              setRefusal(undefined);
              picker.open();
            },
          },
          ...slugActs,
        ],
        // An upload still under way would put a photo back after its removal, so none is asked meanwhile.
        set
          ? [
              {
                label: PHOTO_WORDS.REMOVE,
                icon: <GLYPH.REMOVE />,
                danger: true,
                disabled: uploading,
                onSelect: remove.ask,
              },
            ]
          : [],
      ]
    : [];
  const rename =
    renamable && !editing ? (
      <Button
        ref={button}
        variant={BUTTON_VARIANT.OUTLINE}
        onClick={() => {
          setRefusal(undefined);
          setEditing(true);
        }}
      >
        Rename
      </Button>
    ) : null;
  const photoPicker = manages ? picker.input : null;
  return (
    <Stack gap={GAP.NONE} {...searchAnchorProps(SETTINGS_SEARCH_ROW.WORKSPACE_RENAME)}>
      <MenuRow
        thing="Workspace"
        anchor={SETTINGS_SEARCH_ROW.WORKSPACE_SLUG}
        actions={actions}
        row={{
          leading: (
            <ReplayMask>
              <WorkspaceTile workspace={workspace} size={TILE_SIZE.HEAD} />
            </ReplayMask>
          ),
          label: (
            <ReplayMask>
              <InlineEdit
                value={workspace.name}
                label="Workspace name"
                editing={editing}
                maxLength={WORKSPACE_BOUNDS.MAX_NAME_CHARS}
                look={INLINE_EDIT_LOOK.INPUT}
                onEnd={end}
              />
            </ReplayMask>
          ),
          description: sharedWords(workspace.memberCount, workspace.personal === true),
          error: replayMaskedError(refusedShown(refusal, FAILURE_SURFACE.WORKSPACE_WRITE)),
          control: (
            <>
              {rename}
              {photoPicker}
            </>
          ),
        }}
      />
      <ConfirmDialog
        open
        confirm={remove}
        question={{
          title: `Remove ${workspace.name}'s photo?`,
          replayUnmasked: true,
          titleReplayMasked: true,
          body: PHOTO_WORDS.REMOVE_BODY,
          verb: PHOTO_WORDS.REMOVE,
          running: "Removing",
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
        }}
      />
      {slugging.dialog}
    </Stack>
  );
}

/**
 * The page for the listed workspace, one kind of thing to a group: its
 * identity, its members and under them its invitations for an owner or an
 * admin, its GitHub, and last the leave for anyone but an owner, the members and
 * GitHub under the anchors their links have always named; placeholder
 * sections in the page's shape before the workspaces are read, and Retry
 * where that read failed.
 */
export function WorkspacePage({
  control,
  readerId,
}: {
  control: WorkspaceSettingsControl;
  /** The signed-in account's id, whose own member row wears You. */
  readerId: string | undefined;
}): React.JSX.Element {
  const workspace = shownWorkspace(control);
  if (workspace === undefined) {
    return control.listFailed ? (
      <SettingsSection>
        <ReadFailed
          line="Your workspaces could not be read."
          surface={FAILURE_SURFACE.WORKSPACES_READ}
          onRetry={control.onRetryList}
        />
      </SettingsSection>
    ) : (
      <SettingsSectionsSkeleton
        label={readingWords("your workspaces")}
        sections={WORKSPACE_SKELETON}
      />
    );
  }
  // Keyed to the workspace, so another one listed reads its own members and asks nothing left over.
  return (
    <ShownWorkspace
      key={workspace.id}
      control={control}
      workspace={workspace}
      readerId={readerId}
    />
  );
}

/** The page over one workspace, its members read once for the groups that read them. */
function ShownWorkspace({
  control,
  workspace,
  readerId,
}: {
  control: WorkspaceSettingsControl;
  workspace: Workspace;
  readerId: string | undefined;
}): React.JSX.Element {
  const members = useMembersRead(workspace);
  const ownName = control.workspaces.find((each) => each.personal === true)?.name;
  return (
    <>
      <SettingsSection>
        <WorkspaceIdentity workspace={workspace} />
      </SettingsSection>
      <SettingsSection
        title="Members"
        action={managesWorkspace(workspace) ? <InviteButton workspace={workspace} /> : undefined}
        anchor={SETTINGS_SECTION.MEMBERS}
      >
        <TeamMembers
          workspace={workspace}
          readerId={readerId}
          members={members.read}
          onRetry={members.retry}
        />
        {managesWorkspace(workspace) ? <Invitations workspaceId={workspace.id} /> : null}
      </SettingsSection>
      <SettingsSection title={WORKSPACE_CONNECTIONS} anchor={SETTINGS_SECTION.GITHUB_REPOSITORIES}>
        {WORKSPACE_INTEGRATIONS.map(({ service, Row }) => (
          <Row key={service} workspace={workspace} />
        ))}
      </SettingsSection>
      <LeaveGroup
        workspace={workspace}
        members={members.read}
        ownName={ownName}
        onLeft={() => control.onLeft(workspace.id)}
      />
    </>
  );
}
