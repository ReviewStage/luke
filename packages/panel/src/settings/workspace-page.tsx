import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { LINK_HOME } from "@repo/features/link-home";
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
  PhotoPick,
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
import { CONFIRM_STAGE, neverBusyAct } from "@repo/ui/confirm-state";
import {
  CrownIcon,
  ExternalLinkIcon,
  GLYPH,
  ShieldIcon,
  UserIcon,
  UserRoundIcon,
  XIcon,
} from "@repo/ui/icons";
import { inputProblem } from "@repo/ui/reported-failure";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { VIRTUAL_ROWS_ANCHOR, VirtualRows } from "@repo/ui/virtual-rows";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useAccountPreferences } from "../account-choices.js";
import { actMutation, pressMutation } from "../act-mutations.js";
import { ACTOR_SIZE, ActorMark, actorMarkWidth, YouBadge } from "../actor-ref.js";
import { useConfirmAct } from "../confirm-act.js";
import { useCopyToast } from "../copy-feedback.js";
import { ActionMenu } from "../desktop/action-menu.js";
import { useFormDialog } from "../desktop/use-form-dialog.js";
import { sharedWords } from "../desktop/workspace-ref.js";
import { TILE_SIZE, useWorkspaceTileUrl, WorkspaceTile } from "../desktop/workspace-tile.js";
import { confirmFailure, refusedShown, unreadShown } from "../failure-report.js";
import {
  automationsQuery,
  slackChannelsQuery,
  workspaceIntegrationsQuery,
  workspaceIntegrationsRetryMutation,
  workspaceInvitationsQuery,
  workspaceInvitationsRetryMutation,
  workspaceMembersQuery,
  workspaceMembersRetryMutation,
} from "../live-reads.js";
import { memberRows } from "../member-rows.js";
import { useOpenPerson } from "../person-door.js";
import { useRefocusAfterEdit } from "../use-refocus-after-edit.js";
import { PHOTO_ACCEPT, photoOfFile } from "../workspace-photo.js";
import { useInviteDialog } from "./invite-dialog.js";
import { replayMaskedError } from "./marks.js";
import { MenuRow } from "./menu-row.js";
import { WORKSPACE_CONNECTIONS } from "./pages.js";
import { refusalToast, rowWrite } from "./row-write.js";
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

const PHOTO_WORDS = {
  REMOVE: "Remove photo",
  REMOVE_BODY: "The photo is deleted, and the workspace is marked by its first letter instead.",
} as const;

const REMOVE_MEMBER = "Remove from workspace";

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

const INVITE_LINK_COPIED = "Invite link copied";

const READ_FAILED = {
  MEMBERS: "The members could not be read.",
  INVITATIONS: "The invitations could not be read.",
  SENTRY: "The workspace's Sentry could not be read.",
  SLACK_BOT: "The workspace's Slack bot could not be read.",
} as const;

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

const ROLE_ACT = {
  MAKE_ADMIN: "Make admin",
  MAKE_MEMBER: "Make member",
  MAKE_OWNER: "Make owner",
} as const;

const TRANSFER_WORDS = {
  VERB: "Transfer ownership",
  RUNNING: "Transferring",
  BODY: "You become an admin. The new owner can change anyone's role and remove anyone, you included, and only they can give it back.",
} as const;

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

const INVITED_ACTOR = { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.UNNAMED } as const;

const CONNECTION_LINE = {
  CONNECTED: "Connected",
  MANAGES: "Not connected.",
  MEMBER: "Not connected. Ask an owner or admin.",
} as const;

const CONNECT = "Connect";

function connectionLine(connected: boolean, manages: boolean): React.ReactNode {
  if (!connected) return manages ? CONNECTION_LINE.MANAGES : CONNECTION_LINE.MEMBER;
  return (
    <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
      {CONNECTION_LINE.CONNECTED}
    </SettingsRowStateLine>
  );
}

const GITHUB_FOLD = "GitHub accounts";
const SLACK_BOT_FOLD = "Slack settings";

const GITHUB_MARK = (
  <SettingsRowMark>
    <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />
  </SettingsRowMark>
);

const SENTRY_MARK = (
  <SettingsRowMark>
    <ProviderMark provider={INTEGRATION_PROVIDER.SENTRY} />
  </SettingsRowMark>
);

const SLACK_MARK = (
  <SettingsRowMark>
    <ProviderMark provider={INTEGRATION_PROVIDER.SLACK} />
  </SettingsRowMark>
);

function answeredAll(): undefined {
  return undefined;
}

function refusedWith(refused: Error): ActionResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason: refused.message };
}

const MEMBERS_SKELETON_MOST = 5;

const MEMBER_ESTIMATE_PX = 60;

const MEMBER_ROW_SKELETON: SettingsRowSkeletonShape = {
  described: true,
  mark: actorMarkWidth(ACTOR_SIZE.CARD),
  controls: [SETTINGS_SKELETON_CONTROL.VALUE, SETTINGS_SKELETON_CONTROL.MORE],
};

const INVITATION_ROW_SKELETON: SettingsRowSkeletonShape = {
  described: true,
  mark: actorMarkWidth(ACTOR_SIZE.CARD),
  controls: [SETTINGS_SKELETON_CONTROL.BUTTON, SETTINGS_SKELETON_CONTROL.MORE],
};

const WORKSPACE_INTEGRATIONS = [
  { service: INTEGRATION_PROVIDER.GITHUB, Row: WorkspaceGitHub },
  { service: INTEGRATION_PROVIDER.SLACK, Row: WorkspaceSlackBotRow },
  { service: INTEGRATION_PROVIDER.SENTRY, Row: WorkspaceSentryRow },
] as const;

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

type ListRead<Item> = { readonly items: readonly Item[] } | { readonly failed: string } | undefined;

function ReadFailed({
  line,
  surface,
  onRetry,
}: {
  line: string;
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

function removes(reader: Workspace["role"], role: WorkspaceMember["role"]): boolean {
  if (reader === WORKSPACE_ROLE.OWNER) return role !== WORKSPACE_ROLE.OWNER;
  return reader === WORKSPACE_ROLE.ADMIN && role === WORKSPACE_ROLE.MEMBER;
}

function useMembersRead(workspace: Workspace) {
  const members = useQuery(workspaceMembersQuery(workspace.id));
  const { mutate } = useMutation(workspaceMembersRetryMutation());
  const read: ListRead<WorkspaceMember> =
    members.data !== undefined
      ? { items: members.data.members }
      : members.isError
        ? { failed: READ_FAILED.MEMBERS }
        : undefined;
  return { read, retry: () => mutate({ workspaceId: workspace.id }) };
}

function MemberRow({
  workspace,
  member,
  readerId,
  slotted,
}: {
  workspace: Workspace;
  member: WorkspaceMember;
  readerId: string | undefined;
  slotted: boolean;
}): React.JSX.Element {
  const { mutateAsync: sendWorkspaceTransfer, ...transferring } = useMutation(
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
  const remove = useConfirmDialog(
    { subject: may.remove, surfaceOpen: true },
    neverBusyAct(() => sendWorkspaceMemberRemove({ workspaceId, userId })),
    confirmFailure(FAILURE_SURFACE.WORKSPACE_MEMBER_REMOVE, { workspaceId }),
  );
  const makeOwnerAct = useConfirmAct(transferring, {
    send: () => sendWorkspaceTransfer({ workspaceId, userId }),
    answered,
    failed: refusedWith,
  });
  const makeOwner = useConfirmDialog(
    { subject: may.transfer, surfaceOpen: true },
    makeOwnerAct,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_TRANSFER, { workspaceId }),
  );
  const giveRole = (role: WorkspaceInvitation["role"]) => {
    setRefusal(undefined);
    sendWorkspaceMemberRole({ workspaceId, userId, role }).catch((refused: Error) =>
      setRefusal(refused.message),
    );
  };
  const openPerson = useOpenPerson();
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

function useOwnAutomations(workspaceId: string, asked: boolean): readonly string[] | undefined {
  const rows = useQuery(automationsQuery(asked ? workspaceId : undefined)).data;
  if (rows === undefined || rows.some((each) => each.mine === undefined)) return undefined;
  return rows.filter((each) => each.mine === true).map((each) => each.name);
}

function MemberLeave({
  workspace,
  ownName,
  onLeft,
}: {
  workspace: Workspace;
  ownName: string | undefined;
  onLeft: () => void;
}): React.JSX.Element {
  const { mutateAsync: sendWorkspaceLeave, ...leaving } = useMutation(
    actMutation(ACT_KIND.WORKSPACE_LEAVE),
  );
  const workspaceId = workspace.id;
  const leaveAct = useConfirmAct(leaving, {
    send: () => sendWorkspaceLeave({ workspaceId }).then(onLeft),
    answered: () => ACCEPTED,
    failed: refusedWith,
  });
  const leave = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    leaveAct,
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
          {workspace.role === WORKSPACE_ROLE.ADMIN ? <li>{LEAVE_WORDS.INVITATIONS}</li> : null}
          <li>{LEAVE_WORDS.OWN(ownName)}</li>
        </ul>
      </ConfirmDialog>
    </>
  );
}

function HeirChip({
  id,
  admins,
  chosen,
  onChoose,
}: {
  id: string;
  admins: readonly WorkspaceMember[];
  chosen: WorkspaceMember;
  onChoose: (heir: WorkspaceMember) => void;
}): React.JSX.Element {
  const menu = useMenu(true);
  const door = useRef<HTMLButtonElement | null>(null);
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

function OwnerLeave({
  workspace,
  members,
}: {
  workspace: Workspace;
  members: ListRead<WorkspaceMember>;
}): React.JSX.Element {
  const { mutateAsync: sendWorkspaceTransfer, ...transferring } = useMutation(
    actMutation(ACT_KIND.WORKSPACE_TRANSFER),
  );
  const admins = memberRows(
    members !== undefined && "items" in members
      ? members.items.filter((each) => each.role === WORKSPACE_ROLE.ADMIN)
      : [],
    undefined,
  ).map((row) => row.member);
  const [chosenId, setChosenId] = useState<string>();
  const heir = admins.find((each) => each.userId === chosenId) ?? admins[0];
  const transferAct = useConfirmAct(transferring, {
    send: () =>
      heir === undefined
        ? Promise.resolve()
        : sendWorkspaceTransfer({ workspaceId: workspace.id, userId: heir.userId }),
    answered: () => ACCEPTED,
    failed: refusedWith,
  });
  const transfer = useConfirmDialog(
    { subject: heir !== undefined, surfaceOpen: true },
    transferAct,
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

function LeaveGroup({
  workspace,
  members,
  ownName,
  onLeft,
}: {
  workspace: Workspace;
  members: ListRead<WorkspaceMember>;
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

function Invitations({ workspaceId }: { workspaceId: string }): React.JSX.Element {
  const { mutate: sendWorkspaceInvitationCancel } = useMutation(
    pressMutation(ACT_KIND.WORKSPACE_INVITATION_CANCEL),
  );
  const copy = useCopyToast();
  const invitations = useQuery(workspaceInvitationsQuery(workspaceId));
  const retry = useMutation(workspaceInvitationsRetryMutation());
  const pending = invitations.data;

  const cancel = (invitationId: string) =>
    sendWorkspaceInvitationCancel({ workspaceId, invitationId });

  const [canceling, setCanceling] = useState<WorkspaceInvitation>();
  const cancellation = useConfirmDialog(
    {
      subject: canceling !== undefined && (pending ?? []).some((one) => one.id === canceling.id),
      surfaceOpen: true,
    },
    neverBusyAct(() => {
      if (canceling !== undefined) cancel(canceling.id);
    }),
    confirmFailure(FAILURE_SURFACE.WORKSPACE_INVITATION_CANCEL),
  );

  return (
    <>
      {invitations.isError ? (
        <ReadFailed
          line={READ_FAILED.INVITATIONS}
          surface={FAILURE_SURFACE.WORKSPACE_INVITATIONS_READ}
          onRetry={() => retry.mutate({ workspaceId })}
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

function connectionsOf(workspace: Workspace): readonly ShownConnection[] {
  const listed =
    workspace.githubInstallations ?? (workspace.github === null ? [] : [workspace.github]);
  return listed.filter((connection) => connection.active);
}

function ManagedGitHub({
  workspace,
  connections,
  add,
  addRefusal,
  chevron,
}: {
  workspace: Workspace;
  connections: readonly ShownConnection[];
  add: React.ReactNode;
  addRefusal: string | undefined;
  chevron: React.ReactNode;
}): React.JSX.Element {
  const { mutateAsync: sendWorkspaceGithubConnect } = useMutation(
    actMutation(ACT_KIND.WORKSPACE_GITHUB_CONNECT),
  );
  const workspaceId = workspace.id;
  const [refusal, setRefusal] = useState<string>();
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
  const { mutateAsync: sendWorkspaceSentryDisconnect, ...sentryLeaving } = useMutation(
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
  const stillListed =
    leaving !== undefined &&
    sentry.installations.some((one) => one.installationId === leaving.installationId);
  const disconnectAct = useConfirmAct(sentryLeaving, {
    send: () =>
      leaving === undefined
        ? Promise.resolve()
        : sendWorkspaceSentryDisconnect({ workspaceId, installationId: leaving.installationId }),
    answered: () => ACCEPTED,
    failed: refusedWith,
  });
  const disconnect = useConfirmDialog(
    { subject: stillListed, surfaceOpen: true },
    disconnectAct,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_SENTRY_DISCONNECT),
  );
  const actions = [
    sentry.installations.map((installation) => ({
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

function WorkspaceSentryRow({ workspace }: { workspace: Workspace }): React.JSX.Element | null {
  const read = useQuery(workspaceIntegrationsQuery(workspace.id));
  const retry = useMutation(workspaceIntegrationsRetryMutation());
  if (read.data === undefined) {
    return read.isError ? (
      <ReadFailed
        line={READ_FAILED.SENTRY}
        surface={FAILURE_SURFACE.WORKSPACE_SENTRY_READ}
        onRetry={() => retry.mutate({ workspaceId: workspace.id })}
      />
    ) : null;
  }
  const { sentry } = read.data;
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

function ManagedSlackBot({
  workspace,
  slack,
  channels,
  chevron,
}: {
  workspace: Workspace;
  slack: WorkspaceSlack;
  channels: readonly SlackListedChannel[] | undefined;
  chevron: React.ReactNode;
}): React.JSX.Element {
  const { mutateAsync: sendWorkspaceSlackBotConnect } = useMutation(
    actMutation(ACT_KIND.WORKSPACE_SLACK_BOT_CONNECT),
  );
  const { mutateAsync: sendWorkspaceSlackBotDisconnect, ...slackLeaving } = useMutation(
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
  const disconnectAct = useConfirmAct(slackLeaving, {
    send: () => sendWorkspaceSlackBotDisconnect({ workspaceId }),
    answered: () => ACCEPTED,
    failed: refusedWith,
  });
  const disconnect = useConfirmDialog(
    { subject: slack.team !== undefined, surfaceOpen: true },
    disconnectAct,
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

function SlackNotificationsRow({ workspaceId }: { workspaceId: string }): React.JSX.Element | null {
  const mutation = useMutation({
    ...actMutation(ACT_KIND.WORKSPACE_SLACK_BOT_NOTIFICATIONS),
    onSettled: refusalToast(answeredAll),
  });
  const on = useAccountPreferences().data?.slackNotifications;
  if (on === undefined) return null;
  return (
    <SwitchRow
      label="Slack notifications"
      labelReplayUnmasked
      checked={on}
      changed={!on}
      write={rowWrite(mutation, {
        ask: (notifications: boolean) => ({ workspaceId, notifications }),
        refused: answeredAll,
        drawn: (asked) => asked.notifications,
      })}
    />
  );
}

function ManagedSlackBotRows({
  workspace,
  slack,
}: {
  workspace: Workspace;
  slack: WorkspaceSlack;
}): React.JSX.Element {
  const channels = useQuery(slackChannelsQuery(workspace.id));
  return (
    <SettingsRowsFold
      label={SLACK_BOT_FOLD}
      head={(chevron) => (
        <ManagedSlackBot
          workspace={workspace}
          slack={slack}
          channels={channels.data}
          chevron={chevron}
        />
      )}
      rows={
        slack.team === undefined ? undefined : (
          <>
            <SlackBotChannelRows workspace={workspace} slack={slack} channels={channels.data} />
            <SlackNotificationsRow workspaceId={workspace.id} />
          </>
        )
      }
    />
  );
}

function SlackBotRows({
  workspace,
  slack,
}: {
  workspace: Workspace;
  slack: WorkspaceSlack;
}): React.JSX.Element {
  if (managesWorkspace(workspace))
    return <ManagedSlackBotRows workspace={workspace} slack={slack} />;
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

function WorkspaceSlackBotRow({ workspace }: { workspace: Workspace }): React.JSX.Element | null {
  const read = useQuery(workspaceIntegrationsQuery(workspace.id));
  const retry = useMutation(workspaceIntegrationsRetryMutation());
  if (read.data === undefined) {
    return read.isError ? (
      <ReadFailed
        line={READ_FAILED.SLACK_BOT}
        surface={FAILURE_SURFACE.WORKSPACE_SLACK_BOT_READ}
        onRetry={() => retry.mutate({ workspaceId: workspace.id })}
      />
    ) : null;
  }
  const { slack } = read.data;
  if (!slack.configured) return null;
  return <SlackBotRows workspace={workspace} slack={slack} />;
}

export interface WorkspaceSettingsControl {
  workspaces: readonly Workspace[];
  workspaceId: string | undefined;
  onLeft: (workspaceId: string) => void;
  listFailed: boolean;
  onRetryList: () => void;
}

const SLUG_WORDS = {
  CHANGE: "Change slug",
  SAVE: "Save",
  SAVING: "Saving",
} as const;

interface SlugAsk {
  ask: () => void;
  dialog: React.JSX.Element;
}

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
    neverBusyAct(() => sendWorkspaceSlugSet({ workspaceId, slug })),
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
  const photoRemoving = useMutation(actMutation(ACT_KIND.WORKSPACE_PHOTO_SET));
  const removeAct = useConfirmAct(photoRemoving, {
    send: () => photoRemoving.mutateAsync({ workspaceId, photo: null }),
    answered: () => ACCEPTED,
    failed: refusedWith,
  });
  const remove = useConfirmDialog(
    { subject: manages && set, surfaceOpen: true },
    removeAct,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_WRITE),
  );
  const endedByKey = useRefocusAfterEdit(editing, button);
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
  const actions = slugActs.length === 0 ? [] : [slugActs];
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
  const tileUrl = useWorkspaceTileUrl(workspace);
  return (
    <Stack gap={GAP.NONE} {...searchAnchorProps(SETTINGS_SEARCH_ROW.WORKSPACE_RENAME)}>
      <MenuRow
        thing="Workspace"
        anchor={SETTINGS_SEARCH_ROW.WORKSPACE_SLUG}
        actions={actions}
        row={{
          leading: manages ? (
            <PhotoPick
              name={workspace.name}
              unnamed={workspace.name}
              id={workspace.id}
              photo={tileUrl}
              picker={{
                ...picker,
                open: () => {
                  setRefusal(undefined);
                  picker.open();
                },
              }}
              onRemove={set && !uploading ? remove.ask : undefined}
              disabled={uploading || remove.busy}
            />
          ) : (
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
          control: rename,
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

export function WorkspacePage({
  control,
  readerId,
}: {
  control: WorkspaceSettingsControl;
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
  return (
    <ShownWorkspace
      key={workspace.id}
      control={control}
      workspace={workspace}
      readerId={readerId}
    />
  );
}

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
