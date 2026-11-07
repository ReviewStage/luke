/**
 * agents-procedures.ts -- the Tasks tab's asks of a task's coding agents whose answer is noted on its way, and its notes of which agent is shown and seen.
 *
 * Only a panel draws a task's agents, so every procedure refuses the
 * takeover and any other window, in its own sentence. The agents' plain
 * acts and live follows are declared (`contract/agents.ts`) and answered
 * by their composer;
 * those written here are the ones whose answer is noted on its way, by the
 * notices (`@repo/host/agent-notices`), which hold where each agent stands
 * so an end the panel is not looking at is still announced, and which
 * agent's tab and task's Inbox the panel shows, so an item it is
 * looking at is not; and an agent's own pull request, read, is noted as
 * what it published. Nothing else is held here.
 */

import { AGENT_CALL_FAILURE, type AgentAgentAnswer } from "@repo/features/agent-view";
import { Effect } from "effect";
import type { AgentNotices } from "../agent-notices.js";
import { AGENT_ACT_KIND, AGENT_ACTS } from "../contract/index.js";
import type { HostActTable } from "../host-acts.js";
import { type ActSender, actPort } from "./base.js";
import { declaredAnswer } from "./declared-acts.js";

/** What the agent procedures reach: the acts whose answer they note, and the notices. */
export interface AgentProceduresDependencies {
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

export function agentProcedures(dependencies: AgentProceduresDependencies) {
  const { acts, notices } = dependencies;
  const notedAgent = <E>(answer: Effect.Effect<AgentAgentAnswer, E>) =>
    noted(answer, (value) => {
      if ("agent" in value) notices.observeAgents([value.agent]);
    });
  return {
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
  };
}
