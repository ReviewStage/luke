import { WORKSPACE_CALL_FAILURE, type WorkspaceCallFailure } from "@repo/features";
import type {
  TasksWorkspaceAnswer,
  TasksWorkspaceCreateParams,
  TasksWorkspaceExperimentSetParams,
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

/**
 * workspace-procedures.ts -- the panel's asks of the host about the account's workspaces.
 *
 * The one check these procedures make is who asked: only a panel draws a
 * workspace, so every one refuses the takeover and any other window,
 * in its own sentence. What the service answers comes back as the panel's
 * own answer, or why there is none: a write the account's role does not
 * allow in words that say so, and anything else in the kind's own words. A
 * workspace's people, its token repositories, its invitations, its own
 * integrations, and its Slack channels are each held while a panel holds
 * their stream open: the host holds them on the first stream and lets them
 * go with the last, and what they hold reaches every panel on app state,
 * never down the stream, which carries nothing. How many streams stand open
 * of each is all else held here.
 */
export interface WorkspaceProceduresDependencies {
  host: {
    workspaceCreate(params: TasksWorkspaceCreateParams): Effect.Effect<TasksWorkspaceAnswer>;
    workspaceRename(params: TasksWorkspaceRenameParams): Effect.Effect<TasksWorkspaceAnswer>;
    workspaceExperimentSet(
      params: TasksWorkspaceExperimentSetParams,
    ): Effect.Effect<TasksWorkspaceAnswer>;
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
    /** A workspace's people held followed at the host while any stream of them stands; what they hold reaches the panel on app state. */
    workspaceMembersFollow(scope: WorkspacePeopleFollow): Effect.Effect<void>;
    workspaceMembersUnfollow(scope: WorkspacePeopleFollow): Effect.Effect<void>;
    /** A held workspace's people read again at once, as Try again asks. */
    workspaceMembersRetry(scope: WorkspacePeopleFollow): Effect.Effect<void>;
    /** A workspace's own integrations held followed at the host while any stream of them stands; what they hold reaches the panel on app state. */
    workspaceIntegrationsFollow(params: TasksWorkspaceParams): Effect.Effect<void>;
    workspaceIntegrationsUnfollow(params: TasksWorkspaceParams): Effect.Effect<void>;
    /** A held workspace's integrations read again at once, as Try again asks. */
    workspaceIntegrationsRetry(params: TasksWorkspaceParams): Effect.Effect<void>;
    /** A workspace's Slack channels held at the host while any stream of them stands; what Slack lists reaches the panel on app state. */
    workspaceSlackChannelsFollow(params: TasksWorkspaceParams): Effect.Effect<void>;
    workspaceSlackChannelsUnfollow(params: TasksWorkspaceParams): Effect.Effect<void>;
    /** A held workspace's Slack channels asked again at once, as Try again asks; done once the ask has landed. */
    workspaceSlackChannelsRetry(params: TasksWorkspaceParams): Effect.Effect<void>;
    /** A workspace's pending invitations held followed at the host while any stream of them stands; what they hold reaches the panel on app state. */
    workspaceInvitationsFollow(scope: WorkspacePeopleFollow): Effect.Effect<void>;
    workspaceInvitationsUnfollow(scope: WorkspacePeopleFollow): Effect.Effect<void>;
    /** A held workspace's invitations read again at once, as Try again asks. */
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
    /** A workspace's token repositories held at the host while any stream of them stands; what they hold reaches the panel on app state. */
    workspaceTokenRepositoriesFollow(
      params: TasksWorkspaceTokenRepositoriesParams,
    ): Effect.Effect<void>;
    workspaceTokenRepositoriesUnfollow(
      params: TasksWorkspaceTokenRepositoriesParams,
    ): Effect.Effect<void>;
    /** A workspace's held token repositories asked again at once, as Try again asks; done once the ask has landed. */
    workspaceTokenRepositoriesRetry(
      params: TasksWorkspaceTokenRepositoriesParams,
    ): Effect.Effect<void>;
    workspaceTokenRepositorySet(
      params: TasksWorkspaceTokenRepositorySetParams,
    ): Effect.Effect<TasksWorkspaceTokenRepositoriesAnswer>;
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

/** Sentry's own origin, the one a Sentry install is opened on. */
const SENTRY_ORIGIN = "https://sentry.io";

/** Whether an address the host answered parses and stands on Sentry's own origin. */
function isSentryAddress(url: string): boolean {
  return URL.canParse(url) && new URL(url).origin === SENTRY_ORIGIN;
}

/**
 * The hold one stream a window opens keeps on a workspace's read, held at
 * the host while any stream of it stands. Note that nothing is heard down
 * it, since the held read reaches the panel on app state.
 */
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
  /** Every workspace whose people, token repositories, or invitations a window holds a stream open of, each so the host lets them go only with the last. */
  const openPeople: OpenFollows<never> = MutableHashMap.empty();
  const openTokenRepositories: OpenFollows<never> = MutableHashMap.empty();
  /** Every workspace whose integrations a window holds a stream open of, as its people are. */
  const openIntegrations: OpenFollows<never> = MutableHashMap.empty();
  /** Every workspace whose Slack channels a window holds a stream open of, as its people are. */
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
    [WORKSPACE_ACT_KIND.WORKSPACE_EXPERIMENT_SET]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_EXPERIMENT_SET
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const answer = yield* host.workspaceExperimentSet(input);
      if ("workspace" in answer) return answer.workspace;
      return yield* refusedWorkspace(errors.REFUSED, answer.failure);
    }),
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
    // Sentry's own, because it is the one address here the panel did not name.
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
      // Note that nothing is heard down the hold, since the held integrations reach the panel on app state.
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
      // Note that nothing is heard down the hold, since the held channels reach the panel on app state.
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
      // Note that nothing is heard down the hold, since the held repositories reach the panel on app state.
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
