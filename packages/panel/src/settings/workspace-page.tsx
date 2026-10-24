import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type {
  WorkspaceSentry,
  WorkspaceSentryInstallation,
} from "@luke/features/sentry-install-wire";
import { dayAndTimeText } from "@luke/features/time-format";
import {
  INVITATION_ROLE,
  type WorkspaceInvitation,
} from "@luke/features/workspace-invitation-wire";
import { managesWorkspace } from "@luke/features/workspace-role";
import {
  WORKSPACE_BOUNDS,
  WORKSPACE_PHOTO_BOUNDS,
  WORKSPACE_PHOTO_TYPE,
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceGithubInstallation,
  type WorkspaceMember,
  workspacePhotoOfDataUrl,
} from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { HOST_CAPABILITY } from "@luke/settings";
import { SETTINGS_SECTION } from "@luke/settings/settings-views";
import {
  ALIGN,
  BUTTON_TYPE,
  BUTTON_VARIANT,
  Button,
  CHIP_LOOK,
  CHIP_WIDTH,
  Chip,
  ChipName,
  CONFIRM_LOSS,
  ConfirmDialog,
  ErrorState,
  FormField,
  GAP,
  INLINE_EDIT_LOOK,
  Inline,
  InlineEdit,
  type InlineEditEnd,
  JUSTIFY,
  LAYOUT_ELEMENT,
  MENU_DETAIL,
  OneLine,
  ProviderMark,
  SETTINGS_ROW_INDENT,
  SETTINGS_ROW_MARK_WIDTH,
  SETTINGS_ROW_STATE,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
  SettingsRow,
  SettingsRowActSlot,
  SettingsRowMark,
  type SettingsRowSkeletonShape,
  SettingsRowStateLine,
  SettingsRowsSkeleton,
  SettingsRowValue,
  SettingsSection,
  type SettingsSectionSkeletonShape,
  SettingsSectionsSkeleton,
  STATUS_TONE,
  Stack,
  TEXT_FIELD_AUTO_COMPLETE,
  TEXT_FIELD_TYPE,
  TextField,
  TrashIcon,
  useConfirmDialog,
  useFilePicker,
  useMenu,
  wholeWordsHint,
} from "@luke/ui";
import { ACTOR_KIND, memberActor, ROLE_WORDS, SOMEONE_REASON } from "@luke/ui/actor-model";
import { githubAccountPictureUrl } from "@luke/ui/tasks-model";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import {
  CrownIcon,
  ExternalLinkIcon,
  ImageUpIcon,
  ShieldIcon,
  UserIcon,
  UserMinusIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAct } from "../act.js";
import { streamFrom } from "../act-stream.js";
import { ACTOR_SIZE, ActorMark, actorMarkWidth, YouBadge } from "../actor-ref.js";
import { actPort } from "../app-bridge.js";
import { useCopyToast } from "../copy-feedback.js";
import { ActionMenu } from "../desktop/action-menu.js";
import { sharedWords } from "../desktop/workspace-ref.js";
import { TILE_SIZE, WorkspaceTile } from "../desktop/workspace-tile.js";
import { encodeImage } from "../feedback-images.js";
import { memberRows } from "../member-rows.js";
import { useOpenPerson } from "../person-door.js";
import { useWorkspaceMembersRead } from "../tasks/use-workspace-members.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { useCapability } from "../use-app-state.js";
import { useRefocusAfterEdit } from "../use-refocus-after-edit.js";
import { MacRepositoriesGroup } from "./mac-repository-settings.js";
import { MenuRow } from "./menu-row.js";
import { shownWorkspace } from "./settings-rows.js";
import { useSentryRead } from "./use-sentry-read.js";
import {
  AddTokenRepository,
  TokenRepositoryRows,
  useTokenRepositories,
} from "./workspace-token-repositories.js";

/**
 * workspace-page.tsx -- Settings' Workspace page: the workspace the sidebar lists, its members, its invitations, its integrations, and the way out of it.
 *
 * The page shows the workspace the tasks' sidebar lists and no other, so
 * there is one choice of workspace in the window: a Settings link that names
 * another lists it in the sidebar first. It is drawn in the shape of the
 * other Settings pages, one kind of thing to a group. Its first row is the
 * workspace as Profile's first row is the account: its tile, its name, who
 * shares it and the reader's role, and for an owner or an admin Rename and
 * the photo's acts; an account's first workspace is named by its owner's
 * account name, so it offers no Rename. The members follow as the service
 * holds them now, each with their email and their role in one column; the
 * owner makes a member an admin, an admin a member or the owner, and
 * removes anyone else, and an admin removes members. An owner or an admin
 * then invites people by address and role, an admin as a member alone,
 * sees the invitations still pending with each one's accept link to copy and
 * send, and cancels one. Integrations holds what the workspace connects for
 * everyone, each drawn as Settings › Integrations draws its rows. GitHub,
 * the one place a workspace's repositories are set: every GitHub
 * account whose installation of the Luke GitHub App is connected, each
 * inset under GitHub's row with its picture on GitHub, Connected or suspended;
 * an owner or an admin connects the first with Connect, and once one is,
 * Manage on GitHub opens the one GitHub page that both adds an account and
 * chooses an account's repositories, where which accounts and repositories
 * Luke reaches is managed, so nothing here disconnects one. A member sees
 * the same list, or is told to ask. Linear, which plans start from: an
 * owner or an admin connects it once for every member, and disconnects it
 * from its ⋯; a member sees whether it is connected. Last, anyone but the owner leaves, and the
 * owner hands the workspace to an admin first.
 *
 * Its rows are the Settings kit's: a row's one constructive act stands at
 * its end, and the rest are its ⋯'s (`menu-row.tsx`), each act that cannot
 * be undone asking first in the confirm dialog, whose refusal is said where
 * it was asked. The page draws whole: while the members or the invitations
 * are being read their loading lines hold the page back (`SettingsLine`),
 * and a read that failed says so with Retry.
 */

/** How many pixels a side a workspace's photo is drawn to before it is sent: well past the largest tile's 32, so it stays sharp on a Retina screen. */
const PHOTO_EDGE = 256;

/** The image types a photo is picked from, which are the ones a photo may be kept as. */
const PHOTO_TYPES: ReadonlySet<string> = new Set(Object.values(WORKSPACE_PHOTO_TYPE));

/** The photo picker's `accept`: those types alone. */
const PHOTO_ACCEPT = [...PHOTO_TYPES].join(",");

/** Why a picked file did not become the workspace's photo, in the words said under its row. */
const PHOTO_REFUSAL = {
  KIND: (name: string) => `${name} isn't a PNG, JPEG, or WebP image.`,
  UNREADABLE: (name: string) => `${name} couldn't be read.`,
  TOO_LARGE: (name: string) => `${name} is too large for a workspace photo.`,
} as const;

/** The photo's acts in the identity row's ⋯. */
const PHOTO_WORDS = {
  UPLOAD: "Upload photo",
  REPLACE: "Replace photo",
  REMOVE: "Remove photo",
} as const;

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

/** The roles an invitation offers, in the order the role's menu lists them, the default first. */
const INVITATION_ROLES = [INVITATION_ROLE.MEMBER, INVITATION_ROLE.ADMIN] as const;

/** The writes the invitations list takes, one out at a time. */
const INVITATION_WRITE = { INVITE: "invite", CANCEL: "cancel" } as const;

type InvitationWrite = (typeof INVITATION_WRITE)[keyof typeof INVITATION_WRITE];

/** What each role may do, as the role menu's second lines say it. */
const ROLE_DETAIL = {
  [INVITATION_ROLE.MEMBER]: "Works on tasks and agents",
  [INVITATION_ROLE.ADMIN]: "Also manages members and GitHub",
} as const satisfies Record<WorkspaceInvitation["role"], string>;

/** What an admin's role menu says under Admin, which only the owner invites. */
const OWNER_INVITES_ADMINS = "Only the owner invites admins";

/** What the invitations say where none is pending, with the one fact a reader cannot guess: Luke mails no one. */
const INVITATIONS_EMPTY =
  "No invitations. Luke sends no email, so copy each invitation's link and send it yourself.";

/** What a list's line says where its read did not land, in `ErrorState`'s words. */
const READ_FAILED = {
  MEMBERS: "The members could not be read.",
  INVITATIONS: "The invitations could not be read.",
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
  LINE: "You lose its tasks, agents, and Inbox until someone invites you again.",
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
  LEFT: (name: string) => `You left ${name}.`,
} as const;

/** The role changes in a member's ⋯, the owner's alone. */
const ROLE_ACT = {
  MAKE_ADMIN: "Make admin",
  MAKE_MEMBER: "Make member",
  MAKE_OWNER: "Make owner",
} as const;

/** What the handover says: its press, its dialogs' bodies, and its running verb. The old owner becomes an admin, one way. */
const TRANSFER_WORDS = {
  VERB: "Transfer ownership",
  RUNNING: "Transferring",
  BODY: "The admin you choose becomes its owner, and you become an admin.",
  ONE_BODY: (name: string) =>
    `You become an admin. ${name} can then change anyone's role and remove anyone, you included.`,
} as const;

/** The outline face an invited address wears until it is a member, so its words stand in the members' column. */
const INVITED_ACTOR = { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.UNNAMED } as const;

/** What the connected GitHub account's line says once the App's installation was suspended or removed. */
const GITHUB_SUSPENDED = "Suspended or removed on GitHub.";

/** What a connected account's row says while its installation stands. */
const GITHUB_CONNECTED = "Connected";

/** What the GitHub row says where no GitHub is connected, by who is reading it. */
const GITHUB_UNCONNECTED = {
  MANAGES: "Not connected.",
  MEMBER: "Not connected. Ask an owner or admin.",
} as const;

/** What the GitHub row says once an account is connected, by who is reading it: where its access is changed. */
const GITHUB_CONNECTED_LINE = {
  MANAGES: "Add accounts and choose repositories on GitHub.",
  MEMBER: "Accounts and repositories are managed on GitHub.",
} as const;

/** GitHub's own mark, which leads its row as a provider's leads Settings › Integrations'. */
const GITHUB_MARK = (
  <SettingsRowMark>
    <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />
  </SettingsRowMark>
);

/** Linear's own mark, which leads its row as GitHub's leads GitHub's. */
const LINEAR_MARK = (
  <SettingsRowMark>
    <ProviderMark provider={INTEGRATION_PROVIDER.LINEAR} />
  </SettingsRowMark>
);

/** Sentry's own mark, which leads its row as Linear's leads Linear's. */
const SENTRY_MARK = (
  <SettingsRowMark>
    <ProviderMark provider={INTEGRATION_PROVIDER.SENTRY} />
  </SettingsRowMark>
);

/** What the Sentry row's line says, by whether an installation stands and who is reading it. */
const SENTRY_LINE = {
  INSTALLED: (accounts: string) => (accounts === "" ? "Installed" : `Installed · ${accounts}`),
  MANAGES: "Not installed.",
  MEMBER: "Not installed. Ask an owner or admin.",
} as const;

/** One connected GitHub account as the page lists it: its login, whether its installation is active, and its id where the service named it. */
type ShownConnection = Pick<WorkspaceGithubInstallation, "login" | "active"> &
  Partial<Pick<WorkspaceGithubInstallation, "installationId">>;

/** What the Linear row's line says, by where the workspace's Linear stands and who is reading it. */
const LINEAR_LINE = {
  CONNECTED: "Connected for everyone in this workspace",
  EXPIRED: "Linear stopped honoring this connection. Connect again.",
  EXPIRED_MEMBER: "Linear stopped honoring this connection. Ask an owner or admin.",
  MANAGES: "Not connected.",
  MEMBER: "Not connected. Ask an owner or admin.",
} as const;

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

/** The services the Integrations group draws a row for, in order, each by its own row. */
const WORKSPACE_INTEGRATIONS = [
  { service: INTEGRATION_PROVIDER.GITHUB, Row: WorkspaceGitHub },
  { service: INTEGRATION_PROVIDER.LINEAR, Row: WorkspaceLinear },
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
function ReadFailed({ line, onRetry }: { line: string; onRetry: () => void }): React.JSX.Element {
  return (
    <SettingsLine>
      <ErrorState onRetry={onRetry}>{line}</ErrorState>
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
 * The workspace's members, read once and followed while the page stands
 * (`useWorkspaceMembersRead`): whatever moves them, here or elsewhere, is
 * pushed. A write's answer stands in once it lands, until the next push.
 * Retry reads and follows again from nothing.
 */
function useMembersRead(workspace: Workspace) {
  const followed = useWorkspaceMembersRead(workspace);
  const [answered, setAnswered] = useState<{
    readonly over: readonly WorkspaceMember[] | undefined;
    readonly items: readonly WorkspaceMember[];
  }>();
  const read: ListRead<WorkspaceMember> =
    answered !== undefined && answered.over === followed.members
      ? { items: answered.items }
      : followed.members !== undefined
        ? { items: followed.members }
        : followed.refused
          ? { failed: READ_FAILED.MEMBERS }
          : undefined;
  return {
    read,
    retry: followed.retry,
    changed: (items: readonly WorkspaceMember[]) => setAnswered({ over: followed.members, items }),
  };
}

/**
 * One member's row: their face, their name with You on the reader's own,
 * their email under it, and their role as the row's value in one column,
 * then in its ⋯ their profile, where the window offers one, and what the
 * reader may do to them (`memberActs`). Make admin
 * and Make member take hold at once, since either is undone by the other;
 * Make owner and Remove from workspace ask first. A role change refused is
 * said under the row. A row with no ⋯ in a list where others have one
 * keeps the ⋯'s room, so every role ends in the same place. The row is
 * `@luke/ui`'s `SettingsRow` led by the face, through `MenuRow`.
 */
function MemberRow({
  workspace,
  member,
  readerId,
  slotted,
  onChanged,
}: {
  workspace: Workspace;
  member: WorkspaceMember;
  /** The reader's account id, whose own row wears You. */
  readerId: string | undefined;
  /** Whether the list's rows may carry a ⋯, so one without keeps its room. */
  slotted: boolean;
  onChanged: (members: readonly WorkspaceMember[]) => void;
}): React.JSX.Element {
  const { act } = useAct();
  const workspaceId = workspace.id;
  const { userId } = member;
  const may = memberActs(workspace, member, userId === readerId);
  const [refusal, setRefusal] = useState<string>();
  const answered = (members: readonly WorkspaceMember[]) => {
    onChanged(members);
    return ACCEPTED;
  };
  const remove = useConfirmDialog({ subject: may.remove, surfaceOpen: true }, () =>
    act(ACT_KIND.WORKSPACE_MEMBER_REMOVE, { workspaceId, userId }).then(answered, refusedWith),
  );
  const makeOwner = useConfirmDialog({ subject: may.transfer, surfaceOpen: true }, () =>
    act(ACT_KIND.WORKSPACE_TRANSFER, { workspaceId, userId }).then(answered, refusedWith),
  );
  const giveRole = (role: WorkspaceInvitation["role"]) => {
    setRefusal(undefined);
    act(ACT_KIND.WORKSPACE_MEMBER_ROLE, { workspaceId, userId, role }).then(
      onChanged,
      (refused: Error) => setRefusal(refused.message),
    );
  };
  const openPerson = useOpenPerson();
  const profileActs =
    openPerson === undefined
      ? []
      : [
          {
            label: "Open profile",
            icon: <UserRoundIcon />,
            onSelect: () => openPerson(userId, member.name, workspaceId),
          },
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
          label: "Remove from workspace",
          icon: <UserMinusIcon />,
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
          leading: <ActorMark actor={memberActor(member, readerId)} size={ACTOR_SIZE.CARD} />,
          label: (
            // The person card's own wrapper, so You stands off the name as it does on the card.
            <span className="actor-card-name">
              {member.name}
              {userId === readerId ? <YouBadge /> : null}
            </span>
          ),
          description: <OneLine hint={wholeWordsHint(member.email)}>{member.email}</OneLine>,
          error: refusal,
          control: (
            <>
              <SettingsRowValue>{ROLE_WORDS[member.role]}</SettingsRowValue>
              {slotted && !acting ? <SettingsRowActSlot /> : null}
            </>
          ),
        }}
      />
      <ConfirmDialog
        confirm={remove}
        question={{
          title: `Remove ${member.name} from this workspace?`,
          body: "They lose its tasks, agents, and Inbox until they are invited again.",
          verb: "Remove",
          running: "Removing",
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
        }}
      />
      <ConfirmDialog
        confirm={makeOwner}
        question={{
          title: `Make ${member.name} the owner of ${workspace.name}?`,
          body: TRANSFER_WORDS.ONE_BODY(member.name),
          verb: ROLE_ACT.MAKE_OWNER,
          running: TRANSFER_WORDS.RUNNING,
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
        }}
      />
    </Stack>
  );
}

/**
 * The automations the reader made in the workspace, by name, which a leave
 * stops, read afresh each time the leave is asked, since one made in
 * another window meanwhile stops too; undefined until that read lands, and
 * where the service does not say whose they are, which the dialog says
 * without names.
 */
function useOwnAutomations(workspaceId: string) {
  const { act } = useAct();
  const [names, setNames] = useState<readonly string[] | undefined>(undefined);
  // Note that only the read asked last is shown, because two leaves asked in turn can answer out of order.
  const latest = useRef(0);
  const read = () => {
    const asked = ++latest.current;
    setNames(undefined);
    act(ACT_KIND.AUTOMATIONS_LIST, { workspaceId }).then(
      (view) => {
        if (asked !== latest.current || "failure" in view) return;
        if (view.automations.some((each) => each.mine === undefined)) return;
        setNames(view.automations.filter((each) => each.mine === true).map((each) => each.name));
      },
      () => undefined,
    );
  };
  return { names, read };
}

/**
 * The leave for a member or an admin: drawn as Profile's Delete account is,
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
  const { act } = useAct();
  const show = useToast();
  const workspaceId = workspace.id;
  const automations = useOwnAutomations(workspaceId);
  const leave = useConfirmDialog({ subject: true, surfaceOpen: true }, () =>
    act(ACT_KIND.WORKSPACE_LEAVE, { workspaceId }).then(() => {
      show({
        words: LEAVE_WORDS.LEFT(workspace.name),
        tone: STATUS_TONE.COMPLETE,
        hold: TOAST_HOLD.DONE,
      });
      onLeft();
      return ACCEPTED;
    }, refusedWith),
  );
  const automationsLine =
    automations.names === undefined
      ? LEAVE_WORDS.AUTOMATIONS
      : automations.names.length === 0
        ? undefined
        : LEAVE_WORDS.AUTOMATIONS_NAMED(automations.names);
  return (
    <>
      <SettingsRow label={`Leave ${workspace.name}`} description={LEAVE_WORDS.LINE}>
        {() => (
          <Button
            variant={BUTTON_VARIANT.DANGER_OUTLINE}
            busy={leave.busy}
            busyLabel={LEAVE_WORDS.RUNNING}
            onClick={() => {
              automations.read();
              leave.ask();
            }}
          >
            Leave
          </Button>
        )}
      </SettingsRow>
      <ConfirmDialog
        confirm={leave}
        question={{
          title: `Leave ${workspace.name}?`,
          body: LEAVE_WORDS.LINE,
          verb: `Leave ${workspace.name}`,
          running: LEAVE_WORDS.RUNNING,
          loss: CONFIRM_LOSS.IRREVERSIBLE,
        }}
      >
        <ul className="leave-consequences">
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
      <div className="workspace-heir">
        <Chip
          look={CHIP_LOOK.FIELD}
          chevron
          ref={door}
          id={id}
          aria-label={`New owner: ${chosen.name}`}
          {...menu.trigger()}
        >
          <ActorMark actor={memberActor(chosen, undefined)} size={ACTOR_SIZE.INLINE} />
          <ChipName>{chosen.name}</ChipName>
        </Chip>
      </div>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label="New owner"
          menu={menu.drawn}
          groups={[
            memberRows(admins, undefined).map((row) => ({
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
 * first. The members the service answers after the handover stand in at
 * once, and the reader's own new role arrives with the followed workspaces,
 * which turns this row into a member's leave.
 */
function OwnerLeave({
  workspace,
  members,
  onChanged,
}: {
  workspace: Workspace;
  members: ListRead<WorkspaceMember>;
  onChanged: (members: readonly WorkspaceMember[]) => void;
  /** Reads the members again keeping the list on screen, so the admins offered are the workspace's now. */
}): React.JSX.Element {
  const { act } = useAct();
  // Note that the admins stand in the order the menu lists them, so the first offered is the first listed.
  const admins = memberRows(
    members !== undefined && "items" in members
      ? members.items.filter((each) => each.role === WORKSPACE_ROLE.ADMIN)
      : [],
    undefined,
  ).map((row) => row.member);
  const [chosenId, setChosenId] = useState<string>();
  const heir = admins.find((each) => each.userId === chosenId) ?? admins[0];
  const transfer = useConfirmDialog({ subject: heir !== undefined, surfaceOpen: true }, () =>
    heir === undefined
      ? Promise.resolve(ACCEPTED)
      : act(ACT_KIND.WORKSPACE_TRANSFER, { workspaceId: workspace.id, userId: heir.userId }).then(
          (items) => {
            onChanged(items);
            return ACCEPTED;
          },
          refusedWith,
        ),
  );
  return (
    <>
      <SettingsRow
        label={`Leave ${workspace.name}`}
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
        <ConfirmDialog
          confirm={transfer}
          gate={workspace.name}
          question={{
            title: `Transfer ownership of ${workspace.name}`,
            body: TRANSFER_WORDS.BODY,
            verb: TRANSFER_WORDS.VERB,
            running: TRANSFER_WORDS.RUNNING,
            loss: CONFIRM_LOSS.AFFECTS_OTHERS,
          }}
        >
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
  onChanged,
}: {
  workspace: Workspace;
  members: ListRead<WorkspaceMember>;
  /** The name of the account's own workspace, which a leave leaves alone; absent from a service that names none. */
  ownName: string | undefined;
  onLeft: () => void;
  onChanged: (members: readonly WorkspaceMember[]) => void;
}): React.JSX.Element | null {
  const owner = workspace.role === WORKSPACE_ROLE.OWNER;
  if (owner && workspace.personal === true) return null;
  return (
    <SettingsSection anchor={SETTINGS_SECTION.LEAVE}>
      {owner ? (
        <OwnerLeave workspace={workspace} members={members} onChanged={onChanged} />
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
  onChanged,
}: {
  workspace: Workspace;
  readerId: string | undefined;
  members: ListRead<WorkspaceMember>;
  onRetry: () => void;
  onChanged: (members: readonly WorkspaceMember[]) => void;
}): React.JSX.Element {
  const manages = managesWorkspace(workspace);
  if (members === undefined) {
    return (
      <SettingsRowsSkeleton
        label="Loading the members"
        rows={Array.from(
          { length: Math.min(workspace.memberCount ?? 1, MEMBERS_SKELETON_MOST) },
          () => MEMBER_ROW_SKELETON,
        )}
      />
    );
  }
  if ("failed" in members) return <ReadFailed line={members.failed} onRetry={onRetry} />;
  return (
    <>
      {members.items.map((member) => (
        <MemberRow
          key={member.userId}
          workspace={workspace}
          member={member}
          readerId={readerId}
          slotted={manages}
          onChanged={onChanged}
        />
      ))}
    </>
  );
}

/**
 * The role an invitation is sent as: the field chip a Settings picker wears,
 * "Member ⌄", whose menu checks the role chosen and says under each what it
 * may do, as the composer's model chip stands beside its field and its send.
 * It is `@luke/ui`'s field `Chip`, its one width its container's.
 */
function RoleChip({
  value,
  disabled,
  adminAllowed,
  onChange,
}: {
  value: WorkspaceInvitation["role"];
  disabled: boolean;
  /** Whether the reader may invite an admin, which only the owner may; an admin's menu offers Admin dimmed. */
  adminAllowed: boolean;
  onChange: (role: WorkspaceInvitation["role"]) => void;
}): React.JSX.Element {
  // The page is drawn whenever the chip is, so the menu closes with the chip unmounting.
  const menu = useMenu(true);
  const door = useRef<HTMLButtonElement | null>(null);
  return (
    <Inline wrap={false}>
      <Chip
        look={CHIP_LOOK.FIELD}
        width={CHIP_WIDTH.FIXED}
        chevron
        ref={door}
        aria-label={`Invite as ${ROLE_WORDS[value]}`}
        disabled={disabled}
        {...menu.trigger()}
      >
        {ROLE_WORDS[value]}
      </Chip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label="Invite as"
          menu={menu.drawn}
          groups={[
            INVITATION_ROLES.map((role) => {
              const barred = role === INVITATION_ROLE.ADMIN && !adminAllowed;
              return {
                label: ROLE_WORDS[role],
                detail: barred ? OWNER_INVITES_ADMINS : ROLE_DETAIL[role],
                checked: role === value,
                disabled: barred,
                onSelect: () => onChange(role),
              };
            }),
          ]}
          onClose={menu.close}
        />
      )}
    </Inline>
  );
}

/**
 * The workspace's invitations, for an owner or an admin: the form that
 * invites an address as a member or an admin, then those still pending,
 * each under the outline face a person not yet in wears, saying as what and
 * until when, with its link to copy and Cancel invitation in its ⋯, which asks
 * first in the accent rather than red: inviting the address again undoes it,
 * but the link already sent to the invitee stops working. A refusal is
 * said under the form. The form is `@luke/ui`'s `TextField`, the role's
 * chip, and Invite its outline `Button`; each pending one is a `SettingsRow`
 * led by the face, through `MenuRow`, Copy link its outline `Button`.
 */
function Invitations({
  workspaceId,
  owner,
}: {
  workspaceId: string;
  /** Whether the reader owns the workspace, the one role that invites an admin. */
  owner: boolean;
}): React.JSX.Element {
  const { act } = useAct();
  const copy = useCopyToast();
  const [pending, setPendingState] = useState<readonly WorkspaceInvitation[] | undefined>(
    undefined,
  );
  const [firstReadFailed, setFirstReadFailed] = useState<string>();
  const pendingRead = useRef(false);
  const setPending: typeof setPendingState = (next) => {
    pendingRead.current = true;
    setFirstReadFailed(undefined);
    setPendingState(next);
  };
  const [email, setEmail] = useState("");
  const emailField = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<WorkspaceInvitation["role"]>(INVITATION_ROLE.MEMBER);
  const [note, setNote] = useState<string>();
  const [writing, setWriting] = useState<InvitationWrite>();
  const busy = writing !== undefined;
  // Note that the press reads a ref rather than `busy`, because a second
  // press can land before the render that would disable the button.
  const sending = useRef(false);
  // Note that only the list last asked for is shown, because a read, an
  // invite's re-read, and a cancel can answer out of the order they were asked.
  const latest = useRef(0);
  // Note that a write's answer is passed over where the stream told a list
  // while it was out, since that list may already hold a newer change, such
  // as another window canceling what this one just invited.
  const streamed = useRef(0);
  const show = (listed: Promise<readonly WorkspaceInvitation[]>) => {
    const asked = ++latest.current;
    listed.then(
      (invitations) => {
        if (asked === latest.current) setPending(invitations);
      },
      (refused: Error) => {
        if (asked !== latest.current) return;
        // A list never read is not an empty one: it says so with Retry in its place.
        if (pendingRead.current) setNote(refused.message);
        else setFirstReadFailed(READ_FAILED.INVITATIONS);
      },
    );
  };
  // Note that one write runs at a time, invite or cancel, so no list read
  // after one can see the service before another has settled.
  const write = <A,>(
    which: InvitationWrite,
    made: () => Promise<A>,
    done: (answer: A, fresh: boolean) => void,
  ) => {
    if (sending.current) return;
    sending.current = true;
    setWriting(which);
    setNote(undefined);
    const before = streamed.current;
    made()
      .then(
        (answer) => done(answer, streamed.current === before),
        (refused: Error) => setNote(refused.message),
      )
      .finally(() => {
        sending.current = false;
        setWriting(undefined);
      });
  };

  const read = () => {
    setFirstReadFailed(undefined);
    show(act(ACT_KIND.WORKSPACE_INVITATIONS_READ, { workspaceId }));
  };

  useEffect(() => {
    read();
    return () => {
      latest.current += 1;
    };
  }, [act, workspaceId]);

  // The invitations are followed while the group stands: what any window or
  // Mac invites or cancels, or what is accepted, is streamed, and is the
  // newest word of them, whatever read is out.
  useEffect(
    () =>
      streamFrom(
        () => actPort()[ACT_KIND.WORKSPACE_INVITATIONS]({ workspaceId }),
        (view) => {
          if (!("invitations" in view)) return;
          latest.current += 1;
          streamed.current += 1;
          setPending(view.invitations);
        },
      ),
    [workspaceId],
  );

  // The invitation made is listed at once, its link copyable, and the
  // followed list then carries it as the service holds it.
  const invite = (event: React.FormEvent) => {
    event.preventDefault();
    write(
      INVITATION_WRITE.INVITE,
      () => act(ACT_KIND.WORKSPACE_INVITE, { workspaceId, email, role }),
      (made, fresh) => {
        setEmail("");
        if (!fresh) return;
        latest.current += 1;
        setPending((standing) => [...(standing ?? []).filter((one) => one.id !== made.id), made]);
      },
    );
  };

  const cancel = (invitationId: string) =>
    write(
      INVITATION_WRITE.CANCEL,
      () => act(ACT_KIND.WORKSPACE_INVITATION_CANCEL, { workspaceId, invitationId }),
      // The cancel's own answer is the list after it, so a read out before it is passed over.
      (left, fresh) => {
        if (!fresh) return;
        latest.current += 1;
        setPending(left);
      },
    );

  // Note that the question goes with its invitation, canceled or accepted meanwhile.
  const [cancelling, setCancelling] = useState<WorkspaceInvitation>();
  const cancellation = useConfirmDialog(
    {
      subject: cancelling !== undefined && (pending ?? []).some((one) => one.id === cancelling.id),
      surfaceOpen: true,
    },
    () => {
      if (cancelling !== undefined) cancel(cancelling.id);
      return Promise.resolve(ACCEPTED);
    },
  );

  return (
    <>
      <Stack gap={GAP.NONE}>
        <div className="workspace-invite">
          <Inline
            as={LAYOUT_ELEMENT.FORM}
            align={ALIGN.END}
            justify={JUSTIFY.END}
            grow
            growFirst
            onSubmit={invite}
          >
            <FormField label="Email address">
              {(field) => (
                <TextField
                  ref={emailField}
                  field={field}
                  type={TEXT_FIELD_TYPE.EMAIL}
                  required
                  placeholder="name@example.com"
                  autoComplete={TEXT_FIELD_AUTO_COMPLETE.OFF}
                  spellCheck={false}
                  value={email}
                  disabled={busy}
                  // Note that Escape lets go of the field and keeps the words, rather than leaving Settings.
                  onEscape={() => emailField.current?.blur()}
                  onChange={setEmail}
                />
              )}
            </FormField>
            <RoleChip value={role} disabled={busy} adminAllowed={owner} onChange={setRole} />
            <Button
              type={BUTTON_TYPE.SUBMIT}
              variant={BUTTON_VARIANT.OUTLINE}
              busy={writing === INVITATION_WRITE.INVITE}
              busyLabel="Inviting"
              disabled={writing === INVITATION_WRITE.CANCEL}
            >
              Invite
            </Button>
          </Inline>
        </div>
        {note === undefined ? null : (
          <SettingsLine>
            <ErrorState>{note}</ErrorState>
          </SettingsLine>
        )}
      </Stack>
      {firstReadFailed !== undefined ? (
        <ReadFailed line={firstReadFailed} onRetry={read} />
      ) : pending === undefined ? (
        <SettingsRowsSkeleton label="Loading the invitations" rows={[INVITATION_ROW_SKELETON]} />
      ) : pending.length === 0 ? (
        <SettingsLine>{INVITATIONS_EMPTY}</SettingsLine>
      ) : null}
      {(pending ?? []).map((one) => (
        <MenuRow
          key={one.id}
          thing={one.email}
          actions={[
            {
              label: "Cancel invitation",
              icon: <XIcon />,
              danger: true,
              disabled: busy,
              onSelect: () => {
                setCancelling(one);
                cancellation.ask();
              },
            },
          ]}
          row={{
            leading: <ActorMark actor={INVITED_ACTOR} size={ACTOR_SIZE.CARD} />,
            label: <OneLine hint={wholeWordsHint(one.email)}>{one.email}</OneLine>,
            description: `Invited as ${ROLE_WORDS[one.role]} · Expires ${dayAndTimeText(Date.parse(one.expiresAt))}`,
            // Luke sends no mail: the accept link is copied and sent by hand.
            control: (
              <Button
                variant={BUTTON_VARIANT.OUTLINE}
                onClick={() => copy(one.acceptUrl, "Link copied")}
              >
                Copy link
              </Button>
            ),
          }}
        />
      ))}
      <ConfirmDialog
        confirm={cancellation}
        question={{
          title: "Cancel invitation?",
          body: `The link sent to ${cancelling?.email ?? ""} stops working. Inviting the address again sends a new one.`,
          verb: "Cancel invitation",
          running: "Canceling",
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
        }}
      />
    </>
  );
}

/**
 * The GitHub accounts connected to the workspace, the first linked first:
 * every one a service with several lists, else the one a service from
 * before them names.
 */
function connectionsOf(workspace: Workspace): readonly ShownConnection[] {
  if (workspace.githubInstallations !== undefined) return workspace.githubInstallations;
  return workspace.github === null ? [] : [workspace.github];
}

/**
 * One connected account's row, inset under GitHub's so it reads as one of
 * GitHub's accounts rather than an integration of its own: its picture on
 * GitHub, an organization's logo or a person's avatar, its login, and under
 * it Connected, or that GitHub suspended or removed its installation. The
 * tile is a workspace's, keyed by the login, so the login's letter stands
 * until the picture loads and wherever it fails to. It is `@luke/ui`'s
 * `SettingsRow`, indented to GitHub's words.
 */
function ConnectionRow({ connection }: { connection: ShownConnection }): React.JSX.Element {
  return (
    <SettingsRow
      indent={SETTINGS_ROW_INDENT.MARK}
      leading={
        <SettingsRowMark>
          <WorkspaceTile
            workspace={{
              id: `github:${connection.login}`,
              name: connection.login,
              pictureUrl: githubAccountPictureUrl(connection.login),
            }}
            size={TILE_SIZE.NESTED}
          />
        </SettingsRowMark>
      }
      label={connection.login}
      description={
        connection.active ? (
          <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
            {GITHUB_CONNECTED}
          </SettingsRowStateLine>
        ) : (
          <SettingsRowStateLine state={SETTINGS_ROW_STATE.ATTENTION}>
            {GITHUB_SUSPENDED}
          </SettingsRowStateLine>
        )
      }
    >
      {() => null}
    </SettingsRow>
  );
}

/**
 * The workspace's GitHub, for an owner or an admin: Connect while none is,
 * which installs the Luke GitHub App on a GitHub account for this
 * workspace, and once one is, Manage on GitHub, which opens the same page:
 * GitHub lists every account there, to install the App on another or to
 * configure one it is on, so one door does both. Either press opens the
 * browser through the one connect, whose return to Luke adds the
 * installation to this workspace; a page that could not be opened says why
 * under the row. The row is `@luke/ui`'s `SettingsRow` led by GitHub's mark,
 * its press the outline `Button`.
 */
function ManagedGitHub({
  workspace,
  connections,
  add,
  addRefusal,
}: {
  workspace: Workspace;
  connections: readonly ShownConnection[];
  /** Add repository, which stands before the row's own press. */
  add: React.ReactNode;
  /** What the last add was refused with, said under the row. */
  addRefusal: string | undefined;
}): React.JSX.Element {
  const { act } = useAct();
  const workspaceId = workspace.id;
  const [refusal, setRefusal] = useState<string>();
  // Note that a second press while the browser is being sent is taken as none, as Linear's is.
  const [opening, setOpening] = useState(false);
  const underWay = useRef(false);
  const open = () => {
    if (underWay.current) return;
    underWay.current = true;
    setOpening(true);
    setRefusal(undefined);
    act(ACT_KIND.WORKSPACE_GITHUB_CONNECT, { workspaceId })
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
        description={connected ? GITHUB_CONNECTED_LINE.MANAGES : GITHUB_UNCONNECTED.MANAGES}
        error={refusal ?? addRefusal}
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
                Connect
              </Button>
            )}
          </>
        )}
      </SettingsRow>
    </Stack>
  );
}

/**
 * The workspace's GitHub: an owner's or an admin's to connect, and for a
 * member, read only, or the ask to have it; then every account connected,
 * the same for both, and every repository a member added on their own
 * token (`workspace-token-repositories.tsx`), which any member adds from
 * GitHub's row.
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
  return (
    <>
      {managesWorkspace(workspace) ? (
        <ManagedGitHub
          workspace={workspace}
          connections={connections}
          add={add}
          addRefusal={addRefusal}
        />
      ) : (
        <SettingsRow
          leading={GITHUB_MARK}
          label="GitHub"
          description={
            connections.length === 0 ? GITHUB_UNCONNECTED.MEMBER : GITHUB_CONNECTED_LINE.MEMBER
          }
          error={addRefusal}
        >
          {() => add}
        </SettingsRow>
      )}
      {connections.map((connection) => (
        <ConnectionRow
          key={connection.installationId ?? connection.login}
          connection={connection}
        />
      ))}
      <TokenRepositoryRows repositories={repositories} />
    </>
  );
}

/** The workspace's Linear row's line: whether its one connection stands. */
function linearLine(linear: Workspace["linear"], manages: boolean): React.ReactNode {
  if (linear === undefined) return manages ? LINEAR_LINE.MANAGES : LINEAR_LINE.MEMBER;
  return linear.active ? (
    <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
      {LINEAR_LINE.CONNECTED}
    </SettingsRowStateLine>
  ) : (
    <SettingsRowStateLine state={SETTINGS_ROW_STATE.ATTENTION}>
      {manages ? LINEAR_LINE.EXPIRED : LINEAR_LINE.EXPIRED_MEMBER}
    </SettingsRowStateLine>
  );
}

/**
 * The workspace's Linear, for an owner or an admin: Connect while none is,
 * or Connect again once Linear stopped honoring it, which opens Linear's
 * sign-in in the browser, a sign-in that could not be begun saying why
 * under the row; and a ⋯ once one stands, as Settings › Integrations keeps
 * a connected row quiet, whose menu holds Disconnect, which asks first. A
 * plan already started from an issue keeps what it read. The row is
 * `MenuRow`'s `SettingsRow` led by Linear's mark, its press the outline
 * `Button`.
 */
function ManagedLinear({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const { act } = useAct();
  const { linear } = workspace;
  const workspaceId = workspace.id;
  const [refusal, setRefusal] = useState<string>();
  // Note that a second press while the browser is being sent is taken as
  // none, because a sign-in begun again replaces the first one's state.
  const [connecting, setConnecting] = useState(false);
  const underWay = useRef(false);
  const connect = () => {
    if (underWay.current) return;
    underWay.current = true;
    setConnecting(true);
    setRefusal(undefined);
    act(ACT_KIND.WORKSPACE_LINEAR_CONNECT, { workspaceId })
      .catch((refused: Error) => setRefusal(refused.message))
      .finally(() => {
        underWay.current = false;
        setConnecting(false);
      });
  };
  const disconnect = useConfirmDialog({ subject: linear !== undefined, surfaceOpen: true }, () =>
    act(ACT_KIND.WORKSPACE_LINEAR_DISCONNECT, { workspaceId }).then(() => ACCEPTED, refusedWith),
  );
  const actions =
    linear === undefined
      ? []
      : [[{ label: "Disconnect", icon: <TrashIcon />, danger: true, onSelect: disconnect.ask }]];
  return (
    <Stack gap={GAP.NONE}>
      <MenuRow
        thing="Linear"
        actions={actions}
        row={{
          leading: LINEAR_MARK,
          label: "Linear",
          description: linearLine(linear, true),
          error: refusal,
          control:
            linear?.active === true ? null : (
              <Button
                variant={BUTTON_VARIANT.OUTLINE}
                busy={connecting}
                busyLabel="Connecting"
                onClick={connect}
              >
                {linear === undefined ? "Connect" : "Connect again"}
              </Button>
            ),
        }}
      />
      <ConfirmDialog
        confirm={disconnect}
        question={{
          title: `Disconnect Linear from ${workspace.name}?`,
          body: "Nobody in the workspace can start a task from an issue until Linear is connected again.",
          verb: "Disconnect",
          running: "Disconnecting",
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
        }}
      />
    </Stack>
  );
}

/**
 * The workspace's Linear: an owner's or an admin's to connect for
 * everyone, and for a member, read only, whether it is connected or the ask
 * to have it.
 */
function WorkspaceLinear({ workspace }: { workspace: Workspace }): React.JSX.Element {
  if (managesWorkspace(workspace)) return <ManagedLinear workspace={workspace} />;
  return (
    <SettingsRow
      leading={LINEAR_MARK}
      label="Linear"
      description={linearLine(workspace.linear, false)}
    >
      {() => null}
    </SettingsRow>
  );
}

/** The Sentry row's line: the organizations it is installed on, or the ask to install it. */
function sentryLine(sentry: WorkspaceSentry, manages: boolean): React.ReactNode {
  if (sentry.installations.length === 0) return manages ? SENTRY_LINE.MANAGES : SENTRY_LINE.MEMBER;
  const accounts = sentry.installations.flatMap((one) =>
    one.account === undefined ? [] : [one.account],
  );
  return (
    <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
      {SENTRY_LINE.INSTALLED(accounts.join(", "))}
    </SettingsRowStateLine>
  );
}

/**
 * The workspace's Sentry, for an owner or an admin: Install for workspace
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
  onChanged,
}: {
  workspace: Workspace;
  sentry: WorkspaceSentry;
  onChanged: (sentry: WorkspaceSentry) => void;
}): React.JSX.Element {
  const { act } = useAct();
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
    act(ACT_KIND.WORKSPACE_SENTRY_INSTALL, { workspaceId })
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
  const disconnect = useConfirmDialog({ subject: stillListed, surfaceOpen: true }, () =>
    leaving === undefined
      ? Promise.resolve(ACCEPTED)
      : act(ACT_KIND.WORKSPACE_SENTRY_DISCONNECT, {
          workspaceId,
          installationId: leaving.installationId,
        }).then((now) => {
          onChanged(now);
          return ACCEPTED;
        }, refusedWith),
  );
  const actions = [
    sentry.installations.map((installation) => ({
      label:
        installation.account === undefined ? "Disconnect" : `Disconnect ${installation.account}`,
      icon: <TrashIcon />,
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
        actions={actions}
        row={{
          leading: SENTRY_MARK,
          label: "Sentry",
          description: sentryLine(sentry, true),
          error: refusal,
          control:
            sentry.installations.length > 0 ? null : (
              <Button
                variant={BUTTON_VARIANT.OUTLINE}
                busy={installing}
                busyLabel="Opening Sentry"
                onClick={install}
              >
                Install for workspace
              </Button>
            ),
        }}
      />
      <ConfirmDialog
        confirm={disconnect}
        question={{
          title: `Disconnect Sentry from ${workspace.name}?`,
          body: "Its alerts and new issues stop triggering this workspace's automations. Uninstall Luke in Sentry's settings to remove it there too.",
          verb: "Disconnect",
          running: "Disconnecting",
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
        }}
      />
    </Stack>
  );
}

/**
 * The workspace's Sentry: drawn only where the deployment holds Luke's
 * Sentry integration, an owner's or an admin's to install for everyone,
 * and for a member, read only, where it is installed or the ask to have it.
 */
function WorkspaceSentryRow({ workspace }: { workspace: Workspace }): React.JSX.Element | null {
  const { read, changed } = useSentryRead(workspace.id);
  if (read === undefined || !read.configured) return null;
  if (managesWorkspace(workspace)) {
    return <ManagedSentry workspace={workspace} sentry={read} onChanged={changed} />;
  }
  return (
    <SettingsRow leading={SENTRY_MARK} label="Sentry" description={sentryLine(read, false)}>
      {() => null}
    </SettingsRow>
  );
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

/** A picked file read into a workspace's photo: the `data:` URL to send, or why it cannot be one. */
type PhotoRead = { readonly photo: string } | { readonly refusal: string };

/**
 * A picked file drawn as a workspace's photo on this machine: its centre
 * square at `PHOTO_EDGE` pixels a side, written as WebP. Note that it is
 * encoded with no bound of its own, because a photo past the service's is
 * said as too large rather than as a file that could not be read.
 */
async function photoOfFile(file: File): Promise<PhotoRead> {
  if (!PHOTO_TYPES.has(file.type)) return { refusal: PHOTO_REFUSAL.KIND(file.name) };
  const image = await encodeImage(file, Number.POSITIVE_INFINITY, PHOTO_EDGE);
  if (image === undefined) return { refusal: PHOTO_REFUSAL.UNREADABLE(file.name) };
  const photo = `data:${image.mediaType};base64,${image.base64}`;
  const bytes = workspacePhotoOfDataUrl(photo)?.bytes.length;
  if (bytes === undefined) return { refusal: PHOTO_REFUSAL.UNREADABLE(file.name) };
  if (bytes > WORKSPACE_PHOTO_BOUNDS.MAX_BYTES) {
    return { refusal: PHOTO_REFUSAL.TOO_LARGE(file.name) };
  }
  return { photo };
}

/** Who the reader is in the workspace, in the identity row's line. */
const ROLE_SENTENCE = {
  [WORKSPACE_ROLE.OWNER]: "You're the owner",
  [WORKSPACE_ROLE.ADMIN]: "You're an admin",
  [WORKSPACE_ROLE.MEMBER]: "You're a member",
} as const satisfies Record<Workspace["role"], string>;

/** The identity row's line: who shares the workspace, as the switcher says it, and the reader's role, which an account's own workspace with nobody else in it leaves unsaid. */
function identityLine(workspace: Workspace): string {
  const personal = workspace.personal === true;
  const shared = sharedWords(workspace.memberCount, personal);
  if (personal && (workspace.memberCount ?? 1) <= 1 && shared !== undefined) return shared;
  return shared === undefined
    ? ROLE_SENTENCE[workspace.role]
    : `${shared} · ${ROLE_SENTENCE[workspace.role]}`;
}

/**
 * The page's first row, drawn as Profile's account row is: the workspace's
 * tile, its name, who shares it and the reader's role in one line, then for
 * an owner or an admin Rename, and the photo's acts in its ⋯. Rename opens
 * the name in place on its own line, as the sidebar renames a task, and
 * Return or a press elsewhere sends what was typed with its ends trimmed,
 * while Escape, an empty name, or the same one renames nothing; an account's
 * first workspace is named by its owner's account name, so it offers no
 * Rename. Upload photo picks a PNG, JPEG, or WebP image and sends it drawn
 * square; Remove photo, where one is set, asks first. The new name or photo
 * arrives with the workspaces the host reads again after it; a refusal, or a
 * file that cannot be a photo, is said under the row until the next try.
 * The row is `@luke/ui`'s `SettingsRow` led by the tile, through `MenuRow`,
 * and Rename its outline `Button`.
 */
function WorkspaceIdentity({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const { act } = useAct();
  const workspaceId = workspace.id;
  const manages = managesWorkspace(workspace);
  const renamable = manages && workspace.personal !== true;
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [refusal, setRefusal] = useState<string>();
  const button = useRef<HTMLButtonElement | null>(null);
  const set = workspace.photoVersion !== undefined;
  const remove = useConfirmDialog({ subject: manages && set, surfaceOpen: true }, () =>
    act(ACT_KIND.WORKSPACE_PHOTO_SET, { workspaceId, photo: null }).then(
      () => ACCEPTED,
      refusedWith,
    ),
  );
  // Note that focus goes back to Rename once the rename has settled, because
  // the button is disabled while it is out and a disabled one takes no focus.
  const endedByKey = useRefocusAfterEdit(editing || renaming, button);
  const end = ({ value: name, byKey }: InlineEditEnd) => {
    endedByKey(byKey);
    setEditing(false);
    if (name === undefined) return;
    setRenaming(true);
    act(ACT_KIND.WORKSPACE_RENAME, { workspaceId, name })
      .then(
        () => undefined,
        (refused: Error) => setRefusal(refused.message),
      )
      .finally(() => setRenaming(false));
  };
  const upload = (file: File) => {
    setRefusal(undefined);
    setUploading(true);
    photoOfFile(file)
      .then((read) => {
        if ("refusal" in read) throw new Error(read.refusal);
        return act(ACT_KIND.WORKSPACE_PHOTO_SET, { workspaceId, photo: read.photo });
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
        ],
        // An upload still under way would put a photo back after its removal, so none is asked meanwhile.
        set
          ? [
              {
                label: PHOTO_WORDS.REMOVE,
                icon: <TrashIcon />,
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
        disabled={renaming}
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
    <Stack gap={GAP.NONE}>
      <MenuRow
        thing="Workspace"
        actions={actions}
        row={{
          leading: <WorkspaceTile workspace={workspace} size={TILE_SIZE.HEAD} />,
          label: (
            <InlineEdit
              value={workspace.name}
              label="Workspace name"
              editing={editing}
              maxLength={WORKSPACE_BOUNDS.MAX_NAME_CHARS}
              look={INLINE_EDIT_LOOK.INPUT}
              onEnd={end}
            />
          ),
          description: identityLine(workspace),
          error: refusal,
          control: (
            <>
              {rename}
              {photoPicker}
            </>
          ),
        }}
      />
      <ConfirmDialog
        confirm={remove}
        question={{
          title: `Remove ${workspace.name}'s photo?`,
          verb: "Remove",
          running: "Removing",
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
        }}
      />
    </Stack>
  );
}

/**
 * The page for the listed workspace, one kind of thing to a group: its
 * identity, its members, its invitations for an owner or an admin, its
 * GitHub, and last the leave for anyone but an owner, the members and
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
        <ReadFailed line="Your workspaces could not be read." onRetry={control.onRetryList} />
      </SettingsSection>
    ) : (
      <SettingsSectionsSkeleton label="Loading your workspaces" sections={WORKSPACE_SKELETON} />
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
  const macTerminalOffered = useCapability(HOST_CAPABILITY.MAC_TERMINAL);
  return (
    <>
      <SettingsSection>
        <WorkspaceIdentity workspace={workspace} />
      </SettingsSection>
      <SettingsSection title="Members" anchor={SETTINGS_SECTION.MEMBERS}>
        <TeamMembers
          workspace={workspace}
          readerId={readerId}
          members={members.read}
          onRetry={members.retry}
          onChanged={members.changed}
        />
      </SettingsSection>
      {managesWorkspace(workspace) ? (
        <SettingsSection title="Invitations" anchor={SETTINGS_SECTION.INVITATIONS}>
          <Invitations workspaceId={workspace.id} owner={workspace.role === WORKSPACE_ROLE.OWNER} />
        </SettingsSection>
      ) : null}
      <SettingsSection title="Integrations" anchor={SETTINGS_SECTION.GITHUB_REPOSITORIES}>
        {WORKSPACE_INTEGRATIONS.map(({ service, Row }) => (
          <Row key={service} workspace={workspace} />
        ))}
      </SettingsSection>
      {macTerminalOffered ? <MacRepositoriesGroup workspaceId={workspace.id} /> : null}
      <LeaveGroup
        workspace={workspace}
        members={members.read}
        ownName={ownName}
        onLeft={() => control.onLeft(workspace.id)}
        onChanged={members.changed}
      />
    </>
  );
}
