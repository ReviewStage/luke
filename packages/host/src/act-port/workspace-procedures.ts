import type {
  TasksWorkspaceParams,
  TasksWorkspaceTokenRepositoriesParams,
  WorkspacePeopleFollow,
} from "@repo/features/tasks-view";
import { Effect, MutableHashMap, Stream } from "effect";
import { isGitHubAddress } from "../acts.js";
import { WORKSPACE_ACT_KIND, WORKSPACE_ACTS } from "../contract/index.js";
import type { HostActTable } from "../host-acts.js";
import { type ActSender, actPort } from "./base.js";
import { declaredAnswer } from "./declared-acts.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

/**
 * workspace-procedures.ts -- the panel's asks of the host about the account's workspaces that do work at the window: a connection's address opened, and the holds.
 *
 * Every other workspace act is declared and answered by the tasks'
 * composer directly (`contract/workspaces.ts`). A connection is declared
 * too, but written by hand: its handler answers the address the service
 * named, or its refusal, and only an address on the connection's own origin
 * is opened. Only a panel draws a workspace, so every hold refuses the
 * takeover and any other window, in its own sentence. A workspace's people, its token repositories, its invitations, its own
 * integrations, and its Slack channels are each held while a panel holds
 * their stream open: the host holds them on the first stream and lets them
 * go with the last, and what they hold reaches every panel on app state,
 * never down the stream, which carries nothing. How many streams stand open
 * of each is all else held here.
 */
export interface WorkspaceProceduresDependencies {
  host: {
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
  };
  /** Opens an address in the browser: a connection's install or sign-in page the service named. */
  openExternal: (url: string) => Promise<void>;
}

/** The refusal a window that draws no workspace hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

/** Sentry's own origin, the one a Sentry install is opened on. */
const SENTRY_ORIGIN = "https://sentry.io";

/** Whether an address the host answered parses and stands on Sentry's own origin. */
function isSentryAddress(url: string): boolean {
  return URL.canParse(url) && new URL(url).origin === SENTRY_ORIGIN;
}

/**
 * The hold one stream a window opens keeps on a workspace's read, held at
 * the host while any stream of it stands.
 */
function workspaceHold(
  side: {
    readonly follow: (scope: WorkspacePeopleFollow) => Effect.Effect<void>;
    readonly unfollow: (scope: WorkspacePeopleFollow) => Effect.Effect<void>;
  },
  open: OpenFollows,
  scope: WorkspacePeopleFollow,
): Stream.Stream<never> {
  return followedStream(
    {
      keyOf: (held: WorkspacePeopleFollow) => held.workspaceId,
      follow: side.follow,
      unfollow: side.unfollow,
    },
    open,
    scope,
  );
}

/** The handlers of the connections, whose procedures open what they answer. */
type ConnectActs = Pick<HostActTable, "WORKSPACE_GITHUB_CONNECT" | "WORKSPACE_SENTRY_INSTALL">;

export function workspaceProcedures(
  dependencies: WorkspaceProceduresDependencies,
  acts: ConnectActs,
) {
  const { host, openExternal } = dependencies;
  /** Every workspace whose people, token repositories, or invitations a window holds a stream open of, each so the host lets them go only with the last. */
  const openPeople: OpenFollows = MutableHashMap.empty();
  const openTokenRepositories: OpenFollows = MutableHashMap.empty();
  /** Every workspace whose integrations a window holds a stream open of, as its people are. */
  const openIntegrations: OpenFollows = MutableHashMap.empty();
  /** Every workspace whose Slack channels a window holds a stream open of, as its people are. */
  const openChannels: OpenFollows = MutableHashMap.empty();
  const openInvitations: OpenFollows = MutableHashMap.empty();
  return {
    // Note that the address the service answered opens only where it is
    // GitHub's, because it is the one address here the panel did not name.
    [WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_CONNECT]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_CONNECT
    ].effect(function* ({ input, errors }) {
      const url = yield* declaredAnswer(
        WORKSPACE_ACTS.WORKSPACE_GITHUB_CONNECT,
        acts.WORKSPACE_GITHUB_CONNECT,
        input,
      );
      if (!isGitHubAddress(url)) return yield* Effect.fail(errors.REFUSED());
      yield* Effect.promise(() => openExternal(url));
    }),
    // Note that the address the service answered opens only where it is
    // Sentry's own, because it is the one address here the panel did not name.
    [WORKSPACE_ACT_KIND.WORKSPACE_SENTRY_INSTALL]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_SENTRY_INSTALL
    ].effect(function* ({ input, errors }) {
      const url = yield* declaredAnswer(
        WORKSPACE_ACTS.WORKSPACE_SENTRY_INSTALL,
        acts.WORKSPACE_SENTRY_INSTALL,
        input,
      );
      if (!isSentryAddress(url)) return yield* Effect.fail(errors.REFUSED());
      yield* Effect.promise(() => openExternal(url));
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
    [WORKSPACE_ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_FOLLOW]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: (held: TasksWorkspaceTokenRepositoriesParams) => held.workspaceId,
          follow: host.workspaceTokenRepositoriesFollow,
          unfollow: host.workspaceTokenRepositoriesUnfollow,
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
  };
}
