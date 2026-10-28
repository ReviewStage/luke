/**
 * agents-procedures.ts -- the Tasks tab's asks of the host about a task's coding agents and what they published.
 *
 * The one check these procedures make is who asked, as for every task act:
 * only a panel draws a task's agents, so every one refuses the takeover and
 * any other window, in its own sentence. What the service answers
 * comes back as the panel's own answer; on its way it is noted by the
 * notices (`@luke/host/agent-notices`), which hold where each agent stands
 * so an end the panel is not looking at is still announced, and which
 * agent's tab and task's Inbox the panel shows, so an item it is
 * looking at is not; and an agent's own pull request, read, is noted as
 * what it published. Nothing else is held here.
 */

import {
  AGENT_CALL_FAILURE,
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
  type AgentMessageParams,
  type AgentMessagesAnswerView,
  type AgentMessagesParams,
  type AgentModelsAnswer,
  type AgentOperatorEnsureAnswerView,
  type AgentOperatorEnsureParams,
  type AgentOverviewChecksAnswerView,
  type AgentOverviewConversationAnswerView,
  type AgentOverviewPullRequestAnswerView,
  type AgentPageAnswerView,
  type AgentPageParams,
  type AgentPartParams,
  type AgentPartView,
  type AgentPinParams,
  type AgentPullRequestActionParams,
  type AgentPullRequestAnswerView,
  type AgentPullRequestParams,
  type AgentPullRequestReadParams,
  type AgentPullRequestViewedAnswerView,
  type AgentPullRequestWriteAnswerView,
  type AgentRenameParams,
  type AgentReviewOptionsAnswerView,
  type AgentRewindParams,
  type AgentServersParams,
  type AgentStartParams,
  type AgentStopParams,
  type AgentTranscriptChanged,
  type AgentTranscriptKey,
  type AgentTranscriptOlderAnswer,
  type AgentTranscriptOlderParams,
  type AgentTranscriptPage,
  type AgentWorkspaceListParams,
  type DevicePresenceAnswerView,
  type HostDoneAnswerView,
  type HostInstallTokenAnswerView,
  type HostsAnswerView,
  TRANSCRIPT_KIND,
} from "@luke/features/agent-view";
import type { ModelChoice } from "@luke/features/models-wire";
import { Data, Effect, Equal, MutableHashMap, Option, Queue, Stream } from "effect";
import type { AgentNotices } from "../agent-notices.js";
import { AGENT_ACT_KIND } from "../contract/index.js";
import { type ActSender, actPort } from "./base.js";
import { streamed } from "./followed-stream.js";

/** What the agent procedures reach: the host's asks of the service, and the notices. */
export interface AgentProceduresDependencies {
  host: {
    agentModels(): Effect.Effect<AgentModelsAnswer>;
    agentDefaultRead(): Effect.Effect<AgentDefaultAnswer>;
    agentDefaultWrite(choice: ModelChoice): Effect.Effect<AgentDefaultAnswer>;
    hostsList(): Effect.Effect<HostsAnswerView>;
    hostsPresence(): Effect.Effect<DevicePresenceAnswerView>;
    hostsRemove(id: string): Effect.Effect<HostDoneAnswerView>;
    hostsKeepInstallToken(tokenHash: string): Effect.Effect<HostInstallTokenAnswerView>;
    hostsRevokeInstallToken(id: string): Effect.Effect<HostDoneAnswerView>;
    agentList(params: AgentListParams): Effect.Effect<AgentListAnswer>;
    agentWorkspaceList(params: AgentWorkspaceListParams): Effect.Effect<AgentListAnswer>;
    agentStart(params: AgentStartParams): Effect.Effect<AgentAgentAnswer>;
    agentMessages(params: AgentMessagesParams): Effect.Effect<AgentMessagesAnswerView>;
    agentMessage(params: AgentMessageParams): Effect.Effect<AgentAgentAnswer>;
    agentPart(params: AgentPartParams): Effect.Effect<AgentPartView>;
    /** A transcript followed at the host from its start, its pages heard through `onTranscriptChanged`; following again starts over. */
    transcriptFollow(transcript: AgentTranscriptKey): Effect.Effect<void>;
    transcriptUnfollow(transcript: AgentTranscriptKey): Effect.Effect<void>;
    /** The page of a transcript below the oldest message the window holds, read at once. */
    transcriptOlder(params: AgentTranscriptOlderParams): Effect.Effect<AgentTranscriptOlderAnswer>;
    onTranscriptChanged(listener: (changed: AgentTranscriptChanged) => void): () => void;
    agentChoose(params: AgentChooseParams): Effect.Effect<AgentAgentAnswer>;
    agentRename(params: AgentRenameParams): Effect.Effect<AgentAgentAnswer>;
    agentServers(params: AgentServersParams): Effect.Effect<AgentAgentAnswer>;
    agentStop(params: AgentStopParams): Effect.Effect<AgentAgentAnswer>;
    agentRewind(params: AgentRewindParams): Effect.Effect<AgentAgentAnswer>;
    agentArchive(params: AgentArchiveParams): Effect.Effect<AgentAgentAnswer>;
    agentPin(params: AgentPinParams): Effect.Effect<AgentAgentAnswer>;
    agentEnsureOperator(
      params: AgentOperatorEnsureParams,
    ): Effect.Effect<AgentOperatorEnsureAnswerView>;
    agentDelete(params: AgentStopParams): Effect.Effect<AgentDeleteAnswerView>;
    /** The plan list read again, which carries every agent with no plan beside the plans. */
    tasksRefresh(): Effect.Effect<void>;
    agentPage(params: AgentPageParams): Effect.Effect<AgentPageAnswerView>;
    agentPullRequest(
      params: AgentPullRequestReadParams,
    ): Effect.Effect<AgentPullRequestAnswerView>;
    agentChanges(params: AgentPullRequestReadParams): Effect.Effect<AgentChangesAnswerView>;
    agentOverviewPullRequest(
      params: AgentPullRequestReadParams,
    ): Effect.Effect<AgentOverviewPullRequestAnswerView>;
    agentReviewOptions(
      params: AgentPullRequestParams,
    ): Effect.Effect<AgentReviewOptionsAnswerView>;
    agentOverviewChecks(
      params: AgentPullRequestReadParams,
    ): Effect.Effect<AgentOverviewChecksAnswerView>;
    agentOverviewConversation(
      params: AgentPullRequestReadParams,
    ): Effect.Effect<AgentOverviewConversationAnswerView>;
    agentGitHubImage(params: AgentGitHubImageParams): Effect.Effect<AgentGitHubImageView>;
    agentPullRequestAction(
      params: AgentPullRequestActionParams,
    ): Effect.Effect<AgentPullRequestWriteAnswerView>;
    agentPullRequestViewed(
      params: AgentPullRequestReadParams,
    ): Effect.Effect<AgentPullRequestViewedAnswerView>;
  };
  /** Where every answer's agents and what an agent published are noted, and which agent's tab the panel shows. */
  notices: Pick<
    AgentNotices,
    "observeAgents" | "observeStatus" | "observeMessaged" | "observeTaskGone" | "shown" | "seen"
  >;
}

/** The refusal a window that draws no Tasks tab hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

/** The answer as it stands, noted on its way to the panel. */
function noted<Answer>(
  answer: Effect.Effect<Answer>,
  note: (answer: Answer) => void,
): Effect.Effect<Answer> {
  return Effect.tap(answer, (value) => Effect.sync(() => note(value)));
}

/** A transcript as a key that equals another naming the same one. */
class TranscriptStreamKey extends Data.Class<{
  readonly kind: AgentTranscriptKey["kind"];
  readonly owner: string;
  readonly callId: string | undefined;
}> {}

function transcriptKeyOf(transcript: AgentTranscriptKey): TranscriptStreamKey {
  return new TranscriptStreamKey({
    kind: transcript.kind,
    owner: transcript.agentId,
    callId: transcript.callId,
  });
}

/**
 * A transcript's pages for one stream a window holds open: the host follows
 * it from its start as the stream opens, so the window hears it whole, and
 * lets it go once the last stream of it closes. Every page the host tells of
 * it reaches every stream of it, which joins a page heard again by id.
 */
function transcriptPages(
  host: AgentProceduresDependencies["host"],
  open: MutableHashMap.MutableHashMap<TranscriptStreamKey, number>,
  transcript: AgentTranscriptKey,
): Stream.Stream<AgentTranscriptPage> {
  const key = transcriptKeyOf(transcript);
  return Stream.callback<AgentTranscriptPage>((queue) =>
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          host.onTranscriptChanged((changed) => {
            if (Equal.equals(transcriptKeyOf(changed.transcript), key)) {
              Queue.offerUnsafe(queue, changed.page);
            }
          }),
        ),
        (stop) => Effect.sync(stop),
      );
      yield* Effect.acquireRelease(
        Effect.andThen(
          Effect.sync(() =>
            MutableHashMap.set(
              open,
              key,
              Option.getOrElse(MutableHashMap.get(open, key), () => 0) + 1,
            ),
          ),
          host.transcriptFollow(transcript),
        ),
        () =>
          Effect.suspend(() => {
            const left = Option.getOrElse(MutableHashMap.get(open, key), () => 1) - 1;
            if (left > 0) {
              MutableHashMap.set(open, key, left);
              return Effect.void;
            }
            MutableHashMap.remove(open, key);
            return host.transcriptUnfollow(transcript);
          }),
      );
    }),
  );
}

export function agentProcedures(dependencies: AgentProceduresDependencies) {
  const { host, notices } = dependencies;
  /** How many streams stand open of each transcript, so the host lets one go only with the last. */
  const openTranscripts = MutableHashMap.empty<TranscriptStreamKey, number>();
  // Note that an agent with no plan is listed by the plan list, which is read again so its row says what the act changed.
  const notedAgent = (answer: Effect.Effect<AgentAgentAnswer>) =>
    Effect.tap(
      noted(answer, (value) => {
        if ("agent" in value) notices.observeAgents([value.agent]);
      }),
      (value) =>
        "agent" in value && value.agent.planId === null ? host.tasksRefresh() : Effect.void,
    );
  return {
    [AGENT_ACT_KIND.AGENTS_MODELS]: actPort[AGENT_ACT_KIND.AGENTS_MODELS].effect(
      function* ({ context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.agentModels();
      },
    ),
    [AGENT_ACT_KIND.AGENTS_DEFAULT_READ]: actPort[
      AGENT_ACT_KIND.AGENTS_DEFAULT_READ
    ].effect(function* ({ context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentDefaultRead();
    }),
    [AGENT_ACT_KIND.AGENTS_DEFAULT_WRITE]: actPort[
      AGENT_ACT_KIND.AGENTS_DEFAULT_WRITE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentDefaultWrite(input);
    }),
    [AGENT_ACT_KIND.HOSTS_LIST]: actPort[AGENT_ACT_KIND.HOSTS_LIST].effect(function* ({
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.hostsList();
    }),
    [AGENT_ACT_KIND.HOSTS_PRESENCE]: actPort[AGENT_ACT_KIND.HOSTS_PRESENCE].effect(function* ({
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.hostsPresence();
    }),
    [AGENT_ACT_KIND.HOSTS_REMOVE]: actPort[AGENT_ACT_KIND.HOSTS_REMOVE].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.hostsRemove(input.id);
    }),
    [AGENT_ACT_KIND.HOSTS_KEEP_INSTALL_TOKEN]: actPort[
      AGENT_ACT_KIND.HOSTS_KEEP_INSTALL_TOKEN
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.hostsKeepInstallToken(input.tokenHash);
    }),
    [AGENT_ACT_KIND.HOSTS_REVOKE_INSTALL_TOKEN]: actPort[
      AGENT_ACT_KIND.HOSTS_REVOKE_INSTALL_TOKEN
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.hostsRevokeInstallToken(input.id);
    }),
    [AGENT_ACT_KIND.AGENTS_WORKSPACE_LIST]: actPort[
      AGENT_ACT_KIND.AGENTS_WORKSPACE_LIST
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentWorkspaceList(input);
    }),
    [AGENT_ACT_KIND.AGENTS_LIST]: actPort[AGENT_ACT_KIND.AGENTS_LIST].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* noted(host.agentList(input), (answer) => {
          if ("agents" in answer) notices.observeAgents(answer.agents);
          else if (answer.failure === AGENT_CALL_FAILURE.NOT_FOUND) {
            notices.observeTaskGone(input.taskId);
          }
        });
      },
    ),
    [AGENT_ACT_KIND.AGENTS_START]: actPort[AGENT_ACT_KIND.AGENTS_START].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* notedAgent(host.agentStart(input));
      },
    ),
    [AGENT_ACT_KIND.AGENTS_MESSAGES]: actPort[AGENT_ACT_KIND.AGENTS_MESSAGES].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        // A worker's page says where the worker stands and what it is called, which is no word on the agent.
        return yield* noted(host.agentMessages(input), (answer) => {
          if ("status" in answer && input.callId === undefined) {
            notices.observeStatus(input.agentId, answer.status);
          }
        });
      },
    ),
    [AGENT_ACT_KIND.AGENTS_PART]: actPort[AGENT_ACT_KIND.AGENTS_PART].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.agentPart(input);
      },
    ),
    [AGENT_ACT_KIND.AGENTS_TRANSCRIPT]: actPort[
      AGENT_ACT_KIND.AGENTS_TRANSCRIPT
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const pages = transcriptPages(host, openTranscripts, input).pipe(
        Stream.tap((page) =>
          Effect.sync(() => {
            // A worker's page says where the worker stands, which is no word on the agent.
            if (!("status" in page)) return;
            if (input.kind !== TRANSCRIPT_KIND.AGENT || input.callId !== undefined) return;
            notices.observeStatus(input.agentId, page.status);
          }),
        ),
      );
      return streamed(yield* Stream.toAsyncIterableEffect(pages));
    }),
    [AGENT_ACT_KIND.AGENTS_TRANSCRIPT_OLDER]: actPort[
      AGENT_ACT_KIND.AGENTS_TRANSCRIPT_OLDER
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.transcriptOlder(input);
    }),
    [AGENT_ACT_KIND.AGENTS_MESSAGE]: actPort[AGENT_ACT_KIND.AGENTS_MESSAGE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* noted(host.agentMessage(input), (answer) => {
          if ("agent" in answer) notices.observeMessaged(answer.agent);
        });
      },
    ),
    [AGENT_ACT_KIND.AGENTS_CHOOSE]: actPort[AGENT_ACT_KIND.AGENTS_CHOOSE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* notedAgent(host.agentChoose(input));
      },
    ),
    [AGENT_ACT_KIND.AGENTS_RENAME]: actPort[AGENT_ACT_KIND.AGENTS_RENAME].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* notedAgent(host.agentRename(input));
      },
    ),
    [AGENT_ACT_KIND.AGENTS_SERVERS]: actPort[AGENT_ACT_KIND.AGENTS_SERVERS].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* notedAgent(host.agentServers(input));
      },
    ),
    [AGENT_ACT_KIND.AGENTS_STOP]: actPort[AGENT_ACT_KIND.AGENTS_STOP].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* notedAgent(host.agentStop(input));
      },
    ),
    [AGENT_ACT_KIND.AGENTS_REWIND]: actPort[AGENT_ACT_KIND.AGENTS_REWIND].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* notedAgent(host.agentRewind(input));
      },
    ),
    [AGENT_ACT_KIND.AGENTS_ARCHIVE]: actPort[AGENT_ACT_KIND.AGENTS_ARCHIVE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* notedAgent(host.agentArchive(input));
      },
    ),
    [AGENT_ACT_KIND.AGENTS_PIN]: actPort[AGENT_ACT_KIND.AGENTS_PIN].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* notedAgent(host.agentPin(input));
      },
    ),
    [AGENT_ACT_KIND.AGENTS_ENSURE_OPERATOR]: actPort[
      AGENT_ACT_KIND.AGENTS_ENSURE_OPERATOR
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      // Note that an ensure that wrote a row made the operator, or a fresh one in a reset's place, so the plan list, which carries it, is read again.
      return yield* Effect.tap(host.agentEnsureOperator(input), (answer) =>
        "txid" in answer ? host.tasksRefresh() : Effect.void,
      );
    }),
    [AGENT_ACT_KIND.AGENTS_DELETE]: actPort[AGENT_ACT_KIND.AGENTS_DELETE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        // Note that the plan list is read again, which carries every agent with no plan, so the sidebar's row goes.
        return yield* Effect.tap(host.agentDelete(input), (answer) =>
          "deleted" in answer ? host.tasksRefresh() : Effect.void,
        );
      },
    ),
    [AGENT_ACT_KIND.AGENTS_SHOWN]: actPort[AGENT_ACT_KIND.AGENTS_SHOWN].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        notices.shown(input.agentId);
      },
    ),
    [AGENT_ACT_KIND.AGENTS_SEEN]: actPort[AGENT_ACT_KIND.AGENTS_SEEN].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        notices.seen(input.agentId);
      },
    ),
    [AGENT_ACT_KIND.AGENTS_PAGE]: actPort[AGENT_ACT_KIND.AGENTS_PAGE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.agentPage(input);
      },
    ),
    [AGENT_ACT_KIND.AGENTS_PULL_REQUEST]: actPort[
      AGENT_ACT_KIND.AGENTS_PULL_REQUEST
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentPullRequest(input);
    }),
    [AGENT_ACT_KIND.AGENTS_CHANGES]: actPort[AGENT_ACT_KIND.AGENTS_CHANGES].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.agentChanges(input);
      },
    ),
    [AGENT_ACT_KIND.AGENTS_OVERVIEW_PULL_REQUEST]: actPort[
      AGENT_ACT_KIND.AGENTS_OVERVIEW_PULL_REQUEST
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentOverviewPullRequest(input);
    }),
    [AGENT_ACT_KIND.AGENTS_REVIEW_OPTIONS]: actPort[
      AGENT_ACT_KIND.AGENTS_REVIEW_OPTIONS
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentReviewOptions(input);
    }),
    [AGENT_ACT_KIND.AGENTS_OVERVIEW_CHECKS]: actPort[
      AGENT_ACT_KIND.AGENTS_OVERVIEW_CHECKS
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentOverviewChecks(input);
    }),
    [AGENT_ACT_KIND.AGENTS_OVERVIEW_CONVERSATION]: actPort[
      AGENT_ACT_KIND.AGENTS_OVERVIEW_CONVERSATION
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentOverviewConversation(input);
    }),
    // Note that the image's answer, a failure among them, is the panel's to read, as an agent's picture's is.
    [AGENT_ACT_KIND.AGENTS_GITHUB_IMAGE]: actPort[
      AGENT_ACT_KIND.AGENTS_GITHUB_IMAGE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentGitHubImage(input);
    }),
    [AGENT_ACT_KIND.AGENTS_PULL_REQUEST_ACTION]: actPort[
      AGENT_ACT_KIND.AGENTS_PULL_REQUEST_ACTION
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentPullRequestAction(input);
    }),
    [AGENT_ACT_KIND.AGENTS_PULL_REQUEST_VIEWED]: actPort[
      AGENT_ACT_KIND.AGENTS_PULL_REQUEST_VIEWED
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.agentPullRequestViewed(input);
    }),
  };
}
