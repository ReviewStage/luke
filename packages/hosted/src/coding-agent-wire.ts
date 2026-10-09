import { MESSAGE_ROLE, WireValueSchema } from "@sidecar/wire";
import { verbatimJsonSchema } from "@sidecar/wire/effect";
import { Schema as EffectSchema } from "effect";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

/**
 * coding-agent-wire.ts -- a plan's coding agents, as the desktop starts, lists, reads, and stops them.
 *
 * A coding agent is one cloud session the service runs over a plan: it
 * checks the plan's repository out, implements the plan, and decides on a
 * pull request. The desktop starts one with a key of its own, so a retry of
 * the same Start is the same agent, and names the model and effort it runs
 * on or leaves both to the account's default. What comes back is the
 * agent's summary: its id, what it runs on, when it started, and where it
 * stands, which is the status of its newest turn. Its transcript is the
 * conversation's own `messages` rows, each an AI SDK `UIMessage`, read after
 * a cursor the service hands back with every page beside the agent's status
 * as the page was read, so a tab held open hears each message once as it
 * lands and again when it changes in place, and hears the agent end from
 * the page that ends the hold.
 *
 * Every request refuses a key it does not name; an answer ignores one a
 * newer service added. Declared directly with Effect's `Schema.Struct` and
 * exported under its own name.
 */

export const CODING_AGENT_BOUNDS = {
  /** The most characters a Start's key may spell; a UUID is the usual. */
  MAX_KEY_CHARS: 128,
  /** The most characters a model id or an effort may spell on the way in; the catalog decides whether they name anything. */
  MAX_CHOICE_CHARS: 200,
} as const;

/** Where an agent stands, read from its newest turn: not yet started, at work, or how it ended. */
export const CODING_AGENT_STATUS = {
  /** The agent exists and its session has not run a turn yet. */
  STARTING: "starting",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  /** The developer stopped it, or a Stop is on its way to it; anything it pushed stays. */
  CANCELLED: "cancelled",
} as const;

export type CodingAgentStatus = (typeof CODING_AGENT_STATUS)[keyof typeof CODING_AGENT_STATUS];

/** A text settled with its ends trimmed, refused when nothing but whitespace stands, and bounded. */
function trimmedText(maximumChars: number) {
  return EffectSchema.Trim.check(EffectSchema.isNonEmpty(), EffectSchema.isMaxLength(maximumChars));
}

/**
 * Starting an agent (POST): the request's own key, which a retry carries
 * again, and the model and effort to run on where the developer chose
 * them; both or neither, since a choice is one thing.
 */
export const codingAgentStartRequestSchema = EffectSchema.Struct({
  idempotencyKey: trimmedText(CODING_AGENT_BOUNDS.MAX_KEY_CHARS),
  model: EffectSchema.optionalKey(trimmedText(CODING_AGENT_BOUNDS.MAX_CHOICE_CHARS)),
  effort: EffectSchema.optionalKey(trimmedText(CODING_AGENT_BOUNDS.MAX_CHOICE_CHARS)),
});

export type CodingAgentStartRequest = typeof codingAgentStartRequestSchema.Type;

/** One agent as the tabs draw it: what it runs on, when it started, and where it stands. */
export const codingAgentSummarySchema = EffectSchema.Struct({
  id: wireUuidSchema,
  planId: wireUuidSchema,
  /** AI Gateway's catalog id, such as `anthropic/claude-opus-5.5`. */
  model: EffectSchema.String,
  effort: EffectSchema.String,
  /** Epoch milliseconds the agent was started. */
  createdAt: countedNumber,
  status: EffectSchema.Literals(Object.values(CODING_AGENT_STATUS)),
});

export type CodingAgentSummary = typeof codingAgentSummarySchema.Type;

/** A started or stopped agent (POST). */
export const codingAgentAnswerSchema = EffectSchema.Struct({ agent: codingAgentSummarySchema });

/** The plan's agents (GET), in the order they were started. */
export const codingAgentListAnswerSchema = EffectSchema.Struct({
  agents: EffectSchema.Array(codingAgentSummarySchema),
});

/**
 * One JSON object as the row holds it, read whole: a message part or the
 * metadata beside the parts, whose fields are the AI SDK's own vocabulary
 * and not this wire's to spell. The node shown for it says only that much.
 */
const storedObjectSchema = verbatimJsonSchema(WireValueSchema, {
  type: "object",
  additionalProperties: true,
});

/**
 * One message of an agent's transcript, as the conversation's row holds it:
 * an AI SDK `UIMessage`, its parts as the SDK shapes them (text, reasoning,
 * tool calls with their input and output, step boundaries) and the stored
 * metadata beside them. The parts are carried as the JSON they are rather
 * than declared part by part, because the SDK's vocabulary is the contract
 * and the components that draw them read it directly.
 */
export const codingAgentMessageSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  role: EffectSchema.Literals(Object.values(MESSAGE_ROLE)),
  parts: EffectSchema.Array(storedObjectSchema),
  metadata: EffectSchema.optionalKey(storedObjectSchema),
});

export type CodingAgentMessage = typeof codingAgentMessageSchema.Type;

/**
 * Where a reader stands in the transcript: the highest message sequence it
 * has, and the conversation's journal revision it read at, joined by a
 * colon. A message is new past a cursor when its sequence is higher or it
 * was amended in place at a later revision.
 */
const CURSOR_PATTERN = /^\d+:\d+$/u;

export const codingAgentCursorSchema = EffectSchema.String.check(
  EffectSchema.isPattern(CURSOR_PATTERN),
);

/** The cursor a reader starts from: before every message. */
export const CODING_AGENT_CURSOR_START = "0:0";

/**
 * The messages past a cursor (GET), the cursor to read on from, and where
 * the agent stood as the page was read, so a reader held on a running agent
 * learns from the page that ends the hold that there is nothing more to
 * wait for.
 */
export const codingAgentMessagesAnswerSchema = EffectSchema.Struct({
  messages: EffectSchema.Array(codingAgentMessageSchema),
  cursor: codingAgentCursorSchema,
  status: EffectSchema.Literals(Object.values(CODING_AGENT_STATUS)),
});
