import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@sidecar/hosted/workspace-wire";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { useEffect, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import { ConfirmDialog, useConfirmDialog } from "./confirm-dialog";
import { SettingsGroup } from "./settings-group";

/**
 * members-section.tsx -- Settings' Members section: the listed team workspace's members, the removal, the leave, and its GitHub organization.
 *
 * While the sidebar lists a team's workspace the section reads its members
 * as the service holds them now, each with its name, email, and role. An
 * owner or an admin removes a member who is not an owner, and anyone but an
 * owner leaves, which lists the personal workspace again. Both ask first in
 * the confirm dialog, since neither is undone from here, and a refusal is
 * said in it: the account's role's own line where that is why, the act's
 * own sentence otherwise. The personal workspace has no team, so it draws
 * no section.
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
export function managesWorkspace(workspace: Workspace): boolean {
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

/** The team's GitHub organization, for an owner or admin: the connected login with Disconnect, or Connect GitHub org… while none is. */
function GitHubRow({
  workspace,
  onConnect,
}: {
  workspace: Workspace;
  onConnect: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const { github } = workspace;
  if (github === null) {
    return (
      <Row className="workspace-github" name="GitHub">
        <button type="button" className="toolbar-button bordered-button" onClick={onConnect}>
          Connect GitHub org…
        </button>
      </Row>
    );
  }
  return (
    <Row
      className="workspace-github"
      name={`GitHub: ${github.login}`}
      line={github.active ? undefined : "Suspended or removed on GitHub."}
    >
      <ConfirmedButton
        verb="Disconnect"
        running="Disconnecting"
        title={`Disconnect ${github.login} from ${workspace.name}?`}
        body="Its plans lose the organization's repositories until one is connected again."
        action={() =>
          act(ACT_KIND.WORKSPACE_GITHUB_DISCONNECT, { workspaceId: workspace.id }).then(
            () => ACCEPTED,
            refusedWith,
          )
        }
      />
    </Row>
  );
}

/** What Settings' Members section is handed: the workspace the sidebar lists, the fall back after a leave, and the GitHub connect. */
export interface WorkspaceSettingsControl {
  /** The workspace the sidebar lists, absent before the workspaces are read. */
  workspace: Workspace | undefined;
  /** Lists the personal workspace again, once the chosen one is left. */
  onLeft: () => void;
  /** Opens GitHub to connect an organization to the listed workspace. */
  onConnectGitHub: () => void;
}

/** The listed team workspace's members and, for an owner or admin, its GitHub organization; nothing for the personal workspace, which has no team. */
export function MembersSection({
  control,
}: {
  control: WorkspaceSettingsControl;
}): React.JSX.Element | null {
  const { workspace } = control;
  if (workspace === undefined || workspace.personal) return null;
  return (
    <SettingsGroup title={`Members of ${workspace.name}`}>
      <TeamMembers key={workspace.id} workspace={workspace} onLeft={control.onLeft} />
      {managesWorkspace(workspace) ? (
        <GitHubRow key={workspace.id} workspace={workspace} onConnect={control.onConnectGitHub} />
      ) : null}
    </SettingsGroup>
  );
}
