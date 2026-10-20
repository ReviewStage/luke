/**
 * agents-procedures.ts -- the Tasks tab's asks of the host about a task's coding agents and what they published.
 *
 * The one check these procedures make is who asked, as for every task act:
 * only a panel draws a task's agents, so every one refuses the takeover and
 * the hidden voice window, in its own sentence. What the service answers
 * comes back as the panel's own answer; on its way it is noted by the
 * notices (`@luke/host/agent-notices`), which hold where each agent stands
 * so an end the panel is not looking at is still announced, and which
 * agent's tab, task's Inbox, and Chat the panel shows, so an item it is
 * looking at is not; and an agent's own pull request, read, is noted as
 * what it published. Nothing else is held here.
 */

import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
  type CodingAgentArchiveParams,
  type CodingAgentChangesAnswerView,
  type CodingAgentChooseParams,
  type CodingAgentDefaultAnswer,
  type CodingAgentGitHubImageParams,
  type CodingAgentGitHubImageView,
  type CodingAgentListAnswer,
  type CodingAgentListParams,
  type CodingAgentMessageParams,
  type CodingAgentMessagesAnswerView,
  type CodingAgentMessagesParams,
  type CodingAgentModelsAnswer,
  type CodingAgentOverviewChecksAnswerView,
  type CodingAgentOverviewConversationAnswerView,
  type CodingAgentOverviewPullRequestAnswerView,
  type CodingAgentPageAnswerView,
  type CodingAgentPageParams,
  type CodingAgentPinParams,
  type CodingAgentPullRequestActionParams,
  type CodingAgentPullRequestAnswerView,
  type CodingAgentPullRequestParams,
  type CodingAgentPullRequestReadParams,
  type CodingAgentPullRequestViewedAnswerView,
  type CodingAgentPullRequestWriteAnswerView,
  type CodingAgentRenameParams,
  type CodingAgentReviewOptionsAnswerView,
  type CodingAgentServersParams,
  type CodingAgentStartParams,
  type CodingAgentStopParams,
  type CodingAgentWorkspaceListParams,
} from "@luke/features/coding-agent-view";
import type { ModelChoice } from "@luke/features/models-wire";
import { Effect } from "effect";
import type { AgentNotices } from "../agent-notices.js";
import { AGENT_ACT_KIND } from "../contract/index.js";
import { type ActSender, actPort } from "./base.js";

/** What the agent procedures reach: the host's asks of the service, and the notices. */
export interface AgentProceduresDependencies {
  host: {
    codingAgentModels(): Effect.Effect<CodingAgentModelsAnswer>;
    codingAgentDefaultRead(): Effect.Effect<CodingAgentDefaultAnswer>;
    codingAgentDefaultWrite(choice: ModelChoice): Effect.Effect<CodingAgentDefaultAnswer>;
    codingAgentList(params: CodingAgentListParams): Effect.Effect<CodingAgentListAnswer>;
    codingAgentWorkspaceList(
      params: CodingAgentWorkspaceListParams,
    ): Effect.Effect<CodingAgentListAnswer>;
    codingAgentStart(params: CodingAgentStartParams): Effect.Effect<CodingAgentAgentAnswer>;
    codingAgentMessages(
      params: CodingAgentMessagesParams,
    ): Effect.Effect<CodingAgentMessagesAnswerView>;
    codingAgentMessage(params: CodingAgentMessageParams): Effect.Effect<CodingAgentAgentAnswer>;
    codingAgentChoose(params: CodingAgentChooseParams): Effect.Effect<CodingAgentAgentAnswer>;
    codingAgentRename(params: CodingAgentRenameParams): Effect.Effect<CodingAgentAgentAnswer>;
    codingAgentServers(params: CodingAgentServersParams): Effect.Effect<CodingAgentAgentAnswer>;
    codingAgentStop(params: CodingAgentStopParams): Effect.Effect<CodingAgentAgentAnswer>;
    codingAgentArchive(params: CodingAgentArchiveParams): Effect.Effect<CodingAgentAgentAnswer>;
    codingAgentPin(params: CodingAgentPinParams): Effect.Effect<CodingAgentAgentAnswer>;
    /** The plan list read again, which carries every agent with no plan beside the plans. */
    tasksRefresh(): Effect.Effect<void>;
    codingAgentPage(params: CodingAgentPageParams): Effect.Effect<CodingAgentPageAnswerView>;
    codingAgentPullRequest(
      params: CodingAgentPullRequestReadParams,
    ): Effect.Effect<CodingAgentPullRequestAnswerView>;
    codingAgentChanges(
      params: CodingAgentPullRequestReadParams,
    ): Effect.Effect<CodingAgentChangesAnswerView>;
    codingAgentOverviewPullRequest(
      params: CodingAgentPullRequestReadParams,
    ): Effect.Effect<CodingAgentOverviewPullRequestAnswerView>;
    codingAgentReviewOptions(
      params: CodingAgentPullRequestParams,
    ): Effect.Effect<CodingAgentReviewOptionsAnswerView>;
    codingAgentOverviewChecks(
      params: CodingAgentPullRequestReadParams,
    ): Effect.Effect<CodingAgentOverviewChecksAnswerView>;
    codingAgentOverviewConversation(
      params: CodingAgentPullRequestReadParams,
    ): Effect.Effect<CodingAgentOverviewConversationAnswerView>;
    codingAgentGitHubImage(
      params: CodingAgentGitHubImageParams,
    ): Effect.Effect<CodingAgentGitHubImageView>;
    codingAgentPullRequestAction(
      params: CodingAgentPullRequestActionParams,
    ): Effect.Effect<CodingAgentPullRequestWriteAnswerView>;
    codingAgentPullRequestViewed(
      params: CodingAgentPullRequestReadParams,
    ): Effect.Effect<CodingAgentPullRequestViewedAnswerView>;
  };
  /** Where every answer's agents and what an agent published are noted, and which agent's tab the panel shows. */
  notices: Pick<
    AgentNotices,
    | "observeAgents"
    | "observeStatus"
    | "observeTitle"
    | "observeMessaged"
    | "observeModels"
    | "observePublished"
    | "observeTaskGone"
    | "shown"
    | "shownInbox"
    | "shownChat"
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

export function agentProcedures(dependencies: AgentProceduresDependencies) {
  const { host, notices } = dependencies;
  // Note that an agent with no plan is listed by the plan list, which is read again so its row says what the act changed.
  const notedAgent = (answer: Effect.Effect<CodingAgentAgentAnswer>) =>
    Effect.tap(
      noted(answer, (value) => {
        if ("agent" in value) notices.observeAgents([value.agent]);
      }),
      (value) =>
        "agent" in value && value.agent.planId === null ? host.tasksRefresh() : Effect.void,
    );
  return {
    [AGENT_ACT_KIND.CODING_AGENTS_MODELS]: actPort[AGENT_ACT_KIND.CODING_AGENTS_MODELS].effect(
      function* ({ context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* noted(host.codingAgentModels(), (answer) => {
          if ("models" in answer) notices.observeModels(answer.models);
        });
      },
    ),
    [AGENT_ACT_KIND.CODING_AGENTS_DEFAULT_READ]: actPort[
      AGENT_ACT_KIND.CODING_AGENTS_DEFAULT_READ
    ].effect(function* ({ context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentDefaultRead();
    }),
    [AGENT_ACT_KIND.CODING_AGENTS_DEFAULT_WRITE]: actPort[
      AGENT_ACT_KIND.CODING_AGENTS_DEFAULT_WRITE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentDefaultWrite(input);
    }),
    [AGENT_ACT_KIND.CODING_AGENTS_WORKSPACE_LIST]: actPort[
      AGENT_ACT_KIND.CODING_AGENTS_WORKSPACE_LIST
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentWorkspaceList(input);
    }),
    [AGENT_ACT_KIND.CODING_AGENTS_LIST]: actPort[AGENT_ACT_KIND.CODING_AGENTS_LIST].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* noted(host.codingAgentList(input), (answer) => {
          if ("agents" in answer) notices.observeAgents(answer.agents);
          else if (answer.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND) {
            notices.observeTaskGone(input.taskId);
          }
        });
      },
    ),
    [AGENT_ACT_KIND.CODING_AGENTS_START]: actPort[AGENT_ACT_KIND.CODING_AGENTS_START].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* notedAgent(host.codingAgentStart(input));
      },
    ),
    [AGENT_ACT_KIND.CODING_AGENTS_MESSAGES]: actPort[AGENT_ACT_KIND.CODING_AGENTS_MESSAGES].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        // A worker's page says where the worker stands and what it is called, which is no word on the agent.
        return yield* noted(host.codingAgentMessages(input), (answer) => {
          if ("status" in answer && input.callId === undefined) {
            // The title first, so an end this page carries is announced under it.
            notices.observeTitle(input.agentId, answer.title);
            notices.observeStatus(input.agentId, answer.status);
          }
        });
      },
    ),
    [AGENT_ACT_KIND.CODING_AGENTS_MESSAGE]: actPort[AGENT_ACT_KIND.CODING_AGENTS_MESSAGE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* noted(host.codingAgentMessage(input), (answer) => {
          if ("agent" in answer) notices.observeMessaged(answer.agent);
        });
      },
    ),
    [AGENT_ACT_KIND.CODING_AGENTS_CHOOSE]: actPort[AGENT_ACT_KIND.CODING_AGENTS_CHOOSE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* notedAgent(host.codingAgentChoose(input));
      },
    ),
    [AGENT_ACT_KIND.CODING_AGENTS_RENAME]: actPort[AGENT_ACT_KIND.CODING_AGENTS_RENAME].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* notedAgent(host.codingAgentRename(input));
      },
    ),
    [AGENT_ACT_KIND.CODING_AGENTS_SERVERS]: actPort[AGENT_ACT_KIND.CODING_AGENTS_SERVERS].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* notedAgent(host.codingAgentServers(input));
      },
    ),
    [AGENT_ACT_KIND.CODING_AGENTS_STOP]: actPort[AGENT_ACT_KIND.CODING_AGENTS_STOP].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* notedAgent(host.codingAgentStop(input));
      },
    ),
    [AGENT_ACT_KIND.CODING_AGENTS_ARCHIVE]: actPort[AGENT_ACT_KIND.CODING_AGENTS_ARCHIVE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* notedAgent(host.codingAgentArchive(input));
      },
    ),
    [AGENT_ACT_KIND.CODING_AGENTS_PIN]: actPort[AGENT_ACT_KIND.CODING_AGENTS_PIN].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* notedAgent(host.codingAgentPin(input));
      },
    ),
    [AGENT_ACT_KIND.CODING_AGENTS_SHOWN]: actPort[AGENT_ACT_KIND.CODING_AGENTS_SHOWN].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        notices.shown(input.agentId);
        notices.shownInbox(input.inboxTaskId);
        notices.shownChat(input.chatShown ?? null);
      },
    ),
    [AGENT_ACT_KIND.CODING_AGENTS_PAGE]: actPort[AGENT_ACT_KIND.CODING_AGENTS_PAGE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.codingAgentPage(input);
      },
    ),
    [AGENT_ACT_KIND.CODING_AGENTS_PULL_REQUEST]: actPort[
      AGENT_ACT_KIND.CODING_AGENTS_PULL_REQUEST
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      // Note that a read of another pull request by its number is no word on what the agent itself published.
      return yield* noted(host.codingAgentPullRequest(input), (answer) => {
        if ("pullRequest" in answer && input.number === undefined) {
          notices.observePublished(input.agentId, answer.pullRequest);
        }
      });
    }),
    [AGENT_ACT_KIND.CODING_AGENTS_CHANGES]: actPort[AGENT_ACT_KIND.CODING_AGENTS_CHANGES].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.codingAgentChanges(input);
      },
    ),
    [AGENT_ACT_KIND.CODING_AGENTS_OVERVIEW_PULL_REQUEST]: actPort[
      AGENT_ACT_KIND.CODING_AGENTS_OVERVIEW_PULL_REQUEST
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentOverviewPullRequest(input);
    }),
    [AGENT_ACT_KIND.CODING_AGENTS_REVIEW_OPTIONS]: actPort[
      AGENT_ACT_KIND.CODING_AGENTS_REVIEW_OPTIONS
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentReviewOptions(input);
    }),
    [AGENT_ACT_KIND.CODING_AGENTS_OVERVIEW_CHECKS]: actPort[
      AGENT_ACT_KIND.CODING_AGENTS_OVERVIEW_CHECKS
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentOverviewChecks(input);
    }),
    [AGENT_ACT_KIND.CODING_AGENTS_OVERVIEW_CONVERSATION]: actPort[
      AGENT_ACT_KIND.CODING_AGENTS_OVERVIEW_CONVERSATION
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentOverviewConversation(input);
    }),
    // Note that the image's answer, a failure among them, is the panel's to read, as an agent's picture's is.
    [AGENT_ACT_KIND.CODING_AGENTS_GITHUB_IMAGE]: actPort[
      AGENT_ACT_KIND.CODING_AGENTS_GITHUB_IMAGE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentGitHubImage(input);
    }),
    [AGENT_ACT_KIND.CODING_AGENTS_PULL_REQUEST_ACTION]: actPort[
      AGENT_ACT_KIND.CODING_AGENTS_PULL_REQUEST_ACTION
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentPullRequestAction(input);
    }),
    [AGENT_ACT_KIND.CODING_AGENTS_PULL_REQUEST_VIEWED]: actPort[
      AGENT_ACT_KIND.CODING_AGENTS_PULL_REQUEST_VIEWED
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.codingAgentPullRequestViewed(input);
    }),
  };
}
