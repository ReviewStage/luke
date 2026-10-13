import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@sidecar/hosted/workspace-wire";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { useCallback, useEffect, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import { ConfirmDialog, useConfirmDialog } from "./confirm-dialog";
import { SettingsGroup } from "./settings-group";

/**
 * members-section.tsx -- Settings' Workspace section: the chosen workspace's members, the removal and the leave, and the way to install Luke on GitHub.
 *
 * A workspace beside the personal one is a GitHub App installation's, so a
 * team is made by installing the App, which the section offers to every
 * signed-in account. While the sidebar lists a team's workspace the section
 * also reads its members as the service holds them now, each with its name,
 * email, and role. An owner or an admin removes a member who is not an
 * owner, and anyone but an owner leaves, which lists the personal workspace
 * again. Both ask first in the confirm dialog, since neither is undone from
 * here, and a refusal is said in it: the account's role's own line where
 * that is why, the act's own sentence otherwise.
 */

/** What the section says, beside the members it lists. */
const SECTION_LINE = {
  INSTALL:
    "An org owner or a repository admin installs Luke on GitHub; then everyone who can reach those repositories can join.",
} as const;

/** What each role reads as on a member's row. */
const ROLE_WORDS = {
  [WORKSPACE_ROLE.OWNER]: "Owner",
  [WORKSPACE_ROLE.ADMIN]: "Admin",
  [WORKSPACE_ROLE.MEMBER]: "Member",
} as const;

/**
 * What a refused act answers in the dialog that asked: its refusal's own
 * words, which main makes `WORKSPACE_NOT_PERMITTED_REFUSAL` where the
 * account's role is why, and the act's own sentence otherwise.
 */
function refusedWith(refused: Error): ActionResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason: refused.message };
}

/** The members as the section reads them: still reading, read, or refused with a line. */
type MembersRead =
  | { readonly members: readonly WorkspaceMember[] }
  | { readonly failed: string }
  | undefined;

/** One member's row: who, their role, and the Remove an owner or an admin is offered for anyone but an owner. */
function MemberRow({
  member,
  removable,
  onRemove,
}: {
  member: WorkspaceMember;
  removable: boolean;
  onRemove: (userId: string) => Promise<ActionResult>;
}): React.JSX.Element {
  const removal = useConfirmDialog({ subject: removable, surfaceOpen: true }, () =>
    onRemove(member.userId),
  );
  return (
    <div className="settings-row workspace-member">
      <span className="settings-copy">
        <strong>{member.name}</strong>
        <small>{`${member.email} · ${ROLE_WORDS[member.role]}`}</small>
      </span>
      {removable ? (
        <button
          type="button"
          className="toolbar-button bordered-button"
          data-danger="true"
          disabled={removal.busy}
          onClick={removal.ask}
        >
          Remove
        </button>
      ) : null}
      <ConfirmDialog
        confirm={removal}
        question={{
          title: `Remove ${member.name} from this workspace?`,
          body: "They lose its plans until they join again from a repository they can reach.",
          verb: "Remove",
          running: "Removing",
        }}
      />
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

  const remove = useCallback(
    (userId: string): Promise<ActionResult> =>
      act(ACT_KIND.WORKSPACE_MEMBER_REMOVE, { workspaceId, userId }).then(
        (members): ActionResult => {
          setRead({ members });
          return { status: ACTION_RESULT_STATUS.ACCEPTED };
        },
        refusedWith,
      ),
    [act, workspaceId],
  );

  const owner = workspace.role === WORKSPACE_ROLE.OWNER;
  const manages = owner || workspace.role === WORKSPACE_ROLE.ADMIN;
  const leave = useConfirmDialog({ subject: !owner, surfaceOpen: true }, () =>
    act(ACT_KIND.WORKSPACE_LEAVE, { workspaceId }).then((): ActionResult => {
      onLeft();
      return { status: ACTION_RESULT_STATUS.ACCEPTED };
    }, refusedWith),
  );

  return (
    <>
      {read === undefined ? null : "failed" in read ? (
        <p className="settings-note" role="alert">
          {read.failed}
        </p>
      ) : (
        read.members.map((member) => (
          <MemberRow
            key={member.userId}
            member={member}
            removable={manages && member.role !== WORKSPACE_ROLE.OWNER}
            onRemove={remove}
          />
        ))
      )}
      {owner ? null : (
        <div className="settings-row">
          <span className="settings-copy">
            <strong>{`Leave ${workspace.name}`}</strong>
            <small>Its plans leave your sidebar until you join again.</small>
          </span>
          <button
            type="button"
            className="toolbar-button bordered-button"
            data-danger="true"
            disabled={leave.busy}
            onClick={leave.ask}
          >
            Leave
          </button>
          <ConfirmDialog
            confirm={leave}
            question={{
              title: `Leave ${workspace.name}?`,
              body: "Its plans leave your sidebar until you join again.",
              verb: "Leave",
              running: "Leaving",
            }}
          />
        </div>
      )}
    </>
  );
}

/** What Settings' Workspace section is handed: the workspace the sidebar lists, the fall back after a leave, and the install. */
export interface WorkspaceSettingsControl {
  /** The workspace the sidebar lists, absent before the workspaces are read. */
  workspace: Workspace | undefined;
  /** Lists the personal workspace again, once the chosen one is left. */
  onLeft: () => void;
  /** Opens the Luke GitHub App's installation page in the browser. */
  onInstall: () => void;
}

export function MembersSection({
  control,
}: {
  control: WorkspaceSettingsControl;
}): React.JSX.Element {
  const { workspace } = control;
  const team = workspace !== undefined && !workspace.personal ? workspace : undefined;
  return (
    <SettingsGroup title={team === undefined ? "Workspace" : `Members of ${team.name}`}>
      {team === undefined ? null : (
        <TeamMembers key={team.id} workspace={team} onLeft={control.onLeft} />
      )}
      <div className="settings-row">
        <span className="settings-copy">
          <small>{SECTION_LINE.INSTALL}</small>
        </span>
        <button
          type="button"
          className="toolbar-button bordered-button"
          onClick={control.onInstall}
        >
          Install Luke on GitHub…
        </button>
      </div>
    </SettingsGroup>
  );
}
