import type { DatabaseServices } from "@repo/database/core/query";
import { type Agent, readAgent, readAgentOfConversation } from "@repo/database/models/agent-store";
import { readMessageByClientId } from "@repo/database/models/message-reads";
import { type SettledAgentTurn, storeWriter } from "@repo/database/models/writer";
import { AGENT_MESSAGE_LEAD, agentMessageReplyLine } from "@repo/features/agent-wire";
import { MENTION_KIND } from "@repo/features/mention-link";
import { agentName } from "@repo/features/model-label";
import { causeKind } from "@repo/runtime/effect";
import { TURN_STATUS } from "@repo/wire";
import type { StoredUIMessage } from "@repo/wire/ui-messages";
import { isTextUIPart } from "ai";
import { Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
import type { SessionsForAccount } from "../../automations/automation-runs.js";
import { MESSAGE_CHANNEL } from "../../core.js";
import type { GitHubApp } from "../../github/github-app.js";
import { workspaceStepOf, writtenMention } from "../written-mentions.js";
import { MAX_MESSAGE_WORDS_CHARS } from "./agent-message.js";
import { agentLineSender, steerAgent } from "./steer.js";
import { CODER_TOOL_SET } from "./tool-set.js";

const REPORT_HEAD_ROOM_CHARS = 500;

const REPORT_WORDS_CHARS = MAX_MESSAGE_WORDS_CHARS - REPORT_HEAD_ROOM_CHARS;

const CUT_MARK = "… (cut to fit; read_agent reads the rest)";

const NO_WORDS = "(it said nothing)";

export function lastSaid(journal: StoredUIMessage): string | undefined {
  const said = journal.parts.flatMap((part) =>
    isTextUIPart(part) && part.text.trim().length > 0 ? [part.text.trim()] : [],
  );
  return said.at(-1);
}

function finalWords(journal: StoredUIMessage): string | undefined {
  const last = lastSaid(journal);
  if (last === undefined) return undefined;
  return last.length > REPORT_WORDS_CHARS
    ? `${last.slice(0, REPORT_WORDS_CHARS - CUT_MARK.length)}${CUT_MARK}`
    : last;
}

function ended(turn: SettledAgentTurn): string {
  if (turn.status === TURN_STATUS.CANCELED) return "was stopped before it finished";
  if (turn.status === TURN_STATUS.FAILED) {
    return `failed its turn${turn.failure === null ? "" : ` (${turn.failure})`}`;
  }
  return "finished its turn";
}

function reportLine(
  agent: Agent,
  mention: string,
  turn: SettledAgentTurn,
  words: string | undefined,
): string {
  const head = `${AGENT_MESSAGE_LEAD} · ${mention}, an agent you started, ${ended(turn)}. Its final message:`;
  return [head, words ?? NO_WORDS, agentMessageReplyLine(agent.id)].join("\n\n");
}

const starterOf = (agent: Agent) =>
  Effect.gen(function* () {
    if (agent.startedByAgentId === null) return Option.none<Agent>();
    const starter = yield* readAgent(agent.userId, agent.startedByAgentId);
    return Option.filter(starter, (found) => found.archivedAt === null);
  });

export function reportToStarter(
  sessionsFor: SessionsForAccount,
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
    const eve = yield* sessionsFor(turn.userId);
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
