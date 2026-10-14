import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@sidecar/hosted/workspace-wire";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { Fragment, useEffect, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import { SETTINGS_SECTION } from "../settings-views";
import { ConfirmDialog, useConfirmDialog } from "./confirm-dialog";
import { SelectRow } from "./select-row";
import { SettingsGroup } from "./settings-group";

/**
 * workspace-page.tsx -- Settings' Workspace page: one workspace the account is in, its members, and its GitHub repositories.
 *
 * A picker at the page's head chooses the workspace, the one the sidebar
 * lists until another is chosen or a link names one. Under it the
 * workspace's name and the account's role. A team's workspace then lists its
 * members as the service holds them now, each with its name, email, and
 * role: Invite people opens the service's invite page in the browser, an
 * owner or an admin removes a member who is not an owner, and anyone but an
 * owner leaves. For an owner or an admin, GitHub repositories connects one
 * GitHub organization's installation of the Luke GitHub App to the
 * workspace, or names the connected account with Disconnect and the way to
 * choose its repositories on GitHub. Every act that cannot be undone asks
 * first in the confirm dialog, and a refusal is said where it was asked:
 * the account's role's own line where that is why, the act's own sentence
 * otherwise. The personal workspace has no team, so it draws no members.
 */

/** What each role reads as on a member's row. */
const ROLE_WORDS = {
  [WORKSPACE_ROLE.OWNER]: "Owner",
  [WORKSPACE_ROLE.ADMIN]: "Admin",
  [WORKSPACE_ROLE.MEMBER]: "Member",
} as const;

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

/**
 * What a refused act answers in the dialog that asked: its refusal's own
 * words, which main makes `WORKSPACE_NOT_PERMITTED_REFUSAL` where the
 * account's role is why, and the act's own sentence otherwise.
 */
function refusedWith(refused: Error): ActionResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason: refused.message };
}

/** Whether the account's role lets it manage the workspace's members and GitHub organization. */
function managesWorkspace(workspace: Workspace): boolean {
  return workspace.role === WORKSPACE_ROLE.OWNER || workspace.role === WORKSPACE_ROLE.ADMIN;
}

/** The members as the section reads them: still reading, read, or refused with a line. */
type MembersRead =
  | { readonly members: readonly WorkspaceMember[] }
  | { readonly failed: string }
  | undefined;

/** A row's act that cannot be taken back: its red button, and the dialog that asks first and says a refusal. */
function ConfirmedButton({
  verb,
  running,
  title,
  body,
  action,
}: {
  verb: string;
  running: string;
  title: string;
  body: string;
  action: () => Promise<ActionResult>;
}): React.JSX.Element {
  const confirm = useConfirmDialog({ subject: true, surfaceOpen: true }, action);
  return (
    <>
      <button
        type="button"
        className="toolbar-button bordered-button"
        data-danger="true"
        disabled={confirm.busy}
        onClick={confirm.ask}
      >
        {verb}
      </button>
      <ConfirmDialog confirm={confirm} question={{ title, body, verb, running }} />
    </>
  );
}

/** One row: what it names, a line under it, and what it offers. */
function Row({
  name,
  line,
  className,
  children,
}: {
  name: string;
  line?: string | undefined;
  className?: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={className === undefined ? "settings-row" : `settings-row ${className}`}>
      <span className="settings-copy">
        <strong>{name}</strong>
        {line === undefined ? null : <small>{line}</small>}
      </span>
      {children}
    </div>
  );
}

/** The chosen team workspace's members and the leave, read afresh whenever the workspace changes. */
function TeamMembers({
  workspace,
  onLeft,
}: {
  workspace: Workspace;
  onLeft: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const [read, setRead] = useState<MembersRead>(undefined);
  const workspaceId = workspace.id;

  useEffect(() => {
    let live = true;
    setRead(undefined);
    act(ACT_KIND.WORKSPACE_MEMBERS_READ, { workspaceId }).then(
      (members) => {
        if (live) setRead({ members });
      },
      (refused: Error) => {
        if (live) setRead({ failed: refused.message });
      },
    );
    return () => {
      live = false;
    };
  }, [act, workspaceId]);

  const owner = workspace.role === WORKSPACE_ROLE.OWNER;
  const manages = managesWorkspace(workspace);
  return (
    <>
      {read === undefined ? null : "failed" in read ? (
        <p className="settings-note" role="alert">
          {read.failed}
        </p>
      ) : (
        read.members.map((member) => (
          <Row
            key={member.userId}
            className="workspace-member"
            name={member.name}
            line={`${member.email} · ${ROLE_WORDS[member.role]}`}
          >
            {manages && member.role !== WORKSPACE_ROLE.OWNER ? (
              <ConfirmedButton
                verb="Remove"
                running="Removing"
                title={`Remove ${member.name} from this workspace?`}
                body="They lose its plans until they are invited again."
                action={() =>
                  act(ACT_KIND.WORKSPACE_MEMBER_REMOVE, {
                    workspaceId,
                    userId: member.userId,
                  }).then((members) => {
                    setRead({ members });
                    return ACCEPTED;
                  }, refusedWith)
                }
              />
            ) : null}
          </Row>
        ))
      )}
      {owner ? null : (
        <Row name={`Leave ${workspace.name}`}>
          <ConfirmedButton
            verb="Leave"
            running="Leaving"
            title={`Leave ${workspace.name}?`}
            body="Its plans leave your sidebar until you are invited again."
            action={() =>
              act(ACT_KIND.WORKSPACE_LEAVE, { workspaceId }).then(() => {
                onLeft();
                return ACCEPTED;
              }, refusedWith)
            }
          />
        </Row>
      )}
    </>
  );
}

/** A row whose button opens a page in the browser for the workspace, the act's refusal said under it. */
function OpenerRow({
  name,
  line,
  verb,
  className,
  open,
  children,
}: {
  name: string;
  line?: string | undefined;
  verb: string;
  className: string;
  open: () => Promise<void>;
  children?: React.ReactNode;
}): React.JSX.Element {
  const [refusal, setRefusal] = useState<string>();
  return (
    <Row className={className} name={name} line={refusal ?? line}>
      {children}
      <button
        type="button"
        className="toolbar-button bordered-button"
        onClick={() => {
          setRefusal(undefined);
          open().catch((refused: Error) => setRefusal(refused.message));
        }}
      >
        {verb}
      </button>
    </Row>
  );
}

/**
 * The workspace's GitHub repositories, for an owner or an admin: Connect
 * while none is, which installs the Luke GitHub App on a GitHub organization
 * for this workspace, or the connected account's repositories with
 * Disconnect and Choose repositories…, the App's page on GitHub where its
 * repositories are chosen. Both GitHub pages open in the browser through
 * the one connect, whose return to Luke links the installation to this
 * workspace.
 */
function GitHubRepositories({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const { act } = useAct();
  const { github } = workspace;
  const workspaceId = workspace.id;
  const open = () => act(ACT_KIND.WORKSPACE_GITHUB_CONNECT, { workspaceId });
  return github === null ? (
    <OpenerRow
      className="workspace-github"
      name="No GitHub organization connected"
      line="Connect one to use its repositories in this workspace."
      verb="Connect…"
      open={open}
    />
  ) : (
    <OpenerRow
      className="workspace-github"
      name={`Repositories from ${github.login}`}
      line={github.active ? undefined : "Suspended or removed on GitHub."}
      verb="Choose repositories…"
      open={open}
    >
      <ConfirmedButton
        verb="Disconnect"
        running="Disconnecting"
        title={`Disconnect ${github.login} from ${workspace.name}?`}
        body="Its plans lose the organization's repositories until one is connected again."
        action={() =>
          act(ACT_KIND.WORKSPACE_GITHUB_DISCONNECT, { workspaceId }).then(
            () => ACCEPTED,
            refusedWith,
          )
        }
      />
    </OpenerRow>
  );
}

/** What Settings' Workspace page is handed: the workspaces, the one the page shows, the picker, and the fall back after a leave. */
export interface WorkspaceSettingsControl {
  /** Every workspace the account is a member of, its personal one first. */
  workspaces: readonly Workspace[];
  /** The workspace the page shows, absent before the workspaces are read. */
  workspaceId: string | undefined;
  /** Shows another workspace on the page, as its picker chose it. */
  onChooseWorkspace: (workspaceId: string) => void;
  /** Lists the personal workspace again where the workspace left was the one listed. */
  onLeft: (workspaceId: string) => void;
}

/** What each workspace is called in the page's picker. */
function pickerLabel(workspace: Workspace): string {
  return workspace.personal ? `${workspace.name} (personal)` : workspace.name;
}

/** The page's head: the picker, then the workspace's name and the account's role in it. */
function WorkspaceHead({
  control,
  workspace,
}: {
  control: WorkspaceSettingsControl;
  workspace: Workspace;
}): React.JSX.Element {
  return (
    <SettingsGroup>
      <SelectRow
        label="Workspace"
        value={workspace.id}
        options={control.workspaces.map((each) => ({ value: each.id, label: pickerLabel(each) }))}
        parse={(raw) => control.workspaces.find((each) => each.id === raw)?.id}
        onChange={control.onChooseWorkspace}
      />
      <Row
        className="workspace-identity"
        name={workspace.name}
        line={
          workspace.personal
            ? "Your personal workspace. Its plans are yours alone."
            : `Your role: ${ROLE_WORDS[workspace.role]}`
        }
      />
    </SettingsGroup>
  );
}

/**
 * The page for one workspace: its head, a team's members, and, for an owner
 * or an admin, its GitHub repositories; nothing before the workspaces are read.
 */
export function WorkspacePage({
  control,
}: {
  control: WorkspaceSettingsControl;
}): React.JSX.Element | null {
  const { act } = useAct();
  const workspace =
    control.workspaces.find((each) => each.id === control.workspaceId) ?? control.workspaces[0];
  if (workspace === undefined) return null;
  return (
    <>
      <WorkspaceHead control={control} workspace={workspace} />
      {workspace.personal ? null : (
        <SettingsGroup title="Members" anchor={SETTINGS_SECTION.MEMBERS}>
          <Fragment key={workspace.id}>
            <OpenerRow
              className="workspace-invite"
              name="Invite people"
              verb="Invite people…"
              open={() => act(ACT_KIND.WORKSPACE_INVITE, { workspaceId: workspace.id })}
            />
            <TeamMembers workspace={workspace} onLeft={() => control.onLeft(workspace.id)} />
          </Fragment>
        </SettingsGroup>
      )}
      {managesWorkspace(workspace) ? (
        <SettingsGroup title="GitHub repositories" anchor={SETTINGS_SECTION.GITHUB_REPOSITORIES}>
          <GitHubRepositories key={workspace.id} workspace={workspace} />
        </SettingsGroup>
      ) : null}
    </>
  );
}
