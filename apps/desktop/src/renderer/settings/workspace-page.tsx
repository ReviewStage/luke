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
import { ExternalLinkIcon, UserMinusIcon, XIcon } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { useAct } from "../act";
import { ACTOR_SIZE, ActorMark, YouBadge } from "../actor-ref";
import { useCopyToast } from "../copy-feedback";
import { type NameEdit, PlanNameField } from "../desktop/plan-name-field";
import { TILE_SIZE, WorkspaceTile } from "../desktop/workspace-tile";
import { encodeImage } from "../feedback-images";
import { dayAndTimeText } from "../planning/plan-time";
import { Segmented } from "../segmented";
import { SpinnerRegion } from "../spinner";
import { ConfirmDialog, useConfirmDialog } from "./confirm-dialog";
import { MenuRow } from "./menu-row";
import { ReadFailed, SettingsGroup } from "./settings-group";

/**
 * workspace-page.tsx -- Settings' Workspace page: the workspace the sidebar lists, its members, and its GitHub.
 *
 * The page shows the workspace the plans' sidebar lists and no other, so
 * there is one choice of workspace in the window: a Settings link that names
 * another lists it in the sidebar first. Its head says the account's role in
 * it, and under it an owner or an admin renames the workspace in place and
 * uploads or removes its photo; an account's first workspace is named by its
 * owner's account name, so it shows that name and offers no Rename.
 * The workspace then lists its members as the service holds
 * them now, each with its email and role. An owner or an admin invites
 * people by address and role, sees the invitations still pending with each
 * one's accept link to copy and send, and cancels one; removes a member who
 * is not an owner; and anyone but an owner leaves. GitHub, the one
 * place a workspace's repositories are set, connects one GitHub account's
 * installation of the Luke GitHub App to the workspace for an owner or an
 * admin, or says GitHub is connected with Manage, whose menu holds Choose
 * repositories on GitHub, the App's page there, and Disconnect; a member
 * sees whether GitHub is connected, or is told to ask.
 *
 * Its rows are the Settings kit's: a row's one constructive act stands at
 * its end, and the rest are its ⋯'s (`menu-row.tsx`), each act that cannot
 * be undone asking first in the confirm dialog, whose refusal is said where
 * it was asked. The page draws whole: while the members or the invitations
 * are being read it holds itself back (`.settings-reading`), and a read that
 * failed says so in red with Retry. Every workspace draws the same, the
 * first one made for the account included, but for its Rename.
 */

/** How many pixels a side a workspace's photo is drawn to before it is sent: well past the largest tile's 48, so it stays sharp on a Retina screen. */
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

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

/** The roles an invitation offers, in the order the form's segments draw them, the default first. */
const INVITATION_ROLES = [INVITATION_ROLE.MEMBER, INVITATION_ROLE.ADMIN] as const;

/** What a list's line says where its read did not land, in `read-failure.tsx`'s words. */
const READ_FAILED = {
  MEMBERS: "The members could not be read.",
  INVITATIONS: "The invitations could not be read.",
} as const;

/** The outline face an invited address wears until it is a member, so its words stand in the members' column. */
const INVITED_ACTOR = { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.UNNAMED } as const;

/** What the connected GitHub account's line says once the App's installation was suspended or removed. */
const GITHUB_SUSPENDED = "Suspended or removed on GitHub.";

/** What the GitHub row's line says while the App's installation stands. */
const GITHUB_CONNECTED = "Connected";

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

/** One member's row: their face, name, email and role, You on the reader's own, and for an owner or admin, Remove in its ⋯ on anyone's but an owner's and their own, which asks first. */
function MemberRow({
  workspaceId,
  member,
  readerId,
  removable,
  onRemoved,
}: {
  workspaceId: string;
  member: WorkspaceMember;
  /** The reader's account id, whose own row wears You. */
  readerId: string | undefined;
  removable: boolean;
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
          <small>{`${member.email} · ${ROLE_WORDS[member.role]}`}</small>
        </span>
      </MenuRow>
      <ConfirmDialog
        confirm={remove}
        question={{
          title: `Remove ${member.name} from this workspace?`,
          body: "They lose its plans until they are invited again.",
          verb: "Remove",
          running: "Removing",
        }}
      />
    </>
  );
}

/** The leave, for anyone but an owner: its red button, asking first, as Delete account's is. */
function LeaveRow({ workspace, onLeft }: { workspace: Workspace; onLeft: () => void }) {
  const { act } = useAct();
  const workspaceId = workspace.id;
  const leave = useConfirmDialog({ subject: true, surfaceOpen: true }, () =>
    act(ACT_KIND.WORKSPACE_LEAVE, { workspaceId }).then(() => {
      onLeft();
      return ACCEPTED;
    }, refusedWith),
  );
  return (
    <>
      <div className="settings-row">
        <RowCopy name={`Leave ${workspace.name}`} />
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
          body: "Its plans leave your sidebar until you are invited again.",
          verb: "Leave",
          running: "Leaving",
        }}
      />
    </>
  );
}

/** The chosen workspace's members and the leave, read afresh whenever the workspace changes. */
function TeamMembers({
  workspace,
  readerId,
  onLeft,
}: {
  workspace: Workspace;
  readerId: string | undefined;
  onLeft: () => void;
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
            onRemoved={(items) => setRead({ items })}
          />
        ))
      )}
      {workspace.role === WORKSPACE_ROLE.OWNER ? null : (
        <LeaveRow workspace={workspace} onLeft={onLeft} />
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
function Invitations({ workspaceId }: { workspaceId: string }): React.JSX.Element {
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
        <Segmented
          legend="Role"
          options={INVITATION_ROLES.map((each) => ({ value: each, label: ROLE_WORDS[each] }))}
          value={role}
          disabled={busy}
          onChange={setRole}
        />
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
 * The connected GitHub row's words: GitHub, and under it Connected, or that
 * GitHub suspended or removed the installation. The account is not named on
 * the row; Disconnect's question names it.
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
            {GITHUB_CONNECTED}
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
  /** Lists the first other workspace where the workspace left was the one listed. */
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

/**
 * The workspace's name, for an owner or an admin: Rename at the row's end
 * opens the name in place, as the sidebar renames a plan, and Return or a
 * press elsewhere sends what was typed with its ends trimmed, while Escape,
 * an empty name, or the same one renames nothing. The new name arrives with
 * the workspaces the host reads again after it; a refusal is said under the
 * row until the next Rename.
 */
function WorkspaceName({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const { act } = useAct();
  const workspaceId = workspace.id;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string>();
  const button = useRef<HTMLButtonElement | null>(null);
  const refocus = useRef(false);
  // Note that focus goes back to Rename once the rename has settled, because
  // the button is disabled while it is out and a disabled one takes no focus.
  useEffect(() => {
    if (editing || busy || !refocus.current) return;
    refocus.current = false;
    button.current?.focus();
  }, [editing, busy]);
  const end = ({ name, byKey }: NameEdit) => {
    refocus.current = byKey;
    setEditing(false);
    if (name === undefined) return;
    setBusy(true);
    act(ACT_KIND.WORKSPACE_RENAME, { workspaceId, name })
      .then(
        () => undefined,
        (refused: Error) => setRefusal(refused.message),
      )
      .finally(() => setBusy(false));
  };
  return (
    <>
      <div className="settings-row workspace-name">
        {editing ? (
          <PlanNameField
            name={workspace.name}
            className="settings-input"
            label="Workspace name"
            maxLength={WORKSPACE_BOUNDS.MAX_NAME_CHARS}
            onEnd={end}
          />
        ) : (
          <>
            <RowCopy name="Name" line={workspace.name} />
            <button
              ref={button}
              type="button"
              className="toolbar-button bordered-button"
              disabled={busy}
              onClick={() => {
                setRefusal(undefined);
                setEditing(true);
              }}
            >
              Rename
            </button>
          </>
        )}
      </div>
      {refusal === undefined ? null : (
        <p className="error-message" role="alert">
          {refusal}
        </p>
      )}
    </>
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

/**
 * The workspace's photo, for an owner or an admin: its tile at the size it
 * is looked at, Upload… at the row's end, which picks a PNG, JPEG, or WebP
 * image and sends it drawn square, and, where a photo is set, Remove photo
 * in its ⋯, which asks first. The photo arrives with the workspaces the host
 * reads again after it; a file that cannot be one, or an upload refused, is
 * said under the row until the next Upload…, and a removal refused in the
 * dialog that asked.
 */
function WorkspacePhoto({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const { act } = useAct();
  const workspaceId = workspace.id;
  const picker = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string>();
  const set = workspace.photoVersion !== undefined;
  const remove = useConfirmDialog({ subject: set, surfaceOpen: true }, () =>
    act(ACT_KIND.WORKSPACE_PHOTO_SET, { workspaceId, photo: null }).then(
      () => ACCEPTED,
      refusedWith,
    ),
  );
  const upload = (file: File) => {
    setRefusal(undefined);
    setBusy(true);
    photoOfFile(file)
      .then((read) => {
        if ("refusal" in read) throw new Error(read.refusal);
        return act(ACT_KIND.WORKSPACE_PHOTO_SET, { workspaceId, photo: read.photo });
      })
      .then(
        () => undefined,
        (refused: Error) => setRefusal(refused.message),
      )
      .finally(() => setBusy(false));
  };
  const actions = set
    ? [
        // An upload still under way would put a photo back after its removal, so none is asked meanwhile.
        {
          label: "Remove photo",
          icon: <TrashIcon />,
          danger: true,
          disabled: busy,
          onSelect: remove.ask,
        },
      ]
    : [];
  return (
    <>
      <MenuRow label="Photo actions" actions={actions}>
        <WorkspaceTile workspace={workspace} size={TILE_SIZE.SETTINGS} />
        <RowCopy name="Photo" />
        <button
          type="button"
          className="toolbar-button bordered-button"
          disabled={busy || remove.busy}
          onClick={() => picker.current?.click()}
        >
          Upload…
        </button>
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

/** The page's head: the account's role in the workspace, and for an owner or an admin the workspace's name to rename, or a personal workspace's name alone, and its photo to set. */
function WorkspaceHead({ workspace }: { workspace: Workspace }): React.JSX.Element {
  return (
    <SettingsGroup>
      <div className="settings-row">
        <RowCopy name="Your role" line={ROLE_WORDS[workspace.role]} />
      </div>
      {managesWorkspace(workspace) ? (
        <Fragment key={workspace.id}>
          {workspace.personal === true ? (
            <div className="settings-row workspace-name">
              <RowCopy name="Name" line={workspace.name} />
            </div>
          ) : (
            <WorkspaceName workspace={workspace} />
          )}
          <WorkspacePhoto workspace={workspace} />
        </Fragment>
      ) : null}
    </SettingsGroup>
  );
}

/**
 * The page for the listed workspace: its head, its members, and its GitHub,
 * under the anchor its links have always named; held back, as a
 * page still reading is, before the workspaces are read, and Retry where that
 * read failed.
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
  return (
    <>
      <WorkspaceHead workspace={workspace} />
      <SettingsGroup title="Members" anchor={SETTINGS_SECTION.MEMBERS}>
        <Fragment key={workspace.id}>
          {managesWorkspace(workspace) ? <Invitations workspaceId={workspace.id} /> : null}
          <TeamMembers
            workspace={workspace}
            readerId={readerId}
            onLeft={() => control.onLeft(workspace.id)}
          />
        </Fragment>
      </SettingsGroup>
      <SettingsGroup title="GitHub" anchor={SETTINGS_SECTION.GITHUB_REPOSITORIES}>
        <WorkspaceGitHub key={workspace.id} workspace={workspace} />
      </SettingsGroup>
    </>
  );
}
