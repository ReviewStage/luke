import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
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
  type WorkspaceMember,
  workspacePhotoOfDataUrl,
} from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { SETTINGS_SECTION } from "@luke/settings/settings-views";
import { ProviderMark, TrashIcon } from "@luke/ui";
import { ACTOR_KIND, memberActor, ROLE_WORDS, SOMEONE_REASON } from "@luke/ui/actor-model";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { ExternalLinkIcon, ImageUpIcon, UserMinusIcon, XIcon } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { useAct } from "../act";
import { ACTOR_SIZE, ActorMark, YouBadge } from "../actor-ref";
import { CHIP_LOOK, Chip } from "../chip";
import { useCopyToast } from "../copy-feedback";
import { ActionMenu, useActionMenu } from "../desktop/action-menu";
import { type NameEdit, PlanNameField } from "../desktop/plan-name-field";
import { sharedWords } from "../desktop/workspace-ref";
import { TILE_SIZE, WorkspaceTile } from "../desktop/workspace-tile";
import { encodeImage } from "../feedback-images";
import { dayAndTimeText } from "../planning/plan-time";
import { SpinnerRegion } from "../spinner";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast";
import { ConfirmDialog, useConfirmDialog } from "./confirm-dialog";
import { MenuRow } from "./menu-row";
import { ReadFailed, SettingsGroup } from "./settings-group";

/**
 * workspace-page.tsx -- Settings' Workspace page: the workspace the sidebar lists, its members, its invitations, its GitHub, and the way out of it.
 *
 * The page shows the workspace the plans' sidebar lists and no other, so
 * there is one choice of workspace in the window: a Settings link that names
 * another lists it in the sidebar first. It is drawn in the shape of the
 * other Settings pages, one kind of thing to a group. Its first row is the
 * workspace as Profile's first row is the account: its tile, its name, who
 * shares it and the reader's role, and for an owner or an admin Rename and
 * the photo's acts; an account's first workspace is named by its owner's
 * account name, so it offers no Rename. The members follow as the service
 * holds them now, each with their email and their role in one column; an
 * owner or an admin removes a member who is not an owner and not
 * themselves. An owner or an admin then invites people by address and role,
 * sees the invitations still pending with each one's accept link to copy and
 * send, and cancels one. GitHub, the one place a workspace's repositories
 * are set, is drawn as Settings › Integrations draws its rows: an owner or an
 * admin connects one GitHub account's installation of the Luke GitHub App,
 * or manages it from Manage, whose menu holds Choose repositories on GitHub,
 * the App's page there, and Disconnect; a member sees whether GitHub is
 * connected, or is told to ask. Last, anyone but an owner leaves.
 *
 * Its rows are the Settings kit's: a row's one constructive act stands at
 * its end, and the rest are its ⋯'s (`menu-row.tsx`), each act that cannot
 * be undone asking first in the confirm dialog, whose refusal is said where
 * it was asked. The page draws whole: while the members or the invitations
 * are being read it holds itself back (`.settings-reading`), and a read that
 * failed says so in red with Retry.
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

/** What each role may do, as the role menu's second lines say it. */
const ROLE_DETAIL = {
  [INVITATION_ROLE.MEMBER]: "Works on plans and agents",
  [INVITATION_ROLE.ADMIN]: "Also manages members and GitHub",
} as const satisfies Record<WorkspaceInvitation["role"], string>;

/** What the invitations say where none is pending: to the workspace's one member, and to a team. */
const INVITATIONS_EMPTY = {
  ALONE: "Only you so far. Invite someone by email, then send them the link Luke makes.",
  NONE: "No invitations waiting. Luke sends no mail: copy each new invitation's link and send it yourself.",
} as const;

/** What a list's line says where its read did not land, in `read-failure.tsx`'s words. */
const READ_FAILED = {
  MEMBERS: "The members could not be read.",
  INVITATIONS: "The invitations could not be read.",
} as const;

/**
 * What the leave says: the row's line, and the dialog's body and what it
 * names as staying and stopping. Plans and agents are the workspace's; an
 * agent's every step runs as its starter, read through their membership, so
 * one still working when its starter leaves stops at its next step, and a
 * run of an automation starts as its creator, so one whose creator left
 * fails as `creator-left`.
 */
const LEAVE_WORDS = {
  LINE: "You lose its plans, agents, and Inbox until someone invites you again.",
  BODY: "You lose access to its plans, agents, and Inbox until someone invites you again.",
  PLANS: (name: string) => `Plans you wrote stay in ${name}, for its members to keep.`,
  AGENTS:
    "Agents you started stay in its history, named as a former member, and any still working stop.",
  AUTOMATIONS: "Automations you created stop running.",
  OWN: (name: string | undefined) =>
    name === undefined
      ? "Your own workspace isn't affected."
      : `Your own workspace, ${name}, isn't affected.`,
  LEFT: (name: string) => `You left ${name}.`,
} as const;

/** The outline face an invited address wears until it is a member, so its words stand in the members' column. */
const INVITED_ACTOR = { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.UNNAMED } as const;

/** What the connected GitHub account's line says once the App's installation was suspended or removed. */
const GITHUB_SUSPENDED = "Suspended or removed on GitHub.";

/** What the GitHub row's line says while the App's installation stands, naming the account it is on, as Integrations' rows name theirs. */
const GITHUB_CONNECTED = (login: string) => `Connected to ${login}`;

/** What the GitHub row says where no GitHub is connected, by who is reading it. */
const GITHUB_UNCONNECTED = {
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

/** A list as the page reads it: still reading, read, or refused with a line. */
type ListRead<Item> = { readonly items: readonly Item[] } | { readonly failed: string } | undefined;

/** The line a page draws while it reads, which holds the whole page back until every read is in. */
function Reading({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="settings-card-line settings-reading">
      <SpinnerRegion label={label} />
    </div>
  );
}

/** A row's words: what it names, and a line under it. */
function RowCopy({ name, line }: { name: string; line?: React.ReactNode }): React.JSX.Element {
  return (
    <span className="settings-copy">
      <strong>{name}</strong>
      {line === undefined ? null : <small>{line}</small>}
    </span>
  );
}

/**
 * One member's row: their face, their name with You on the reader's own,
 * their email under it, and their role as the row's value in one column;
 * for an owner or admin, Remove in its ⋯ on anyone's but an owner's and
 * their own, which asks first. A row with no ⋯ in a list where others have
 * one keeps the ⋯'s room, so every role ends in the same place.
 */
function MemberRow({
  workspaceId,
  member,
  readerId,
  removable,
  slotted,
  onRemoved,
}: {
  workspaceId: string;
  member: WorkspaceMember;
  /** The reader's account id, whose own row wears You. */
  readerId: string | undefined;
  removable: boolean;
  /** Whether the list's rows may carry a ⋯, so one without keeps its room. */
  slotted: boolean;
  onRemoved: (members: readonly WorkspaceMember[]) => void;
}): React.JSX.Element {
  const { act } = useAct();
  const remove = useConfirmDialog({ subject: removable, surfaceOpen: true }, () =>
    act(ACT_KIND.WORKSPACE_MEMBER_REMOVE, { workspaceId, userId: member.userId }).then(
      (members) => {
        onRemoved(members);
        return ACCEPTED;
      },
      refusedWith,
    ),
  );
  const actions = removable
    ? [
        {
          label: "Remove from workspace",
          icon: <UserMinusIcon />,
          danger: true,
          onSelect: remove.ask,
        },
      ]
    : [];
  return (
    <>
      <MenuRow label={`${member.name} actions`} actions={actions}>
        <ActorMark actor={memberActor(member, readerId)} size={ACTOR_SIZE.CARD} />
        <span className="settings-copy">
          {/* The person card's own wrapper, so You stands off the name as it does on the card. */}
          <strong className="actor-card-name">
            {member.name}
            {member.userId === readerId ? <YouBadge /> : null}
          </strong>
          <small>{member.email}</small>
        </span>
        <span className="settings-row-value">{ROLE_WORDS[member.role]}</span>
        {slotted && !removable ? <span className="settings-act-slot" aria-hidden="true" /> : null}
      </MenuRow>
      <ConfirmDialog
        confirm={remove}
        question={{
          title: `Remove ${member.name} from this workspace?`,
          body: "They lose its plans, agents, and Inbox until they are invited again.",
          verb: "Remove",
          running: "Removing",
        }}
      />
    </>
  );
}

/**
 * The leave, for anyone but an owner, the page's last group: drawn as
 * Profile's Delete account is, its name, a line saying what goes, and the
 * red button, which asks first, naming what stays and what stops. A leave
 * the service carried says so in the window's toast as the window turns to
 * the personal workspace's Home; a refusal, offline among them, is said in
 * the dialog, which stays open to try again.
 */
function LeaveGroup({
  workspace,
  ownName,
  onLeft,
}: {
  workspace: Workspace;
  /** The name of the account's own workspace, which a leave leaves alone; absent from a service that names none. */
  ownName: string | undefined;
  onLeft: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const show = useToast();
  const workspaceId = workspace.id;
  const leave = useConfirmDialog({ subject: true, surfaceOpen: true }, () =>
    act(ACT_KIND.WORKSPACE_LEAVE, { workspaceId }).then(() => {
      show({
        words: LEAVE_WORDS.LEFT(workspace.name),
        tone: TOAST_TONE.DONE,
        hold: TOAST_HOLD.DONE,
      });
      onLeft();
      return ACCEPTED;
    }, refusedWith),
  );
  return (
    <SettingsGroup anchor={SETTINGS_SECTION.LEAVE}>
      <div className="settings-row">
        <RowCopy name={`Leave ${workspace.name}`} line={LEAVE_WORDS.LINE} />
        <button
          type="button"
          className="toolbar-button bordered-button"
          data-danger="true"
          disabled={leave.busy}
          onClick={leave.ask}
        >
          Leave
        </button>
      </div>
      <ConfirmDialog
        confirm={leave}
        question={{
          title: `Leave ${workspace.name}?`,
          body: LEAVE_WORDS.BODY,
          verb: `Leave ${workspace.name}`,
          running: "Leaving",
        }}
      >
        <ul className="leave-consequences">
          <li>{LEAVE_WORDS.PLANS(workspace.name)}</li>
          <li>{LEAVE_WORDS.AGENTS}</li>
          <li>{LEAVE_WORDS.AUTOMATIONS}</li>
          <li>{LEAVE_WORDS.OWN(ownName)}</li>
        </ul>
      </ConfirmDialog>
    </SettingsGroup>
  );
}

/** The chosen workspace's members, read afresh whenever the workspace changes. */
function TeamMembers({
  workspace,
  readerId,
}: {
  workspace: Workspace;
  readerId: string | undefined;
}): React.JSX.Element {
  const { act } = useAct();
  const [read, setRead] = useState<ListRead<WorkspaceMember>>(undefined);
  const [attempt, setAttempt] = useState(0);
  const workspaceId = workspace.id;

  // A Retry reads again by bumping the attempt.
  useEffect(() => {
    let live = true;
    setRead(undefined);
    act(ACT_KIND.WORKSPACE_MEMBERS_READ, { workspaceId }).then(
      (items) => {
        if (live) setRead({ items });
      },
      () => {
        if (live) setRead({ failed: READ_FAILED.MEMBERS });
      },
    );
    return () => {
      live = false;
    };
  }, [act, workspaceId, attempt]);

  const manages = managesWorkspace(workspace);
  return (
    <>
      {read === undefined ? (
        <Reading label="Loading the members" />
      ) : "failed" in read ? (
        <ReadFailed line={read.failed} onRetry={() => setAttempt((count) => count + 1)} />
      ) : (
        read.items.map((member) => (
          <MemberRow
            key={member.userId}
            workspaceId={workspaceId}
            member={member}
            readerId={readerId}
            // Note that the reader's own row offers no Remove, because the way out of a workspace is Leave.
            removable={
              manages && member.role !== WORKSPACE_ROLE.OWNER && member.userId !== readerId
            }
            slotted={manages}
            onRemoved={(items) => setRead({ items })}
          />
        ))
      )}
    </>
  );
}

/**
 * The role an invitation is sent as: the field chip a Settings picker wears,
 * "Member ⌄", whose menu checks the role chosen and says under each what it
 * may do, as the composer's model chip stands beside its field and its send.
 */
function RoleChip({
  value,
  disabled,
  onChange,
}: {
  value: WorkspaceInvitation["role"];
  disabled: boolean;
  onChange: (role: WorkspaceInvitation["role"]) => void;
}): React.JSX.Element {
  // The page is drawn whenever the chip is, so the menu closes with the chip unmounting.
  const menu = useActionMenu(true);
  const door = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <Chip
        look={CHIP_LOOK.FIELD}
        chevron
        ref={door}
        className="workspace-invite-role"
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
            INVITATION_ROLES.map((role) => ({
              label: ROLE_WORDS[role],
              detail: ROLE_DETAIL[role],
              checked: role === value,
              onSelect: () => onChange(role),
            })),
          ]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/**
 * The workspace's invitations, for an owner or an admin: the form that
 * invites an address as a member or an admin, then those still pending,
 * each under the outline face a person not yet in wears, saying as what and
 * until when, with its link to copy and Cancel invitation in its ⋯, which asks
 * nothing first since inviting the address again undoes it. A refusal is
 * said under the form.
 */
function Invitations({
  workspaceId,
  alone,
}: {
  workspaceId: string;
  /** Whether the reader is the workspace's one member, which the empty list's line says. */
  alone: boolean;
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
  const [role, setRole] = useState<WorkspaceInvitation["role"]>(INVITATION_ROLE.MEMBER);
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);
  // Note that the press reads a ref rather than `busy`, because a second
  // press can land before the render that would disable the button.
  const sending = useRef(false);
  // Note that only the list last asked for is shown, because a read, an
  // invite's re-read, and a cancel can answer out of the order they were asked.
  const latest = useRef(0);
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
  const write = <A,>(made: () => Promise<A>, done: (answer: A) => void) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setNote(undefined);
    made()
      .then(done, (refused: Error) => setNote(refused.message))
      .finally(() => {
        sending.current = false;
        setBusy(false);
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

  // The invitation made is listed at once, its link copyable even if the
  // read after it fails, and the read then reconciles with the service.
  const invite = (event: React.FormEvent) => {
    event.preventDefault();
    write(
      () => act(ACT_KIND.WORKSPACE_INVITE, { workspaceId, email, role }),
      (made) => {
        setEmail("");
        setPending((standing) => [...(standing ?? []).filter((one) => one.id !== made.id), made]);
        show(act(ACT_KIND.WORKSPACE_INVITATIONS_READ, { workspaceId }));
      },
    );
  };

  const cancel = (invitationId: string) =>
    write(
      () => act(ACT_KIND.WORKSPACE_INVITATION_CANCEL, { workspaceId, invitationId }),
      // The cancel's own answer is the list after it, so a read out before it is passed over.
      (left) => {
        latest.current += 1;
        setPending(left);
      },
    );

  return (
    <>
      <form className="settings-row workspace-invite" onSubmit={invite}>
        <input
          type="email"
          required
          className="settings-input"
          aria-label="Email address"
          placeholder="name@example.com"
          autoComplete="off"
          spellCheck={false}
          value={email}
          disabled={busy}
          onChange={(event) => setEmail(event.target.value)}
        />
        <RoleChip value={role} disabled={busy} onChange={setRole} />
        <button type="submit" className="toolbar-button bordered-button" disabled={busy}>
          Invite
        </button>
      </form>
      {note === undefined ? null : (
        <p className="error-message" role="alert">
          {note}
        </p>
      )}
      {firstReadFailed !== undefined ? (
        <ReadFailed line={firstReadFailed} onRetry={read} />
      ) : pending === undefined ? (
        <Reading label="Loading the invitations" />
      ) : pending.length === 0 ? (
        <p className="settings-card-line settings-note">
          {alone ? INVITATIONS_EMPTY.ALONE : INVITATIONS_EMPTY.NONE}
        </p>
      ) : null}
      {(pending ?? []).map((one) => (
        <MenuRow
          key={one.id}
          label={`${one.email} actions`}
          actions={[
            {
              label: "Cancel invitation",
              icon: <XIcon />,
              disabled: busy,
              onSelect: () => cancel(one.id),
            },
          ]}
        >
          <ActorMark actor={INVITED_ACTOR} size={ACTOR_SIZE.CARD} />
          <RowCopy
            name={one.email}
            line={`Invited as ${ROLE_WORDS[one.role]} · Expires ${dayAndTimeText(Date.parse(one.expiresAt))}`}
          />
          {/* Luke sends no mail: the accept link is copied and sent by hand. */}
          <button
            type="button"
            className="toolbar-button bordered-button"
            onClick={() => copy(one.acceptUrl, "Link copied")}
          >
            Copy link
          </button>
        </MenuRow>
      ))}
    </>
  );
}

/**
 * The connected GitHub row's words: GitHub, and under it the account it is
 * connected to, or that GitHub suspended or removed the installation.
 */
function ConnectedCopy({
  github,
}: {
  github: NonNullable<Workspace["github"]>;
}): React.JSX.Element {
  return (
    <RowCopy
      name="GitHub"
      line={
        github.active ? (
          <span className="settings-state" data-state="connected">
            {GITHUB_CONNECTED(github.login)}
          </span>
        ) : (
          <span className="settings-state" data-state="attention">
            {GITHUB_SUSPENDED}
          </span>
        )
      }
    />
  );
}

/**
 * The workspace's GitHub, for an owner or an admin: Connect while none is,
 * which installs the Luke GitHub App on a GitHub account for this
 * workspace, or Manage once one is, whose menu holds Choose repositories on
 * GitHub, the App's page there, and, past a rule, Disconnect, which asks
 * first. Both GitHub pages open in the browser through the one connect,
 * whose return to Luke links the installation to this workspace; a page
 * that could not be opened says why under the row.
 */
function ManagedGitHub({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const { act } = useAct();
  const { github } = workspace;
  const workspaceId = workspace.id;
  const [refusal, setRefusal] = useState<string>();
  const disconnect = useConfirmDialog({ subject: github !== null, surfaceOpen: true }, () =>
    act(ACT_KIND.WORKSPACE_GITHUB_DISCONNECT, { workspaceId }).then(() => ACCEPTED, refusedWith),
  );
  const open = () => {
    setRefusal(undefined);
    act(ACT_KIND.WORKSPACE_GITHUB_CONNECT, { workspaceId }).catch((refused: Error) =>
      setRefusal(refused.message),
    );
  };
  const actions =
    github === null
      ? []
      : [
          [{ label: "Choose repositories on GitHub", icon: <ExternalLinkIcon />, onSelect: open }],
          [{ label: "Disconnect", icon: <TrashIcon />, danger: true, onSelect: disconnect.ask }],
        ];
  return (
    <>
      <MenuRow label="GitHub actions" actions={actions} triggerLabel="Manage">
        <span className="settings-row-mark">
          <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />
        </span>
        {github === null ? (
          <>
            <RowCopy name="GitHub" line={GITHUB_UNCONNECTED.MANAGES} />
            <button type="button" className="toolbar-button bordered-button" onClick={open}>
              Connect
            </button>
          </>
        ) : (
          <ConnectedCopy github={github} />
        )}
      </MenuRow>
      {refusal === undefined ? null : (
        <p className="error-message" role="alert">
          {refusal}
        </p>
      )}
      {github === null ? null : (
        <ConfirmDialog
          confirm={disconnect}
          question={{
            title: `Disconnect ${github.login} from ${workspace.name}?`,
            body: "Its plans lose these repositories until GitHub is connected again.",
            verb: "Disconnect",
            running: "Disconnecting",
          }}
        />
      )}
    </>
  );
}

/**
 * The workspace's GitHub: an owner's or an admin's to set, and for a
 * member, read only, whether it is connected or the ask to have it.
 */
function WorkspaceGitHub({ workspace }: { workspace: Workspace }): React.JSX.Element {
  if (managesWorkspace(workspace)) {
    return <ManagedGitHub workspace={workspace} />;
  }
  return (
    <div className="settings-row">
      <span className="settings-row-mark">
        <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />
      </span>
      {workspace.github === null ? (
        <RowCopy name="GitHub" line={GITHUB_UNCONNECTED.MEMBER} />
      ) : (
        <ConnectedCopy github={workspace.github} />
      )}
    </div>
  );
}

/** What Settings' Workspace page is handed: the workspaces, the one the sidebar lists, and the fall back after a leave. */
export interface WorkspaceSettingsControl {
  /** Every workspace the account is a member of, its first one first. */
  workspaces: readonly Workspace[];
  /** The workspace the sidebar lists, which the page shows; absent before the workspaces are read. */
  workspaceId: string | undefined;
  /** Lands the window on the account's own workspace's Home once a workspace is left. */
  onLeft: (workspaceId: string) => void;
  /** Whether the read the workspaces arrive with failed, so none will arrive until it is asked again. */
  listFailed: boolean;
  /** Asks for the workspaces again. */
  onRetryList: () => void;
}

/** The workspace the page shows: the one the sidebar lists, else the first; none before the workspaces are read. */
export function shownWorkspace(
  control: Pick<WorkspaceSettingsControl, "workspaces" | "workspaceId">,
): Workspace | undefined {
  return (
    control.workspaces.find((each) => each.id === control.workspaceId) ?? control.workspaces[0]
  );
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
 * the name in place on its own line, as the sidebar renames a plan, and
 * Return or a press elsewhere sends what was typed with its ends trimmed,
 * while Escape, an empty name, or the same one renames nothing; an account's
 * first workspace is named by its owner's account name, so it offers no
 * Rename. Upload photo picks a PNG, JPEG, or WebP image and sends it drawn
 * square; Remove photo, where one is set, asks first. The new name or photo
 * arrives with the workspaces the host reads again after it; a refusal, or a
 * file that cannot be a photo, is said under the row until the next try.
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
  const picker = useRef<HTMLInputElement | null>(null);
  const refocus = useRef(false);
  const set = workspace.photoVersion !== undefined;
  const remove = useConfirmDialog({ subject: manages && set, surfaceOpen: true }, () =>
    act(ACT_KIND.WORKSPACE_PHOTO_SET, { workspaceId, photo: null }).then(
      () => ACCEPTED,
      refusedWith,
    ),
  );
  // Note that focus goes back to Rename once the rename has settled, because
  // the button is disabled while it is out and a disabled one takes no focus.
  useEffect(() => {
    if (editing || renaming || !refocus.current) return;
    refocus.current = false;
    button.current?.focus();
  }, [editing, renaming]);
  const end = ({ name, byKey }: NameEdit) => {
    refocus.current = byKey;
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
  const actions = manages
    ? [
        [
          {
            label: set ? PHOTO_WORDS.REPLACE : PHOTO_WORDS.UPLOAD,
            icon: <ImageUpIcon />,
            disabled: uploading || remove.busy,
            onSelect: () => {
              setRefusal(undefined);
              picker.current?.click();
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
  return (
    <>
      <MenuRow label="Workspace actions" actions={actions}>
        <WorkspaceTile workspace={workspace} size={TILE_SIZE.HEAD} />
        <span className="settings-copy">
          {editing ? (
            <PlanNameField
              name={workspace.name}
              className="settings-input workspace-name-input"
              label="Workspace name"
              maxLength={WORKSPACE_BOUNDS.MAX_NAME_CHARS}
              onEnd={end}
            />
          ) : (
            <strong>{workspace.name}</strong>
          )}
          <small>{identityLine(workspace)}</small>
        </span>
        {renamable && !editing ? (
          <button
            ref={button}
            type="button"
            className="toolbar-button bordered-button"
            disabled={renaming}
            onClick={() => {
              setRefusal(undefined);
              setEditing(true);
            }}
          >
            Rename
          </button>
        ) : null}
        {manages ? (
          <input
            ref={picker}
            type="file"
            accept={PHOTO_ACCEPT}
            hidden
            onChange={(event) => {
              const [picked] = Array.from(event.currentTarget.files ?? []);
              // Cleared so the same file can be picked again after it was refused.
              event.currentTarget.value = "";
              if (picked !== undefined) upload(picked);
            }}
          />
        ) : null}
      </MenuRow>
      {refusal === undefined ? null : (
        <p className="error-message" role="alert">
          {refusal}
        </p>
      )}
      <ConfirmDialog
        confirm={remove}
        question={{
          title: `Remove ${workspace.name}'s photo?`,
          body: "Its members see its letter in its place until a photo is uploaded again.",
          verb: "Remove",
          running: "Removing",
        }}
      />
    </>
  );
}

/**
 * The page for the listed workspace, one kind of thing to a group: its
 * identity, its members, its invitations for an owner or an admin, its
 * GitHub, and last the leave for anyone but an owner, the members and
 * GitHub under the anchors their links have always named; held back, as a
 * page still reading is, before the workspaces are read, and Retry where
 * that read failed.
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
    return (
      <SettingsGroup>
        {control.listFailed ? (
          <ReadFailed line="Your workspaces could not be read." onRetry={control.onRetryList} />
        ) : (
          <Reading label="Loading your workspaces" />
        )}
      </SettingsGroup>
    );
  }
  const ownName = control.workspaces.find((each) => each.personal === true)?.name;
  return (
    <Fragment key={workspace.id}>
      <SettingsGroup>
        <WorkspaceIdentity workspace={workspace} />
      </SettingsGroup>
      <SettingsGroup title="Members" anchor={SETTINGS_SECTION.MEMBERS}>
        <TeamMembers workspace={workspace} readerId={readerId} />
      </SettingsGroup>
      {managesWorkspace(workspace) ? (
        <SettingsGroup title="Invitations" anchor={SETTINGS_SECTION.INVITATIONS}>
          <Invitations workspaceId={workspace.id} alone={(workspace.memberCount ?? 2) <= 1} />
        </SettingsGroup>
      ) : null}
      <SettingsGroup title="GitHub" anchor={SETTINGS_SECTION.GITHUB_REPOSITORIES}>
        <WorkspaceGitHub workspace={workspace} />
      </SettingsGroup>
      {workspace.role === WORKSPACE_ROLE.OWNER ? null : (
        <LeaveGroup
          workspace={workspace}
          ownName={ownName}
          onLeft={() => control.onLeft(workspace.id)}
        />
      )}
    </Fragment>
  );
}
