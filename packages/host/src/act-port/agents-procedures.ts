import {
  AGENT_CALL_FAILURE,
  type AgentAddRepositoryParams,
  type AgentAgentAnswer,
  type AgentArchiveParams,
  type AgentChangesAnswerView,
  type AgentChooseParams,
  type AgentDefaultAnswer,
  type AgentDeleteAnswerView,
  type AgentGitHubImageParams,
  type AgentGitHubImageView,
  type AgentListAnswer,
  type AgentListParams,
  type AgentMarkReadParams,
  type AgentMessageParams,
  type AgentMessagesAnswerView,
  type AgentMessagesParams,
  type AgentPageAnswerView,
  type AgentPageParams,
  type AgentPartParams,
  type AgentPartView,
  type AgentPinParams,
  type AgentPullRequestActionParams,
  type AgentPullRequestParams,
  type AgentPullRequestReadParams,
  type AgentPullRequestWriteAnswerView,
  type AgentQueueAnswerView,
  type AgentQueueParams,
  type AgentRenameParams,
  type AgentRewindParams,
  type AgentServersParams,
  type AgentStartParams,
  type AgentStopParams,
  type AgentTranscriptKey,
  type AgentTranscriptOlderAnswer,
  type AgentTranscriptOlderParams,
  type AgentWorkspaceListParams,
  type HostDoneAnswerView,
  type PullRequestPart,
  type PullRequestPartParams,
  type ThisMacHostSetParams,
} from "@repo/features/agent-view";
import type {
  HostPairingApproveView,
  HostPairingDenyView,
  HostPairingView,
} from "@repo/features/host-pairing-view";
import type { ModelChoice } from "@repo/features/models-wire";
import { Data, Effect, MutableHashMap, Option, Stream } from "effect";
import type { AgentNotices } from "../agent-notices.js";
import { AGENT_ACT_KIND } from "../contract/index.js";
import { type ActSender, actPort } from "./base.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

export interface AgentProceduresDependencies {
  host: {
    agentModelsFollow(): Effect.Effect<void>;
    agentModelsUnfollow(): Effect.Effect<void>;
    agentModelsRetry(): Effect.Effect<void>;
    agentDefaultWrite(choice: ModelChoice): Effect.Effect<AgentDefaultAnswer>;
    agentPreferencesRetry(): Effect.Effect<void>;
    hostsFollow(): Effect.Effect<void>;
    hostsUnfollow(): Effect.Effect<void>;
    hostsRetry(): Effect.Effect<void>;
    hostsPresenceFollow(): Effect.Effect<void>;
    hostsPresenceUnfollow(): Effect.Effect<void>;
    hostsPresenceRefresh(): Effect.Effect<void>;
    hostsRemove(id: string): Effect.Effect<HostDoneAnswerView>;
    hostsThisMacSet(asked: ThisMacHostSetParams): Effect.Effect<HostDoneAnswerView>;
    hostsPairingRead(code: string): Effect.Effect<HostPairingView>;
    hostsPairingApprove(code: string): Effect.Effect<HostPairingApproveView>;
    hostsPairingDeny(code: string): Effect.Effect<HostPairingDenyView>;
    agentList(params: AgentListParams): Effect.Effect<AgentListAnswer>;
    agentWorkspaceList(params: AgentWorkspaceListParams): Effect.Effect<AgentListAnswer>;
    agentStart(params: AgentStartParams): Effect.Effect<AgentAgentAnswer>;
    agentMessages(params: AgentMessagesParams): Effect.Effect<AgentMessagesAnswerView>;
    agentMessage(params: AgentMessageParams): Effect.Effect<AgentAgentAnswer>;
    agentPart(params: AgentPartParams): Effect.Effect<AgentPartView>;
    transcriptFollow(transcript: AgentTranscriptKey): Effect.Effect<void>;
    transcriptUnfollow(transcript: AgentTranscriptKey): Effect.Effect<void>;
    transcriptRetry(transcript: AgentTranscriptKey): Effect.Effect<void>;
    transcriptOlder(params: AgentTranscriptOlderParams): Effect.Effect<AgentTranscriptOlderAnswer>;
    agentChoose(params: AgentChooseParams): Effect.Effect<AgentAgentAnswer>;
    agentRename(params: AgentRenameParams): Effect.Effect<AgentAgentAnswer>;
    agentServers(params: AgentServersParams): Effect.Effect<AgentAgentAnswer>;
    agentAddRepository(params: AgentAddRepositoryParams): Effect.Effect<AgentAgentAnswer>;
    agentQueue(params: AgentQueueParams): Effect.Effect<AgentQueueAnswerView>;
    agentStop(params: AgentStopParams): Effect.Effect<AgentAgentAnswer>;
    agentRewind(params: AgentRewindParams): Effect.Effect<AgentAgentAnswer>;
    agentArchive(params: AgentArchiveParams): Effect.Effect<AgentAgentAnswer>;
    agentPin(params: AgentPinParams): Effect.Effect<AgentAgentAnswer>;
    agentMarkRead(params: AgentMarkReadParams): Effect.Effect<AgentAgentAnswer>;
    agentDelete(params: AgentStopParams): Effect.Effect<AgentDeleteAnswerView>;
    agentPage(params: AgentPageParams): Effect.Effect<AgentPageAnswerView>;
    agentOriginFollow(params: AgentPageParams): Effect.Effect<void>;
    agentOriginUnfollow(params: AgentPageParams): Effect.Effect<void>;
    agentOriginRetry(params: AgentPageParams): Effect.Effect<void>;
    pullRequestPartFollow(params: PullRequestPartParams): Effect.Effect<void>;
    pullRequestPartUnfollow(params: PullRequestPartParams): Effect.Effect<void>;
    pullRequestPartRetry(params: PullRequestPartParams): Effect.Effect<void>;
    agentChanges(params: AgentPullRequestReadParams): Effect.Effect<AgentChangesAnswerView>;
    agentWorkspaceToolsFollow(params: AgentPullRequestParams): Effect.Effect<void>;
    agentWorkspaceToolsUnfollow(params: AgentPullRequestParams): Effect.Effect<void>;
    agentWorkspaceToolsRetry(params: AgentPullRequestParams): Effect.Effect<void>;
    agentGitHubImage(params: AgentGitHubImageParams): Effect.Effect<AgentGitHubImageView>;
    agentPullRequestAction(
      params: AgentPullRequestActionParams,
    ): Effect.Effect<AgentPullRequestWriteAnswerView>;
  };
  notices: Pick<
    AgentNotices,
    "observeAgents" | "observeStatus" | "observeMessaged" | "observeTaskGone" | "shown" | "seen"
  >;
}

function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

function noted<Answer>(
  answer: Effect.Effect<Answer>,
  note: (answer: Answer) => void,
): Effect.Effect<Answer> {
  return Effect.tap(answer, (value) => Effect.sync(() => note(value)));
}

class TranscriptStreamKey extends Data.Class<{
  readonly kind: AgentTranscriptKey["kind"];
  readonly owner: string;
  readonly callId: string | undefined;
}> {}

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
  const { host, notices } = dependencies;
  const openTranscripts: OpenFollows<never, TranscriptStreamKey> = MutableHashMap.empty();
  const openOrigins: OpenFollows<never> = MutableHashMap.empty();
  const openPresence: OpenFollows<never> = MutableHashMap.empty();
  const openModels: OpenFollows<never> = MutableHashMap.empty();
  const openHosts: OpenFollows<never> = MutableHashMap.empty();
  const openTools: OpenFollows<never> = MutableHashMap.empty();
  const openParts: OpenFollows<never, PullRequestPartStreamKey> = MutableHashMap.empty();
  const notedAgent = (answer: Effect.Effect<AgentAgentAnswer>) =>
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
            onChanged: () => () => undefined,
            valueOf: () => Option.none<never>(),
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
    [AGENT_ACT_KIND.AGENTS_DEFAULT_WRITE]: actPort[AGENT_ACT_KIND.AGENTS_DEFAULT_WRITE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.agentDefaultWrite(input);
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
          onChanged: () => () => undefined,
          valueOf: () => Option.none<never>(),
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
            onChanged: () => () => undefined,
            valueOf: () => Option.none<never>(),
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
    [AGENT_ACT_KIND.HOSTS_REMOVE]: actPort[AGENT_ACT_KIND.HOSTS_REMOVE].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.hostsRemove(input.id);
    }),
    [AGENT_ACT_KIND.HOSTS_THIS_MAC_SET]: actPort[AGENT_ACT_KIND.HOSTS_THIS_MAC_SET].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.hostsThisMacSet(input);
      },
    ),
    [AGENT_ACT_KIND.HOSTS_PAIRING_READ]: actPort[AGENT_ACT_KIND.HOSTS_PAIRING_READ].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.hostsPairingRead(input.code);
      },
    ),
    [AGENT_ACT_KIND.HOSTS_PAIRING_APPROVE]: actPort[AGENT_ACT_KIND.HOSTS_PAIRING_APPROVE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.hostsPairingApprove(input.code);
      },
    ),
    [AGENT_ACT_KIND.HOSTS_PAIRING_DENY]: actPort[AGENT_ACT_KIND.HOSTS_PAIRING_DENY].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.hostsPairingDeny(input.code);
      },
    ),
    [AGENT_ACT_KIND.AGENTS_WORKSPACE_LIST]: actPort[AGENT_ACT_KIND.AGENTS_WORKSPACE_LIST].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.agentWorkspaceList(input);
      },
    ),
    [AGENT_ACT_KIND.AGENTS_LIST]: actPort[AGENT_ACT_KIND.AGENTS_LIST].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* noted(host.agentList(input), (answer) => {
        if ("agents" in answer) notices.observeAgents(answer.agents);
        else if (answer.failure === AGENT_CALL_FAILURE.NOT_FOUND) {
          notices.observeTaskGone(input.taskId);
        }
      });
    }),
    [AGENT_ACT_KIND.AGENTS_START]: actPort[AGENT_ACT_KIND.AGENTS_START].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* notedAgent(host.agentStart(input));
    }),
    [AGENT_ACT_KIND.AGENTS_MESSAGES]: actPort[AGENT_ACT_KIND.AGENTS_MESSAGES].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* noted(host.agentMessages(input), (answer) => {
        if ("status" in answer && input.callId === undefined) {
          notices.observeStatus(input.agentId, answer.status);
        }
      });
    }),
    [AGENT_ACT_KIND.AGENTS_PART]: actPort[AGENT_ACT_KIND.AGENTS_PART].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentPart(input);
    }),
    [AGENT_ACT_KIND.AGENTS_TRANSCRIPT]: actPort[AGENT_ACT_KIND.AGENTS_TRANSCRIPT].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const hold = followedStream(
          {
            keyOf: transcriptKeyOf,
            follow: host.transcriptFollow,
            unfollow: host.transcriptUnfollow,
            onChanged: () => () => undefined,
            valueOf: () => Option.none<never>(),
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
    [AGENT_ACT_KIND.AGENTS_TRANSCRIPT_OLDER]: actPort[
      AGENT_ACT_KIND.AGENTS_TRANSCRIPT_OLDER
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.transcriptOlder(input);
    }),
    [AGENT_ACT_KIND.AGENTS_MESSAGE]: actPort[AGENT_ACT_KIND.AGENTS_MESSAGE].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* noted(host.agentMessage(input), (answer) => {
        if ("agent" in answer) notices.observeMessaged(answer.agent);
      });
    }),
    [AGENT_ACT_KIND.AGENTS_CHOOSE]: actPort[AGENT_ACT_KIND.AGENTS_CHOOSE].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* notedAgent(host.agentChoose(input));
    }),
    [AGENT_ACT_KIND.AGENTS_RENAME]: actPort[AGENT_ACT_KIND.AGENTS_RENAME].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* notedAgent(host.agentRename(input));
    }),
    [AGENT_ACT_KIND.AGENTS_SERVERS]: actPort[AGENT_ACT_KIND.AGENTS_SERVERS].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* notedAgent(host.agentServers(input));
    }),
    [AGENT_ACT_KIND.AGENTS_ADD_REPOSITORY]: actPort[AGENT_ACT_KIND.AGENTS_ADD_REPOSITORY].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* notedAgent(host.agentAddRepository(input));
      },
    ),
    [AGENT_ACT_KIND.AGENTS_QUEUE]: actPort[AGENT_ACT_KIND.AGENTS_QUEUE].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentQueue(input);
    }),
    [AGENT_ACT_KIND.AGENTS_STOP]: actPort[AGENT_ACT_KIND.AGENTS_STOP].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* notedAgent(host.agentStop(input));
    }),
    [AGENT_ACT_KIND.AGENTS_REWIND]: actPort[AGENT_ACT_KIND.AGENTS_REWIND].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* notedAgent(host.agentRewind(input));
    }),
    [AGENT_ACT_KIND.AGENTS_ARCHIVE]: actPort[AGENT_ACT_KIND.AGENTS_ARCHIVE].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* notedAgent(host.agentArchive(input));
    }),
    [AGENT_ACT_KIND.AGENTS_PIN]: actPort[AGENT_ACT_KIND.AGENTS_PIN].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* notedAgent(host.agentPin(input));
    }),
    [AGENT_ACT_KIND.AGENTS_MARK_READ]: actPort[AGENT_ACT_KIND.AGENTS_MARK_READ].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* notedAgent(host.agentMarkRead(input));
    }),
    [AGENT_ACT_KIND.AGENTS_DELETE]: actPort[AGENT_ACT_KIND.AGENTS_DELETE].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentDelete(input);
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
    [AGENT_ACT_KIND.AGENTS_PAGE]: actPort[AGENT_ACT_KIND.AGENTS_PAGE].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentPage(input);
    }),
    [AGENT_ACT_KIND.AGENTS_ORIGIN_FOLLOW]: actPort[AGENT_ACT_KIND.AGENTS_ORIGIN_FOLLOW].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const hold = followedStream(
          {
            keyOf: (params: AgentPageParams) => params.agentId,
            follow: host.agentOriginFollow,
            unfollow: host.agentOriginUnfollow,
            onChanged: () => () => undefined,
            valueOf: () => Option.none<never>(),
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
    [AGENT_ACT_KIND.AGENTS_CHANGES]: actPort[AGENT_ACT_KIND.AGENTS_CHANGES].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentChanges(input);
    }),
    [AGENT_ACT_KIND.AGENTS_PULL_REQUEST_PART_FOLLOW]: actPort[
      AGENT_ACT_KIND.AGENTS_PULL_REQUEST_PART_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: pullRequestPartKeyOf,
          follow: host.pullRequestPartFollow,
          unfollow: host.pullRequestPartUnfollow,
          onChanged: () => () => undefined,
          valueOf: () => Option.none<never>(),
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
          onChanged: () => () => undefined,
          valueOf: () => Option.none<never>(),
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
    [AGENT_ACT_KIND.AGENTS_GITHUB_IMAGE]: actPort[AGENT_ACT_KIND.AGENTS_GITHUB_IMAGE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.agentGitHubImage(input);
      },
    ),
    [AGENT_ACT_KIND.AGENTS_PULL_REQUEST_ACTION]: actPort[
      AGENT_ACT_KIND.AGENTS_PULL_REQUEST_ACTION
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentPullRequestAction(input);
    }),
  };
}
