/**
 * agents-procedures.ts -- the Tasks tab's holds of a task's coding agents and what they published, and the asks whose answer is noted on its way.
 *
 * Only a panel draws a task's agents, so every procedure refuses the
 * takeover and any other window, in its own sentence. The agents' plain
 * acts are declared (`contract/agents.ts`) and answered by their composer;
 * those written here are the ones whose answer is noted on its way, by the
 * notices (`@repo/host/agent-notices`), which hold where each agent stands
 * so an end the panel is not looking at is still announced, and which
 * agent's tab and task's Inbox the panel shows, so an item it is
 * looking at is not; and an agent's own pull request, read, is noted as
 * what it published. Nothing else is held here.
 */

import {
  AGENT_CALL_FAILURE,
  type AgentAgentAnswer,
  type AgentPageParams,
  type AgentPullRequestParams,
  type AgentTranscriptKey,
  type PullRequestPart,
  type PullRequestPartParams,
} from "@repo/features/agent-view";
import { Data, Effect, MutableHashMap, Stream } from "effect";
import type { AgentNotices } from "../agent-notices.js";
import { AGENT_ACT_KIND, AGENT_ACTS } from "../contract/index.js";
import type { HostActTable } from "../host-acts.js";
import { type ActSender, actPort } from "./base.js";
import { declaredAnswer } from "./declared-acts.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

/** What the agent procedures reach: the host's asks of the service, and the notices. */
export interface AgentProceduresDependencies {
  host: {
    /** The models held at the host while any stream of them stands; what it holds reaches the panel on app state. */
    agentModelsFollow(): Effect.Effect<void>;
    agentModelsUnfollow(): Effect.Effect<void>;
    agentModelsRetry(): Effect.Effect<void>;
    agentPreferencesRetry(): Effect.Effect<void>;
    /** The account's hosts held at the host while any stream of them stands; what it holds reaches the panel on app state. */
    hostsFollow(): Effect.Effect<void>;
    hostsUnfollow(): Effect.Effect<void>;
    /** The account's held hosts read again at once, as Try again asks. */
    hostsRetry(): Effect.Effect<void>;
    /** The account's devices' beats held at the host while any stream of them stands; what it holds reaches the panel on app state. */
    hostsPresenceFollow(): Effect.Effect<void>;
    hostsPresenceUnfollow(): Effect.Effect<void>;
    hostsPresenceRefresh(): Effect.Effect<void>;
    /** A transcript held followed at the host while any stream of it stands; what it holds reaches the panel on app state. */
    transcriptFollow(transcript: AgentTranscriptKey): Effect.Effect<void>;
    transcriptUnfollow(transcript: AgentTranscriptKey): Effect.Effect<void>;
    /** A held transcript read again at once, as Try again asks. */
    transcriptRetry(transcript: AgentTranscriptKey): Effect.Effect<void>;
    /** One agent's origin held followed at the host while any stream of it stands; what it holds reaches the panel on app state. */
    agentOriginFollow(params: AgentPageParams): Effect.Effect<void>;
    agentOriginUnfollow(params: AgentPageParams): Effect.Effect<void>;
    /** One agent's held origin read again at once, as Try again asks. */
    agentOriginRetry(params: AgentPageParams): Effect.Effect<void>;
    /** One part of one agent's pull request held at the host while any stream of it stands; what it holds reaches the panel on app state. */
    pullRequestPartFollow(params: PullRequestPartParams): Effect.Effect<void>;
    pullRequestPartUnfollow(params: PullRequestPartParams): Effect.Effect<void>;
    /** One pull request's held part asked again at once, as Try again asks; done once the ask has landed. */
    pullRequestPartRetry(params: PullRequestPartParams): Effect.Effect<void>;
    /** One agent's own tools held at the host while any stream of them stands; what it holds reaches the panel on app state. */
    agentWorkspaceToolsFollow(params: AgentPullRequestParams): Effect.Effect<void>;
    agentWorkspaceToolsUnfollow(params: AgentPullRequestParams): Effect.Effect<void>;
    /** One agent's held tools asked again at once, as Try again asks; done once the ask has landed. */
    agentWorkspaceToolsRetry(params: AgentPullRequestParams): Effect.Effect<void>;
  };
  /** The agents' acts whose answer is noted on its way, each answered by its composer's handler (`HostAssembly`'s). */
  acts: Pick<HostActTable<typeof AGENT_ACTS>, NotedAgentAct>;
  /** Where every answer's agents and what an agent published are noted, and which agent's tab the panel shows. */
  notices: Pick<
    AgentNotices,
    "observeAgents" | "observeStatus" | "observeMessaged" | "observeTaskGone" | "shown" | "seen"
  >;
}

/** The agents' acts answered by hand here, so their answer is noted on its way to the panel. */
type NotedAgentAct =
  | "AGENTS_LIST"
  | "AGENTS_START"
  | "AGENTS_MESSAGES"
  | "AGENTS_MESSAGE"
  | "AGENTS_CHOOSE"
  | "AGENTS_RENAME"
  | "AGENTS_SERVERS"
  | "AGENTS_ADD_REPOSITORY"
  | "AGENTS_STOP"
  | "AGENTS_REWIND"
  | "AGENTS_ARCHIVE"
  | "AGENTS_PIN"
  | "AGENTS_MARK_READ";

/** The refusal a window that draws no Tasks tab hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

/** The answer as it stands, noted on its way to the panel. */
function noted<Answer, E>(
  answer: Effect.Effect<Answer, E>,
  note: (answer: Answer) => void,
): Effect.Effect<Answer, E> {
  return Effect.tap(answer, (value) => Effect.sync(() => note(value)));
}

/** A transcript as a key that equals another naming the same one. */
class TranscriptStreamKey extends Data.Class<{
  readonly kind: AgentTranscriptKey["kind"];
  readonly owner: string;
  readonly callId: string | undefined;
}> {}

/** A pull request's part as a key that equals another naming the same one. */
class PullRequestPartStreamKey extends Data.Class<{
  readonly part: PullRequestPart;
  readonly agentId: string;
  readonly number: number | undefined;
}> {}

function pullRequestPartKeyOf({ part, agentId, number }: PullRequestPartParams) {
  return new PullRequestPartStreamKey({ part, agentId, number });
}

function transcriptKeyOf(transcript: AgentTranscriptKey): TranscriptStreamKey {
  return new TranscriptStreamKey({
    kind: transcript.kind,
    owner: transcript.agentId,
    callId: transcript.callId,
  });
}

export function agentProcedures(dependencies: AgentProceduresDependencies) {
  const { host, acts, notices } = dependencies;
  /** Every transcript a window holds a stream open of, so the host lets one go only with the last. */
  const openTranscripts: OpenFollows<TranscriptStreamKey> = MutableHashMap.empty();
  /** Every agent's origin a window holds a stream open of, so the host lets one go only with the last. */
  const openOrigins: OpenFollows = MutableHashMap.empty();
  /** The account's beats while a window holds a stream open of them, so the host lets them go only with the last. */
  const openPresence: OpenFollows = MutableHashMap.empty();
  /** Whether a window holds a stream of the models open, so the host lets them go only with the last. */
  const openModels: OpenFollows = MutableHashMap.empty();
  /** The account's hosts while a window holds a stream open of them, so the host lets them go only with the last. */
  const openHosts: OpenFollows = MutableHashMap.empty();
  /** Every agent's tools a window holds a stream open of, so the host lets them go only with the last. */
  const openTools: OpenFollows = MutableHashMap.empty();
  /** Every pull request's part a window holds a stream open of, so the host lets it go only with the last. */
  const openParts: OpenFollows<PullRequestPartStreamKey> = MutableHashMap.empty();
  const notedAgent = <E>(answer: Effect.Effect<AgentAgentAnswer, E>) =>
    noted(answer, (value) => {
      if ("agent" in value) notices.observeAgents([value.agent]);
    });
  return {
    [AGENT_ACT_KIND.AGENTS_MODELS_FOLLOW]: actPort[AGENT_ACT_KIND.AGENTS_MODELS_FOLLOW].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const hold = followedStream(
          {
            keyOf: () => "models",
            follow: () => host.agentModelsFollow(),
            unfollow: () => host.agentModelsUnfollow(),
          },
          openModels,
          input,
        );
        return streamed(yield* Stream.toAsyncIterableEffect(hold));
      },
    ),
    [AGENT_ACT_KIND.AGENTS_MODELS_RETRY]: actPort[AGENT_ACT_KIND.AGENTS_MODELS_RETRY].effect(
      function* ({ context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        yield* host.agentModelsRetry();
      },
    ),
    [AGENT_ACT_KIND.AGENTS_PREFERENCES_RETRY]: actPort[
      AGENT_ACT_KIND.AGENTS_PREFERENCES_RETRY
    ].effect(function* ({ context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.agentPreferencesRetry();
    }),
    [AGENT_ACT_KIND.HOSTS_FOLLOW]: actPort[AGENT_ACT_KIND.HOSTS_FOLLOW].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: () => "hosts",
          follow: () => host.hostsFollow(),
          unfollow: () => host.hostsUnfollow(),
        },
        openHosts,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(hold));
    }),
    [AGENT_ACT_KIND.HOSTS_RETRY]: actPort[AGENT_ACT_KIND.HOSTS_RETRY].effect(function* ({
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.hostsRetry();
    }),
    [AGENT_ACT_KIND.HOSTS_PRESENCE_FOLLOW]: actPort[AGENT_ACT_KIND.HOSTS_PRESENCE_FOLLOW].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const hold = followedStream(
          {
            keyOf: () => "presence",
            follow: () => host.hostsPresenceFollow(),
            unfollow: () => host.hostsPresenceUnfollow(),
          },
          openPresence,
          input,
        );
        return streamed(yield* Stream.toAsyncIterableEffect(hold));
      },
    ),
    [AGENT_ACT_KIND.HOSTS_PRESENCE_REFRESH]: actPort[AGENT_ACT_KIND.HOSTS_PRESENCE_REFRESH].effect(
      function* ({ context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        yield* host.hostsPresenceRefresh();
      },
    ),
    [AGENT_ACT_KIND.AGENTS_LIST]: actPort[AGENT_ACT_KIND.AGENTS_LIST].effect(function* ({ input }) {
      return yield* noted(
        declaredAnswer(AGENT_ACTS.AGENTS_LIST, acts.AGENTS_LIST, input),
        (answer) => {
          if ("agents" in answer) notices.observeAgents(answer.agents);
          else if (answer.failure === AGENT_CALL_FAILURE.NOT_FOUND) {
            notices.observeTaskGone(input.taskId);
          }
        },
      );
    }),
    [AGENT_ACT_KIND.AGENTS_START]: actPort[AGENT_ACT_KIND.AGENTS_START].effect(function* ({
      input,
    }) {
      return yield* notedAgent(declaredAnswer(AGENT_ACTS.AGENTS_START, acts.AGENTS_START, input));
    }),
    [AGENT_ACT_KIND.AGENTS_MESSAGES]: actPort[AGENT_ACT_KIND.AGENTS_MESSAGES].effect(function* ({
      input,
    }) {
      // A worker's page says where the worker stands and what it is called, which is no word on the agent.
      return yield* noted(
        declaredAnswer(AGENT_ACTS.AGENTS_MESSAGES, acts.AGENTS_MESSAGES, input),
        (answer) => {
          if ("status" in answer && input.callId === undefined) {
            notices.observeStatus(input.agentId, answer.status);
          }
        },
      );
    }),
    [AGENT_ACT_KIND.AGENTS_TRANSCRIPT]: actPort[AGENT_ACT_KIND.AGENTS_TRANSCRIPT].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const hold = followedStream(
          {
            keyOf: transcriptKeyOf,
            follow: host.transcriptFollow,
            unfollow: host.transcriptUnfollow,
          },
          openTranscripts,
          input,
        );
        return streamed(yield* Stream.toAsyncIterableEffect(hold));
      },
    ),
    [AGENT_ACT_KIND.AGENTS_TRANSCRIPT_RETRY]: actPort[
      AGENT_ACT_KIND.AGENTS_TRANSCRIPT_RETRY
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.transcriptRetry(input);
    }),
    [AGENT_ACT_KIND.AGENTS_MESSAGE]: actPort[AGENT_ACT_KIND.AGENTS_MESSAGE].effect(function* ({
      input,
    }) {
      return yield* noted(
        declaredAnswer(AGENT_ACTS.AGENTS_MESSAGE, acts.AGENTS_MESSAGE, input),
        (answer) => {
          if ("agent" in answer) notices.observeMessaged(answer.agent);
        },
      );
    }),
    [AGENT_ACT_KIND.AGENTS_CHOOSE]: actPort[AGENT_ACT_KIND.AGENTS_CHOOSE].effect(function* ({
      input,
    }) {
      return yield* notedAgent(declaredAnswer(AGENT_ACTS.AGENTS_CHOOSE, acts.AGENTS_CHOOSE, input));
    }),
    [AGENT_ACT_KIND.AGENTS_RENAME]: actPort[AGENT_ACT_KIND.AGENTS_RENAME].effect(function* ({
      input,
    }) {
      return yield* notedAgent(declaredAnswer(AGENT_ACTS.AGENTS_RENAME, acts.AGENTS_RENAME, input));
    }),
    [AGENT_ACT_KIND.AGENTS_SERVERS]: actPort[AGENT_ACT_KIND.AGENTS_SERVERS].effect(function* ({
      input,
    }) {
      return yield* notedAgent(
        declaredAnswer(AGENT_ACTS.AGENTS_SERVERS, acts.AGENTS_SERVERS, input),
      );
    }),
    [AGENT_ACT_KIND.AGENTS_ADD_REPOSITORY]: actPort[AGENT_ACT_KIND.AGENTS_ADD_REPOSITORY].effect(
      function* ({ input }) {
        return yield* notedAgent(
          declaredAnswer(AGENT_ACTS.AGENTS_ADD_REPOSITORY, acts.AGENTS_ADD_REPOSITORY, input),
        );
      },
    ),
    [AGENT_ACT_KIND.AGENTS_STOP]: actPort[AGENT_ACT_KIND.AGENTS_STOP].effect(function* ({ input }) {
      return yield* notedAgent(declaredAnswer(AGENT_ACTS.AGENTS_STOP, acts.AGENTS_STOP, input));
    }),
    [AGENT_ACT_KIND.AGENTS_REWIND]: actPort[AGENT_ACT_KIND.AGENTS_REWIND].effect(function* ({
      input,
    }) {
      return yield* notedAgent(declaredAnswer(AGENT_ACTS.AGENTS_REWIND, acts.AGENTS_REWIND, input));
    }),
    [AGENT_ACT_KIND.AGENTS_ARCHIVE]: actPort[AGENT_ACT_KIND.AGENTS_ARCHIVE].effect(function* ({
      input,
    }) {
      return yield* notedAgent(
        declaredAnswer(AGENT_ACTS.AGENTS_ARCHIVE, acts.AGENTS_ARCHIVE, input),
      );
    }),
    [AGENT_ACT_KIND.AGENTS_PIN]: actPort[AGENT_ACT_KIND.AGENTS_PIN].effect(function* ({ input }) {
      return yield* notedAgent(declaredAnswer(AGENT_ACTS.AGENTS_PIN, acts.AGENTS_PIN, input));
    }),
    [AGENT_ACT_KIND.AGENTS_MARK_READ]: actPort[AGENT_ACT_KIND.AGENTS_MARK_READ].effect(function* ({
      input,
    }) {
      return yield* notedAgent(
        declaredAnswer(AGENT_ACTS.AGENTS_MARK_READ, acts.AGENTS_MARK_READ, input),
      );
    }),
    [AGENT_ACT_KIND.AGENTS_SHOWN]: actPort[AGENT_ACT_KIND.AGENTS_SHOWN].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      notices.shown(input.agentId);
    }),
    [AGENT_ACT_KIND.AGENTS_SEEN]: actPort[AGENT_ACT_KIND.AGENTS_SEEN].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      notices.seen(input.agentId);
    }),
    [AGENT_ACT_KIND.AGENTS_ORIGIN_FOLLOW]: actPort[AGENT_ACT_KIND.AGENTS_ORIGIN_FOLLOW].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const hold = followedStream(
          {
            keyOf: (params: AgentPageParams) => params.agentId,
            follow: host.agentOriginFollow,
            unfollow: host.agentOriginUnfollow,
          },
          openOrigins,
          input,
        );
        return streamed(yield* Stream.toAsyncIterableEffect(hold));
      },
    ),
    [AGENT_ACT_KIND.AGENTS_ORIGIN_RETRY]: actPort[AGENT_ACT_KIND.AGENTS_ORIGIN_RETRY].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        yield* host.agentOriginRetry(input);
      },
    ),
    [AGENT_ACT_KIND.AGENTS_PULL_REQUEST_PART_FOLLOW]: actPort[
      AGENT_ACT_KIND.AGENTS_PULL_REQUEST_PART_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: pullRequestPartKeyOf,
          follow: host.pullRequestPartFollow,
          unfollow: host.pullRequestPartUnfollow,
        },
        openParts,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(hold));
    }),
    [AGENT_ACT_KIND.AGENTS_PULL_REQUEST_PART_RETRY]: actPort[
      AGENT_ACT_KIND.AGENTS_PULL_REQUEST_PART_RETRY
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.pullRequestPartRetry(input);
    }),
    [AGENT_ACT_KIND.AGENTS_WORKSPACE_TOOLS_FOLLOW]: actPort[
      AGENT_ACT_KIND.AGENTS_WORKSPACE_TOOLS_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: (agent: AgentPullRequestParams) => agent.agentId,
          follow: host.agentWorkspaceToolsFollow,
          unfollow: host.agentWorkspaceToolsUnfollow,
        },
        openTools,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(hold));
    }),
    [AGENT_ACT_KIND.AGENTS_WORKSPACE_TOOLS_RETRY]: actPort[
      AGENT_ACT_KIND.AGENTS_WORKSPACE_TOOLS_RETRY
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.agentWorkspaceToolsRetry(input);
    }),
  };
}
