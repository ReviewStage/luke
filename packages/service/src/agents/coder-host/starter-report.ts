/**
 * starter-report.ts -- a started agent's final message handed to the agent that started it, as its turn settles.
 *
 * An agent another coding agent started (`agent.started_by_agent_id`)
 * reports to its starter by message; one whose turn ends before it does,
 * or whose report `message_agent` refused, would leave its starter waiting
 * on a message that never comes. So the store writer's settle of a coding
 * agent's turn (`@luke/database/models/writer`'s `SettledTurnListener`) hands
 * the turn's final words to the starter here, as the message the agent would
 * have sent (`agent-message.ts`): under the agent's own name, opening on
 * who sent it and how its turn ended, completed, failed with why, or
 * stopped, and closing on how to answer it. A failed turn that said nothing
 * hands its failure alone. The words are cut to fit one message.
 *
 * The line goes under the turn's own id as its key, so a settle heard again
 * sends nothing twice (`steerAgent`'s repeat); one the service could not
 * send is logged and not tried again, since the starter reads the agent
 * itself (`read_agent`). A starter archived or gone is told by no one.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { type Agent, readAgent, readAgentOfConversation } from "@luke/database/models/agent-store";
import { readMessageByClientId } from "@luke/database/models/message-reads";
import { type SettledAgentTurn, storeWriter } from "@luke/database/models/writer";
import { AGENT_MESSAGE_LEAD, agentMessageReplyLine } from "@luke/features/agent-wire";
import { MENTION_KIND } from "@luke/features/mention-link";
import { agentName } from "@luke/features/model-label";
import { causeKind } from "@luke/runtime/effect";
import { TURN_STATUS } from "@luke/wire";
import type { StoredUIMessage } from "@luke/wire/ui-messages";
import { isTextUIPart } from "ai";
import { Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
import type { EveForAccount } from "../../automations/automation-runs.js";
import { MESSAGE_CHANNEL } from "../../core.js";
import type { GitHubApp } from "../../github/github-app.js";
import { workspaceStepOf, writtenMention } from "../written-mentions.js";
import { MAX_MESSAGE_WORDS_CHARS } from "./agent-message.js";
import { agentLineSender, steerAgent } from "./steer.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/** The room the head takes of a message's words, which the final words leave free. */
const REPORT_HEAD_ROOM_CHARS = 500;

/** The most characters of the agent's final words the line carries; longer ones are cut. */
const REPORT_WORDS_CHARS = MAX_MESSAGE_WORDS_CHARS - REPORT_HEAD_ROOM_CHARS;

/** What the cut end of the final words says. */
const CUT_MARK = "… (cut to fit; read_agent reads the rest)";

/** What the line says of a turn that ended in words of its own. */
const NO_WORDS = "(it said nothing)";

/** The agent's final words: the last text its turn's journal holds, cut to fit; none where it said nothing. */
function finalWords(journal: StoredUIMessage): string | undefined {
  const said = journal.parts.flatMap((part) =>
    isTextUIPart(part) && part.text.trim().length > 0 ? [part.text.trim()] : [],
  );
  const last = said.at(-1);
  if (last === undefined) return undefined;
  return last.length > REPORT_WORDS_CHARS
    ? `${last.slice(0, REPORT_WORDS_CHARS - CUT_MARK.length)}${CUT_MARK}`
    : last;
}

/** How the turn ended, in the head's words. */
function ended(turn: SettledAgentTurn): string {
  if (turn.status === TURN_STATUS.CANCELLED) return "was stopped before it finished";
  if (turn.status === TURN_STATUS.FAILED) {
    return `failed its turn${turn.failure === null ? "" : ` (${turn.failure})`}`;
  }
  return "finished its turn";
}

/** The line the starter receives: who it is from and how its turn ended, its final words, and how to answer. */
function reportLine(
  agent: Agent,
  mention: string,
  turn: SettledAgentTurn,
  words: string | undefined,
): string {
  const head = `${AGENT_MESSAGE_LEAD} · ${mention}, an agent you started, ${ended(turn)}. Its final message:`;
  return [head, words ?? NO_WORDS, agentMessageReplyLine(agent.id)].join("\n\n");
}

/**
 * The starter the agent reports to: the agent that started it, where it
 * stands unarchived; none otherwise. Note that a pilot a continue took over
 * moved its agents to the pilot that took over (`agent-store.ts`'s
 * `updateTakenOver`), so the row already names it.
 */
const starterOf = (agent: Agent) =>
  Effect.gen(function* () {
    if (agent.startedByAgentId === null) return Option.none<Agent>();
    const starter = yield* readAgent(agent.userId, agent.startedByAgentId);
    return Option.filter(starter, (found) => found.archivedAt === null);
  });

/**
 * Hands the settled turn's final message to the agent's starter, as the
 * header says, or nothing where the agent has none to tell; a failure to
 * send is logged by its kind alone, never answered, so nothing of the agent
 * or its member rides the log line.
 */
export function reportToStarter(
  eveFor: EveForAccount,
  turn: SettledAgentTurn,
): Effect.Effect<void, never, DatabaseServices | HttpClient.HttpClient | GitHubApp> {
  return Effect.gen(function* () {
    const agent = yield* readAgentOfConversation(turn.userId, turn.conversationId);
    if (Option.isNone(agent)) return;
    const starter = yield* starterOf(agent.value);
    if (Option.isNone(starter)) return;
    const journal = yield* readMessageByClientId(
      turn.userId,
      turn.conversationId,
      CODER_TOOL_SET,
      turn.turnId,
    );
    const [newest] = journal.ok ? journal.value : [];
    const words = newest === undefined ? undefined : finalWords(newest.message);
    const step = yield* workspaceStepOf(turn.userId, agent.value.organizationId);
    const mention = writtenMention(
      { kind: MENTION_KIND.AGENT, agentId: agent.value.id },
      agentName(agent.value),
      step,
    );
    const eve = yield* eveFor(turn.userId);
    yield* steerAgent(eve, storeWriter({ tools: CODER_TOOL_SET }), turn.userId, starter.value, {
      text: reportLine(agent.value, mention, turn, words),
      clientKey: turn.turnId,
      sender: agentLineSender(agent.value),
      metadata: { channel: MESSAGE_CHANNEL.AGENT_MESSAGE },
    });
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("a started agent's final message was not handed to its starter", {
        failure: causeKind(cause),
      }),
    ),
  );
}
