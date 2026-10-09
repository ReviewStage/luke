import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
  type CodingAgentDefaultAnswer,
  type CodingAgentListAnswer,
  type CodingAgentListParams,
  type CodingAgentMessagesAnswerView,
  type CodingAgentMessagesParams,
  type CodingAgentModelsAnswer,
  type CodingAgentPullRequestAnswerView,
  type CodingAgentPullRequestParams,
  type CodingAgentStartParams,
  type CodingAgentStopParams,
} from "@sidecar/hosted/coding-agent-view";
import type { ModelChoice } from "@sidecar/hosted/models-wire";
import { Effect } from "effect";
import { ACT, ACT_KIND } from "#shared/messages/acts";
import { ActRefused, type ActRows, type ActSender } from "../act-router";
import type { AgentNotices } from "../agent-notices";

/**
 * coding-agent-acts.ts -- the Plans tab's coding-agent acts: the panel's asks of the host about a plan's agents.
 *
 * The one check this process makes is who asked, as for every planning act:
 * only a panel draws a plan's agents, so every row refuses the takeover and
 * the hidden voice window. What the service answers comes back as the
 * panel's own answer; on its way it is noted by the notices
 * (`main/agent-notices.ts`), which hold where each agent stands so an end
 * the panel is not looking at is still announced. Nothing else is held here.
 */
export interface CodingAgentActsDependencies {
  host: {
    codingAgentModels(): Effect.Effect<CodingAgentModelsAnswer>;
    codingAgentDefaultRead(): Effect.Effect<CodingAgentDefaultAnswer>;
    codingAgentDefaultWrite(choice: ModelChoice): Effect.Effect<CodingAgentDefaultAnswer>;
    codingAgentList(params: CodingAgentListParams): Effect.Effect<CodingAgentListAnswer>;
    codingAgentStart(params: CodingAgentStartParams): Effect.Effect<CodingAgentAgentAnswer>;
    codingAgentMessages(
      params: CodingAgentMessagesParams,
    ): Effect.Effect<CodingAgentMessagesAnswerView>;
    codingAgentStop(params: CodingAgentStopParams): Effect.Effect<CodingAgentAgentAnswer>;
    codingAgentPullRequest(
      params: CodingAgentPullRequestParams,
    ): Effect.Effect<CodingAgentPullRequestAnswerView>;
  };
  /** Where every answer's agents are noted, and which agent's tab the panel shows. */
  notices: Pick<
    AgentNotices,
    "observeAgents" | "observeStatus" | "observeModels" | "observePlanGone" | "shown"
  >;
}

type CodingAgentActKind =
  | typeof ACT_KIND.CODING_AGENTS_MODELS
  | typeof ACT_KIND.CODING_AGENTS_DEFAULT_READ
  | typeof ACT_KIND.CODING_AGENTS_DEFAULT_WRITE
  | typeof ACT_KIND.CODING_AGENTS_LIST
  | typeof ACT_KIND.CODING_AGENTS_START
  | typeof ACT_KIND.CODING_AGENTS_MESSAGES
  | typeof ACT_KIND.CODING_AGENTS_STOP
  | typeof ACT_KIND.CODING_AGENTS_SHOWN
  | typeof ACT_KIND.CODING_AGENTS_PULL_REQUEST;

/** The refusal a window that draws no Plans tab hears, in its kind's own words. */
function refuseUnlessPanel(kind: CodingAgentActKind, sender: ActSender): void {
  if (!sender.panel) throw new ActRefused({ message: ACT[kind].refusal });
}

/** The answer as it stands, noted on its way to the panel. */
function noted<Answer>(
  answer: Effect.Effect<Answer>,
  note: (answer: Answer) => void,
): Effect.Effect<Answer> {
  return Effect.tap(answer, (value) => Effect.sync(() => note(value)));
}

export function codingAgentActRows(
  dependencies: CodingAgentActsDependencies,
): Pick<ActRows, CodingAgentActKind> {
  const { host, notices } = dependencies;
  const notedAgent = (answer: Effect.Effect<CodingAgentAgentAnswer>) =>
    noted(answer, (value) => {
      if ("agent" in value) notices.observeAgents([value.agent]);
    });
  return {
    [ACT_KIND.CODING_AGENTS_MODELS]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_MODELS, sender);
      return noted(host.codingAgentModels(), (answer) => {
        if ("models" in answer) notices.observeModels(answer.models);
      });
    },
    [ACT_KIND.CODING_AGENTS_DEFAULT_READ]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_DEFAULT_READ, sender);
      return host.codingAgentDefaultRead();
    },
    [ACT_KIND.CODING_AGENTS_DEFAULT_WRITE]: (choice, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_DEFAULT_WRITE, sender);
      return host.codingAgentDefaultWrite(choice);
    },
    [ACT_KIND.CODING_AGENTS_LIST]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_LIST, sender);
      return noted(host.codingAgentList(params), (answer) => {
        if ("agents" in answer) notices.observeAgents(answer.agents);
        else if (answer.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND) {
          notices.observePlanGone(params.planId);
        }
      });
    },
    [ACT_KIND.CODING_AGENTS_START]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_START, sender);
      return notedAgent(host.codingAgentStart(params));
    },
    [ACT_KIND.CODING_AGENTS_MESSAGES]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_MESSAGES, sender);
      return noted(host.codingAgentMessages(params), (answer) => {
        if ("status" in answer) notices.observeStatus(params.agentId, answer.status);
      });
    },
    [ACT_KIND.CODING_AGENTS_STOP]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_STOP, sender);
      return notedAgent(host.codingAgentStop(params));
    },
    [ACT_KIND.CODING_AGENTS_SHOWN]: ({ agentId }, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_SHOWN, sender);
      notices.shown(agentId);
    },
    [ACT_KIND.CODING_AGENTS_PULL_REQUEST]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_PULL_REQUEST, sender);
      return host.codingAgentPullRequest(params);
    },
  };
}
