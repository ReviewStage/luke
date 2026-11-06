import { WORKSPACE_CALL_FAILURE, type WorkspaceCallFailure } from "@repo/features";
import type {
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
  TasksWorkspaceParams,
  TasksWorkspacePhotoSetParams,
  TasksWorkspaceRenameParams,
  TasksWorkspaceSentryAnswer,
  TasksWorkspaceSentryDisconnectParams,
  TasksWorkspaceSlackBotAnswer,
  TasksWorkspaceSlackBotChannelParams,
  TasksWorkspaceSlackBotNotificationsParams,
  TasksWorkspaceSlackBotRepositoryParams,
  TasksWorkspaceSlugSetParams,
  TasksWorkspaceTokenRepositoriesAnswer,
  TasksWorkspaceTokenRepositoriesParams,
  TasksWorkspaceTokenRepositorySetParams,
  TasksWorkspaceTransferParams,
  WorkspacePeopleFollow,
} from "@repo/features/tasks-view";
import { WORKSPACE_SLUG_PROBLEM } from "@repo/features/workspace-wire";
import { Effect, MutableHashMap, Option, Stream } from "effect";
import {
  ALREADY_INVITED_REFUSAL,
  isGitHubAddress,
  WORKSPACE_NOT_PERMITTED_REFUSAL,
  WORKSPACE_SLUG_REFUSAL,
} from "../acts.js";
import { WORKSPACE_ACT_KIND } from "../contract/index.js";
import { type ActSender, actPort } from "./base.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

export interface WorkspaceProceduresDependencies {
  host: {
    workspaceCreate(params: TasksWorkspaceCreateParams): Effect.Effect<TasksWorkspaceAnswer>;
    workspaceRename(params: TasksWorkspaceRenameParams): Effect.Effect<TasksWorkspaceAnswer>;
    workspacePhotoSet(params: TasksWorkspacePhotoSetParams): Effect.Effect<TasksWorkspaceAnswer>;
    workspaceSlugSet(params: TasksWorkspaceSlugSetParams): Effect.Effect<TasksWorkspaceAnswer>;
    workspaceGitHubConnect(
      params: TasksWorkspaceParams,
    ): Effect.Effect<TasksWorkspaceGitHubConnectAnswer>;
    workspaceGitHubDisconnect(params: TasksWorkspaceParams): Effect.Effect<TasksWorkspaceAnswer>;
    workspaceSentryInstall(
      params: TasksWorkspaceParams,
    ): Effect.Effect<TasksWorkspaceGitHubConnectAnswer>;
    workspaceSentryDisconnect(
      params: TasksWorkspaceSentryDisconnectParams,
    ): Effect.Effect<TasksWorkspaceSentryAnswer>;
    workspaceSlackBotConnect(
      params: TasksWorkspaceParams,
    ): Effect.Effect<TasksWorkspaceSlackBotAnswer>;
    workspaceSlackBotDisconnect(
      params: TasksWorkspaceParams,
    ): Effect.Effect<TasksWorkspaceSlackBotAnswer>;
    workspaceSlackBotNotifications(
      params: TasksWorkspaceSlackBotNotificationsParams,
    ): Effect.Effect<TasksWorkspaceSlackBotAnswer>;
    workspaceSlackBotRepository(
      params: TasksWorkspaceSlackBotRepositoryParams,
    ): Effect.Effect<TasksWorkspaceSlackBotAnswer>;
    workspaceSlackBotChannel(
      params: TasksWorkspaceSlackBotChannelParams,
    ): Effect.Effect<TasksWorkspaceSlackBotAnswer>;
    workspaceMembersFollow(scope: WorkspacePeopleFollow): Effect.Effect<void>;
    workspaceMembersUnfollow(scope: WorkspacePeopleFollow): Effect.Effect<void>;
    workspaceMembersRetry(scope: WorkspacePeopleFollow): Effect.Effect<void>;
    workspaceIntegrationsFollow(params: TasksWorkspaceParams): Effect.Effect<void>;
    workspaceIntegrationsUnfollow(params: TasksWorkspaceParams): Effect.Effect<void>;
    workspaceIntegrationsRetry(params: TasksWorkspaceParams): Effect.Effect<void>;
    workspaceSlackChannelsFollow(params: TasksWorkspaceParams): Effect.Effect<void>;
    workspaceSlackChannelsUnfollow(params: TasksWorkspaceParams): Effect.Effect<void>;
    workspaceSlackChannelsRetry(params: TasksWorkspaceParams): Effect.Effect<void>;
    workspaceInvitationsFollow(scope: WorkspacePeopleFollow): Effect.Effect<void>;
    workspaceInvitationsUnfollow(scope: WorkspacePeopleFollow): Effect.Effect<void>;
    workspaceInvitationsRetry(scope: WorkspacePeopleFollow): Effect.Effect<void>;
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
    workspaceInvite(
      params: TasksWorkspaceInviteParams,
    ): Effect.Effect<TasksWorkspaceInvitationAnswer>;
    workspaceInvitationCancel(
      params: TasksWorkspaceInvitationCancelParams,
    ): Effect.Effect<TasksWorkspaceInvitationsAnswer>;
    workspaceTokenRepositoriesFollow(
      params: TasksWorkspaceTokenRepositoriesParams,
    ): Effect.Effect<void>;
    workspaceTokenRepositoriesUnfollow(
      params: TasksWorkspaceTokenRepositoriesParams,
    ): Effect.Effect<void>;
    workspaceTokenRepositoriesRetry(
      params: TasksWorkspaceTokenRepositoriesParams,
    ): Effect.Effect<void>;
    workspaceTokenRepositorySet(
      params: TasksWorkspaceTokenRepositorySetParams,
    ): Effect.Effect<TasksWorkspaceTokenRepositoriesAnswer>;
  };
  openExternal: (url: string) => Promise<void>;
}

function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

type Refused<E> = (options?: { message?: string }) => E;

function refusedWorkspace<E>(refused: Refused<E>, failure: WorkspaceCallFailure) {
  switch (failure) {
    case WORKSPACE_CALL_FAILURE.NOT_PERMITTED:
      return Effect.fail(refused({ message: WORKSPACE_NOT_PERMITTED_REFUSAL }));
    case WORKSPACE_CALL_FAILURE.ALREADY_INVITED:
      return Effect.fail(refused({ message: ALREADY_INVITED_REFUSAL }));
    case WORKSPACE_CALL_FAILURE.SLUG_MALFORMED:
      return Effect.fail(
        refused({ message: WORKSPACE_SLUG_REFUSAL[WORKSPACE_SLUG_PROBLEM.MALFORMED] }),
      );
    case WORKSPACE_CALL_FAILURE.SLUG_RESERVED:
      return Effect.fail(
        refused({ message: WORKSPACE_SLUG_REFUSAL[WORKSPACE_SLUG_PROBLEM.RESERVED] }),
      );
    case WORKSPACE_CALL_FAILURE.SLUG_TAKEN:
      return Effect.fail(
        refused({ message: WORKSPACE_SLUG_REFUSAL[WORKSPACE_SLUG_PROBLEM.TAKEN] }),
      );
    default:
      return Effect.fail(refused());
  }
}

const SENTRY_ORIGIN = "https://sentry.io";

function isSentryAddress(url: string): boolean {
  return URL.canParse(url) && new URL(url).origin === SENTRY_ORIGIN;
}

function workspaceHold(
  side: {
    readonly follow: (scope: WorkspacePeopleFollow) => Effect.Effect<void>;
    readonly unfollow: (scope: WorkspacePeopleFollow) => Effect.Effect<void>;
  },
  open: OpenFollows<never>,
  scope: WorkspacePeopleFollow,
): Stream.Stream<never> {
  return followedStream(
    {
      keyOf: (held: WorkspacePeopleFollow) => held.workspaceId,
      follow: side.follow,
      unfollow: side.unfollow,
      onChanged: () => () => undefined,
      valueOf: () => Option.none<never>(),
    },
    open,
    scope,
  );
}

export function workspaceProcedures(dependencies: WorkspaceProceduresDependencies) {
  const { host, openExternal } = dependencies;
  const openPeople: OpenFollows<never> = MutableHashMap.empty();
  const openTokenRepositories: OpenFollows<never> = MutableHashMap.empty();
  const openIntegrations: OpenFollows<never> = MutableHashMap.empty();
  const openChannels: OpenFollows<never> = MutableHashMap.empty();
  const openInvitations: OpenFollows<never> = MutableHashMap.empty();
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
    [WORKSPACE_ACT_KIND.WORKSPACE_SLUG_SET]: actPort[WORKSPACE_ACT_KIND.WORKSPACE_SLUG_SET].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const answer = yield* host.workspaceSlugSet(input);
        if ("workspace" in answer) return answer.workspace;
        return yield* refusedWorkspace(errors.REFUSED, answer.failure);
      },
    ),
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
    [WORKSPACE_ACT_KIND.WORKSPACE_SENTRY_INSTALL]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_SENTRY_INSTALL
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.workspaceSentryInstall(input);
      if ("failure" in answer) return yield* refusedWorkspace(errors.REFUSED, answer.failure);
      if (!isSentryAddress(answer.url)) return yield* Effect.fail(errors.REFUSED());
      yield* Effect.promise(() => openExternal(answer.url));
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_SENTRY_DISCONNECT]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_SENTRY_DISCONNECT
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.workspaceSentryDisconnect(input);
      if ("sentry" in answer) return answer.sentry;
      return yield* refusedWorkspace(errors.REFUSED, answer.failure);
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_SLACK_BOT_CONNECT]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_SLACK_BOT_CONNECT
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.workspaceSlackBotConnect(input);
      if ("slackBot" in answer) return answer.slackBot;
      return yield* refusedWorkspace(errors.REFUSED, answer.failure);
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_SLACK_BOT_DISCONNECT]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_SLACK_BOT_DISCONNECT
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.workspaceSlackBotDisconnect(input);
      if ("slackBot" in answer) return answer.slackBot;
      return yield* refusedWorkspace(errors.REFUSED, answer.failure);
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_SLACK_BOT_NOTIFICATIONS]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_SLACK_BOT_NOTIFICATIONS
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.workspaceSlackBotNotifications(input);
      if ("slackBot" in answer) return answer.slackBot;
      return yield* refusedWorkspace(errors.REFUSED, answer.failure);
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_SLACK_BOT_REPOSITORY]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_SLACK_BOT_REPOSITORY
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.workspaceSlackBotRepository(input);
      if ("slackBot" in answer) return answer.slackBot;
      return yield* refusedWorkspace(errors.REFUSED, answer.failure);
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_SLACK_BOT_CHANNEL]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_SLACK_BOT_CHANNEL
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.workspaceSlackBotChannel(input);
      if ("slackBot" in answer) return answer.slackBot;
      return yield* refusedWorkspace(errors.REFUSED, answer.failure);
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_MEMBERS_FOLLOW]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_MEMBERS_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = workspaceHold(
        { follow: host.workspaceMembersFollow, unfollow: host.workspaceMembersUnfollow },
        openPeople,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(hold));
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_MEMBERS_RETRY]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_MEMBERS_RETRY
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.workspaceMembersRetry(input);
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_INTEGRATIONS_FOLLOW]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_INTEGRATIONS_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: (held: TasksWorkspaceParams) => held.workspaceId,
          follow: host.workspaceIntegrationsFollow,
          unfollow: host.workspaceIntegrationsUnfollow,
          onChanged: () => () => undefined,
          valueOf: () => Option.none<never>(),
        },
        openIntegrations,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(hold));
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_INTEGRATIONS_RETRY]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_INTEGRATIONS_RETRY
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.workspaceIntegrationsRetry(input);
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_SLACK_CHANNELS_FOLLOW]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_SLACK_CHANNELS_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: (held: TasksWorkspaceParams) => held.workspaceId,
          follow: host.workspaceSlackChannelsFollow,
          unfollow: host.workspaceSlackChannelsUnfollow,
          onChanged: () => () => undefined,
          valueOf: () => Option.none<never>(),
        },
        openChannels,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(hold));
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_SLACK_CHANNELS_RETRY]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_SLACK_CHANNELS_RETRY
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.workspaceSlackChannelsRetry(input);
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_INVITATIONS_FOLLOW]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_INVITATIONS_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = workspaceHold(
        { follow: host.workspaceInvitationsFollow, unfollow: host.workspaceInvitationsUnfollow },
        openInvitations,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(hold));
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_INVITATIONS_RETRY]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_INVITATIONS_RETRY
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.workspaceInvitationsRetry(input);
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
    [WORKSPACE_ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_FOLLOW]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: (held: TasksWorkspaceTokenRepositoriesParams) => held.workspaceId,
          follow: host.workspaceTokenRepositoriesFollow,
          unfollow: host.workspaceTokenRepositoriesUnfollow,
          onChanged: () => () => undefined,
          valueOf: () => Option.none<never>(),
        },
        openTokenRepositories,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(hold));
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_RETRY]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_RETRY
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.workspaceTokenRepositoriesRetry(input);
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_TOKEN_REPOSITORY_SET]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_TOKEN_REPOSITORY_SET
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.workspaceTokenRepositorySet(input);
      if ("repositories" in answer) return answer.repositories;
      return yield* refusedWorkspace(errors.REFUSED, answer.failure);
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_LEAVE]: actPort[WORKSPACE_ACT_KIND.WORKSPACE_LEAVE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const answer = yield* host.workspaceLeave(input);
        if ("failure" in answer) return yield* refusedWorkspace(errors.REFUSED, answer.failure);
      },
    ),
  };
}
