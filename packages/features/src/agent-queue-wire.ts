import { Schema as EffectSchema } from "effect";

/**
 * agent-queue-wire.ts -- a coding agent's queue: the messages a member queued behind its running turn, each sent as a turn of its own in order once the one before it is over, and whether the queue stands paused.
 *
 * A message sent with ⌘↩ while the agent works waits here rather than
 * steering the turn under way. The service holds it, unsent and with no row
 * in the transcript, so it may still be edited, deleted, put in another
 * place, or steered into the turn after all; and once the agent's turn is
 * over, the first one goes as the developer's own message, under its own
 * send key, and opens the next turn (`@luke/service`'s `agent-queue.ts`).
 * A Stop pauses the queue, and so does a turn that failed or a hand-off the
 * service refused, which the pause names; nothing goes until Resume. What a
 * member asks of the queue is `agent-wire.ts`'s, beside a message.
 */

/** Why a queue stands paused: the developer's Stop, a turn that failed, or a hand-off the service refused. */
export const QUEUE_PAUSE = {
  STOPPED: "stopped",
  TURN_FAILED: "turn-failed",
  REFUSED: "refused",
} as const;

export type QueuePause = (typeof QUEUE_PAUSE)[keyof typeof QUEUE_PAUSE];

/** How many messages one agent's queue holds at most. */
export const AGENT_QUEUE_BOUNDS = {
  MAX_MESSAGES: 50,
  /** The longest refusal word a pause carries, past every word the service has. */
  MAX_REFUSAL_CHARS: 64,
} as const;

/** One queued message as the queue lists it, in its place. */
export const queuedMessageSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  text: EffectSchema.String,
  /**
   * The files that go with it, each by its name and type, and the id its
   * bytes are read by, as a picture of the agent's is
   * (`/api/agents/{id}/pictures/{picture}`); absent where none do.
   */
  files: EffectSchema.optionalKey(
    EffectSchema.Array(
      EffectSchema.Struct({
        name: EffectSchema.String,
        mediaType: EffectSchema.String,
        id: EffectSchema.optionalKey(EffectSchema.String),
      }),
    ),
  ),
  /** The member who queued it, whose message it goes as. */
  queuedBy: EffectSchema.String,
  /** Whether a member is editing it in their composer, which holds it out of the hand-off; absent while nobody is. */
  editing: EffectSchema.optionalKey(EffectSchema.Literal(true)),
  /** The key it was queued and goes under, by which the window that queued it knows its own message landed; absent from a service older than it. */
  clientKey: EffectSchema.optionalKey(EffectSchema.String),
});

export type QueuedMessage = typeof queuedMessageSchema.Type;

/**
 * Why a queue stands paused, and for a refused hand-off the service's word
 * for what refused it (a `HOSTED_API_ERROR`), carried as the word it is, so
 * a refusal a newer service names still reads, as one the window has no
 * words for.
 */
export const queuePausedSchema = EffectSchema.Struct({
  because: EffectSchema.Literals(Object.values(QUEUE_PAUSE)),
  refusal: EffectSchema.optionalKey(
    EffectSchema.String.check(EffectSchema.isMaxLength(AGENT_QUEUE_BOUNDS.MAX_REFUSAL_CHARS)),
  ),
});

export type QueuePaused = typeof queuePausedSchema.Type;

/** An agent's queue: its messages in the order they go, why it stands paused where it does, and its revision. */
export const agentQueueSchema = EffectSchema.Struct({
  messages: EffectSchema.Array(queuedMessageSchema),
  paused: EffectSchema.optionalKey(queuePausedSchema),
  /**
   * Where the queue stands, moved on by every change to it
   * (`agent-queue-store.ts`): a window draws a change of its own still out
   * over the queue until a page stands at the revision the change answered.
   */
  revision: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0)),
});

export type AgentQueue = typeof agentQueueSchema.Type;
