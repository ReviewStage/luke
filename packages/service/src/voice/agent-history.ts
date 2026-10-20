import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import type { ConversationTarget } from "@luke/database/models/writer";
import { Effect, type Schema } from "effect";
import { readRecentMessages, storedMessageLine } from "../agents/brain-host/context.js";
import { MESSAGE_AUTHOR, MESSAGE_ROLE, type StoredUIMessage } from "../core.js";
import { CALL_BACKEND } from "./call-backend.js";

/**
 * agent-history.ts -- what a call into an agent opens knowing of the agent's own work.
 *
 * A call into an agent that has already run turns opens on where the agent
 * stands rather than on a task's blank plan: the developer's newest typed
 * messages to it and its last turn, each as one line the way a rotated
 * session's seed renders a stored message (`storedMessageLine`), so the
 * voice can say what the agent is doing and pick up from there. What was
 * said on earlier calls into the agent is the opening's own earlier-calls
 * history, so a spoken line and the voice's own words are left out here.
 */

const AGENT_HISTORY = {
  /** How many of the conversation's newest finished messages are read, enough to find a few typed lines past a long run of tool-calling replies. */
  READ: 60,
  /** How many of the developer's typed messages are kept, newest last. */
  TYPED: 6,
  /** The characters one typed message keeps. */
  TYPED_CHARS: 600,
  /** The characters the last turn's reply keeps. */
  LAST_TURN_CHARS: 1_500,
} as const;

/** The agent's work as a call into it opens on: the developer's newest typed messages, oldest first, and its last turn, where it has run one. */
export interface AgentCallHistory {
  readonly typed: readonly string[];
  readonly lastTurn: string | undefined;
}

/** Whether the voice wrote the row: a call's spoken line, or what the voice said on it. A system row is no one's words, and is left out with them. */
function spoken(message: StoredUIMessage): boolean {
  if (message.role === MESSAGE_ROLE.SYSTEM) return true;
  return (
    message.metadata.author === MESSAGE_AUTHOR.VOICE_MODEL ||
    ("voice_session_id" in message.metadata && message.metadata.voice_session_id !== undefined)
  );
}

/** The agent's history read from its messages, or none for an agent with no typed message and no turn. */
function agentCallHistoryOf(messages: readonly StoredUIMessage[]): AgentCallHistory | undefined {
  const own = messages.filter((message) => !spoken(message));
  const typed = own
    .filter(
      (message) =>
        message.role === MESSAGE_ROLE.USER && message.metadata.author === MESSAGE_AUTHOR.DEVELOPER,
    )
    .slice(-AGENT_HISTORY.TYPED)
    .map((message) => storedMessageLine(message, AGENT_HISTORY.TYPED_CHARS));
  const last = own.findLast((message) => message.role === MESSAGE_ROLE.ASSISTANT);
  const lastTurn =
    last === undefined ? undefined : storedMessageLine(last, AGENT_HISTORY.LAST_TURN_CHARS);
  if (typed.length === 0 && lastTurn === undefined) return undefined;
  return { typed, lastTurn };
}

/** The agent's history as its conversation stands, read under the member who started it. */
export function agentCallHistory(
  conversation: ConversationTarget,
): Effect.Effect<AgentCallHistory | undefined, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.map(
    readRecentMessages(conversation, CALL_BACKEND.AGENT.tools, AGENT_HISTORY.READ),
    agentCallHistoryOf,
  );
}
