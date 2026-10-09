import {
  CODING_AGENT_CURSOR_START,
  CODING_AGENT_STATUS,
  type CodingAgentStatus,
} from "@sidecar/hosted";
import type { ToolSet } from "ai";
import { Clock, Effect, Option, Schedule, type Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { StoredUIMessage } from "../../core.js";
import { latestTurnsOf } from "../coding-agent-store.js";
import { type ConversationTarget, listMessagesPast, type MessageCursor } from "../store/index.js";
import { CODER } from "./bounds.js";
import { type AgentStanding, codingAgentStatusOf } from "./status.js";

/**
 * transcript.ts -- a coding agent's transcript past a cursor, held open while the agent runs.
 *
 * The transcript is the conversation's own `messages` rows: the plan the
 * agent was handed, and each turn's journal as the relay writes it, which
 * grows in place while the turn runs and is replaced by the finished answer
 * when it ends. A reader holds a cursor of two numbers, the highest message
 * sequence it has and the journal revision it last read at, so a row added
 * past the first or amended past the second is new to it. A read with
 * nothing new is held open while the agent is starting or its newest turn
 * still runs, looked at again every `MESSAGES_POLL` and let go at
 * `MESSAGES_HOLD`, so a tab hears each message as it lands without asking
 * every half second and a tab on an agent whose first turn has not landed
 * costs one held read per hold rather than a spin; an agent that has ended
 * answers at once. Every page carries the agent's status as it stood when
 * the page was read, so the reader learns the agent ended from the page
 * that ends the hold and asks nothing else. The wire spells the cursor as
 * the two numbers joined by a colon.
 */

const CURSOR_SEPARATOR = ":";

/** The cursor the wire carries, as the store reads it; the start for the start's own spelling. */
export function cursorOfWire(after: string): MessageCursor {
  const [seq, revision] = after.split(CURSOR_SEPARATOR);
  return { seq: Number(seq ?? 0), revision: Number(revision ?? 0) };
}

/** The cursor as the wire carries it. */
export function cursorToWire(cursor: MessageCursor): string {
  return `${cursor.seq}${CURSOR_SEPARATOR}${cursor.revision}`;
}

/** The cursor before every message, as the store reads it. */
export const CURSOR_START: MessageCursor = cursorOfWire(CODING_AGENT_CURSOR_START);

/** A page of the transcript as the route answers it: each row's message as the store holds it, which is the wire's `CodingAgentMessage` once serialized, and the agent's status as it stood. */
export interface TranscriptPage {
  readonly messages: readonly StoredUIMessage[];
  readonly cursor: MessageCursor;
  readonly status: CodingAgentStatus;
}

type TranscriptEffect<A> = Effect.Effect<A, SqlError | Schema.SchemaError, SqlClient.SqlClient>;

/** The statuses a read waits through: more may still land. */
const WAITING_STATUSES: ReadonlySet<CodingAgentStatus> = new Set([
  CODING_AGENT_STATUS.STARTING,
  CODING_AGENT_STATUS.RUNNING,
]);

/** The agent's status now, read from its newest turn. */
const statusNow = (target: ConversationTarget, createdAt: Date) =>
  Effect.gen(function* () {
    const turns = yield* latestTurnsOf(target.userId, [target.conversationId]);
    const now = yield* Clock.currentTimeMillis;
    return codingAgentStatusOf(turns.get(target.conversationId), { createdAt, now });
  });

/** One read of the page past the cursor with the status beside it; a page the vocabulary refuses answers no messages, since nothing readable stands past the cursor. */
function pagePast(
  target: ConversationTarget,
  tools: ToolSet,
  after: MessageCursor,
  createdAt: Date,
): TranscriptEffect<TranscriptPage> {
  return Effect.gen(function* () {
    const { read, cursor } = yield* listMessagesPast(
      target.userId,
      target.conversationId,
      tools,
      after,
    );
    const status = yield* statusNow(target, createdAt);
    return { messages: read.ok ? read.value.map((record) => record.message) : [], cursor, status };
  });
}

/**
 * The transcript past the cursor: the page as it stands, or, while the
 * agent is starting or runs and nothing new stands yet, the first page with
 * something on it inside the hold, or the empty page and the cursor to
 * read on from once the hold is out. Note that the status on a page that
 * ends the hold is read with that page, so a hold that ran out on an agent
 * that ended meanwhile still says so.
 */
export function transcriptPast(
  target: ConversationTarget,
  tools: ToolSet,
  after: MessageCursor,
  agent: Pick<AgentStanding, "createdAt">,
): TranscriptEffect<TranscriptPage> {
  const once = Effect.gen(function* () {
    const page = yield* pagePast(target, tools, after, agent.createdAt);
    if (page.messages.length > 0) return Option.some(page);
    return WAITING_STATUSES.has(page.status) ? Option.none() : Option.some(page);
  });
  return once.pipe(
    Effect.repeat({ schedule: Schedule.spaced(CODER.MESSAGES_POLL), until: Option.isSome }),
    Effect.timeoutOption(CODER.MESSAGES_HOLD),
    Effect.flatMap((held) => {
      const page = Option.flatten(held);
      return Option.isSome(page)
        ? Effect.succeed(page.value)
        : pagePast(target, tools, after, agent.createdAt);
    }),
  );
}
