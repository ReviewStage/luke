import { WORKSPACE_CALL_FAILURE, type WorkspaceCallFailure } from "@luke/features";
import type {
  TasksGitHubIssuesAnswer,
  TasksGitHubIssuesParams,
  TasksLinearIssuesAnswer,
  TasksLinearIssuesParams,
  TasksWorkspaceAnswer,
  TasksWorkspaceCreateParams,
  TasksWorkspaceGitHubConnectAnswer,
  TasksWorkspaceInvitationAnswer,
  TasksWorkspaceInvitationCancelParams,
  TasksWorkspaceInvitationsAnswer,
  TasksWorkspaceInviteParams,
  TasksWorkspaceLeaveAnswer,
  TasksWorkspaceLeaveParams,
  TasksWorkspaceMemberRemoveParams,
  TasksWorkspaceMemberRoleParams,
  TasksWorkspaceMembersAnswer,
  TasksWorkspaceMembersParams,
  TasksWorkspaceParams,
  TasksWorkspacePhotoAnswer,
  TasksWorkspacePhotoParams,
  TasksWorkspacePhotoSetParams,
  TasksWorkspaceRenameParams,
  TasksWorkspaceTransferParams,
} from "@luke/features/tasks-view";
import { Effect } from "effect";
import type { ActSender } from "../act-router/router.js";
import {
  ALREADY_INVITED_REFUSAL,
  isGitHubAddress,
  LINEAR_UNAVAILABLE_REFUSAL,
  WORKSPACE_NOT_PERMITTED_REFUSAL,
} from "../acts.js";
import { WORKSPACE_ACT_KIND } from "../contract/index.js";
import { actPort } from "./base.js";

/**
 * workspace-procedures.ts -- the panel's asks of the host about the account's workspaces.
 *
 * The one check these procedures make is who asked: only a panel draws a
 * workspace, so every one refuses the takeover and the hidden voice window,
 * in its own sentence. What the service answers comes back as the panel's
 * own answer, or why there is none: a write the account's role does not
 * allow in words that say so, and anything else in the kind's own words.
 * Nothing is held here.
 */
export interface WorkspaceProceduresDependencies {
  host: {
    workspaceCreate(params: TasksWorkspaceCreateParams): Effect.Effect<TasksWorkspaceAnswer>;
    workspaceRename(params: TasksWorkspaceRenameParams): Effect.Effect<TasksWorkspaceAnswer>;
    workspacePhotoSet(params: TasksWorkspacePhotoSetParams): Effect.Effect<TasksWorkspaceAnswer>;
    workspaceGitHubConnect(
      params: TasksWorkspaceParams,
    ): Effect.Effect<TasksWorkspaceGitHubConnectAnswer>;
    workspaceGitHubDisconnect(params: TasksWorkspaceParams): Effect.Effect<TasksWorkspaceAnswer>;
    workspaceLinearConnect(
      params: TasksWorkspaceParams,
    ): Effect.Effect<TasksWorkspaceGitHubConnectAnswer>;
    workspaceLinearDisconnect(params: TasksWorkspaceParams): Effect.Effect<TasksWorkspaceAnswer>;
    workspaceLinearIssues(params: TasksLinearIssuesParams): Effect.Effect<TasksLinearIssuesAnswer>;
    tasksGitHubIssues(params: TasksGitHubIssuesParams): Effect.Effect<TasksGitHubIssuesAnswer>;
    workspaceMembers(
      params: TasksWorkspaceMembersParams,
    ): Effect.Effect<TasksWorkspaceMembersAnswer>;
    workspacePhoto(params: TasksWorkspacePhotoParams): Effect.Effect<TasksWorkspacePhotoAnswer>;
    workspaceMemberRemove(
      params: TasksWorkspaceMemberRemoveParams,
    ): Effect.Effect<TasksWorkspaceMembersAnswer>;
    workspaceMemberRole(
      params: TasksWorkspaceMemberRoleParams,
    ): Effect.Effect<TasksWorkspaceMembersAnswer>;
    workspaceTransfer(
      params: TasksWorkspaceTransferParams,
    ): Effect.Effect<TasksWorkspaceMembersAnswer>;
    workspaceLeave(params: TasksWorkspaceLeaveParams): Effect.Effect<TasksWorkspaceLeaveAnswer>;
    workspaceInvitations(
      params: TasksWorkspaceParams,
    ): Effect.Effect<TasksWorkspaceInvitationsAnswer>;
    workspaceInvite(
      params: TasksWorkspaceInviteParams,
    ): Effect.Effect<TasksWorkspaceInvitationAnswer>;
    workspaceInvitationCancel(
      params: TasksWorkspaceInvitationCancelParams,
    ): Effect.Effect<TasksWorkspaceInvitationsAnswer>;
  };
  /** Opens an address in the browser: a connection's install or sign-in page the service named. */
  openExternal: (url: string) => Promise<void>;
}

/** The refusal a window that draws no workspace hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

/** A refusal's constructor as a procedure's `errors` holds it: its own sentence, or one given. */
type Refused<E> = (options?: { message?: string }) => E;

/**
 * A workspace act the host answered without its answer, refused: a write
 * the account's role does not allow in words that say so, and anything else
 * in its kind's own words.
 */
function refusedWorkspace<E>(refused: Refused<E>, failure: WorkspaceCallFailure) {
  switch (failure) {
    case WORKSPACE_CALL_FAILURE.NOT_PERMITTED:
      return Effect.fail(refused({ message: WORKSPACE_NOT_PERMITTED_REFUSAL }));
    case WORKSPACE_CALL_FAILURE.ALREADY_INVITED:
      return Effect.fail(refused({ message: ALREADY_INVITED_REFUSAL }));
    case WORKSPACE_CALL_FAILURE.LINEAR_UNAVAILABLE:
      return Effect.fail(refused({ message: LINEAR_UNAVAILABLE_REFUSAL }));
    default:
      return Effect.fail(refused());
  }
}

/** Whether an address the host answered parses and is https, the one kind a browser is sent to unnamed. */
function isBrowserAddress(url: string): boolean {
  return URL.canParse(url) && new URL(url).protocol === "https:";
}

export function workspaceProcedures(dependencies: WorkspaceProceduresDependencies) {
  const { host, openExternal } = dependencies;
  return {
    [WORKSPACE_ACT_KIND.WORKSPACE_CREATE]: actPort[WORKSPACE_ACT_KIND.WORKSPACE_CREATE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const answer = yield* host.workspaceCreate(input);
        if ("workspace" in answer) return answer.workspace;
        return yield* refusedWorkspace(errors.REFUSED, answer.failure);
      },
    ),
    [WORKSPACE_ACT_KIND.WORKSPACE_RENAME]: actPort[WORKSPACE_ACT_KIND.WORKSPACE_RENAME].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const answer = yield* host.workspaceRename(input);
        if ("workspace" in answer) return answer.workspace;
        return yield* refusedWorkspace(errors.REFUSED, answer.failure);
      },
    ),
    [WORKSPACE_ACT_KIND.WORKSPACE_PHOTO_SET]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_PHOTO_SET
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.workspacePhotoSet(input);
      if ("workspace" in answer) return answer.workspace;
      return yield* refusedWorkspace(errors.REFUSED, answer.failure);
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_INVITATIONS_READ]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_INVITATIONS_READ
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.workspaceInvitations(input);
      if ("invitations" in answer) return answer.invitations;
      return yield* refusedWorkspace(errors.REFUSED, answer.failure);
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_INVITE]: actPort[WORKSPACE_ACT_KIND.WORKSPACE_INVITE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const answer = yield* host.workspaceInvite(input);
        if ("invitation" in answer) return answer.invitation;
        return yield* refusedWorkspace(errors.REFUSED, answer.failure);
      },
    ),
    [WORKSPACE_ACT_KIND.WORKSPACE_INVITATION_CANCEL]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_INVITATION_CANCEL
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.workspaceInvitationCancel(input);
      if ("invitations" in answer) return answer.invitations;
      return yield* refusedWorkspace(errors.REFUSED, answer.failure);
    }),
    // Note that the address the service answered opens only where it is
    // GitHub's, because it is the one address here the panel did not name.
    [WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_CONNECT]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_CONNECT
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.workspaceGitHubConnect(input);
      if ("failure" in answer) return yield* refusedWorkspace(errors.REFUSED, answer.failure);
      if (!isGitHubAddress(answer.url)) return yield* Effect.fail(errors.REFUSED());
      yield* Effect.promise(() => openExternal(answer.url));
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_DISCONNECT]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_DISCONNECT
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.workspaceGitHubDisconnect(input);
      if ("failure" in answer) return yield* refusedWorkspace(errors.REFUSED, answer.failure);
    }),
    // Note that the address the service answered opens only where it is
    // https, because it is Vercel Connect's and the panel did not name it.
    [WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_CONNECT]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_CONNECT
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.workspaceLinearConnect(input);
      if ("failure" in answer) return yield* refusedWorkspace(errors.REFUSED, answer.failure);
      if (!isBrowserAddress(answer.url)) return yield* Effect.fail(errors.REFUSED());
      yield* Effect.promise(() => openExternal(answer.url));
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_DISCONNECT]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_DISCONNECT
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.workspaceLinearDisconnect(input);
      if ("failure" in answer) return yield* refusedWorkspace(errors.REFUSED, answer.failure);
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_ISSUES]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_ISSUES
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.workspaceLinearIssues(input);
      if ("issues" in answer) return answer.issues;
      return yield* refusedWorkspace(errors.REFUSED, answer.failure);
    }),
    // A repository's issues, or that its installation grants none, which the picker says rather than listing none.
    [WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_ISSUES]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_ISSUES
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.tasksGitHubIssues(input);
      if ("failure" in answer) return yield* Effect.fail(errors.REFUSED());
      return answer;
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_MEMBERS_READ]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_MEMBERS_READ
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.workspaceMembers(input);
      if ("members" in answer) return answer.members;
      return yield* refusedWorkspace(errors.REFUSED, answer.failure);
    }),
    // Who left is read on the same read as the members, so a service that names nobody answers none.
    [WORKSPACE_ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.workspaceMembers(input);
      if ("members" in answer) return answer.former ?? [];
      return yield* refusedWorkspace(errors.REFUSED, answer.failure);
    }),
    // Note that the photo's answer, a failure among them, is the panel's to
    // read, as an inbox image's is, because a tile that hears none draws its
    // letter rather than a refusal.
    [WORKSPACE_ACT_KIND.WORKSPACE_PHOTO_READ]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_PHOTO_READ
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.workspacePhoto(input);
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_MEMBER_REMOVE]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_MEMBER_REMOVE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.workspaceMemberRemove(input);
      if ("members" in answer) return answer.members;
      return yield* refusedWorkspace(errors.REFUSED, answer.failure);
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_MEMBER_ROLE]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_MEMBER_ROLE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.workspaceMemberRole(input);
      if ("members" in answer) return answer.members;
      return yield* refusedWorkspace(errors.REFUSED, answer.failure);
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_TRANSFER]: actPort[WORKSPACE_ACT_KIND.WORKSPACE_TRANSFER].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const answer = yield* host.workspaceTransfer(input);
        if ("members" in answer) return answer.members;
        return yield* refusedWorkspace(errors.REFUSED, answer.failure);
      },
    ),
    [WORKSPACE_ACT_KIND.WORKSPACE_LEAVE]: actPort[WORKSPACE_ACT_KIND.WORKSPACE_LEAVE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const answer = yield* host.workspaceLeave(input);
        if ("failure" in answer) return yield* refusedWorkspace(errors.REFUSED, answer.failure);
      },
    ),
  };
}
