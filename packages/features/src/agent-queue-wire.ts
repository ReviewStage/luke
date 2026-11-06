import { Schema as EffectSchema } from "effect";

export const QUEUE_PAUSE = {
  STOPPED: "stopped",
  TURN_FAILED: "turn-failed",
  REFUSED: "refused",
} as const;

export type QueuePause = (typeof QUEUE_PAUSE)[keyof typeof QUEUE_PAUSE];

export const AGENT_QUEUE_BOUNDS = {
  MAX_MESSAGES: 50,
  MAX_REFUSAL_CHARS: 64,
} as const;

export const queuedMessageSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  text: EffectSchema.String,
  files: EffectSchema.optionalKey(
    EffectSchema.Array(
      EffectSchema.Struct({
        name: EffectSchema.String,
        mediaType: EffectSchema.String,
        id: EffectSchema.optionalKey(EffectSchema.String),
      }),
    ),
  ),
  queuedBy: EffectSchema.String,
  editing: EffectSchema.optionalKey(EffectSchema.Literal(true)),
});

export type QueuedMessage = typeof queuedMessageSchema.Type;

export const queuePausedSchema = EffectSchema.Struct({
  because: EffectSchema.Literals(Object.values(QUEUE_PAUSE)),
  refusal: EffectSchema.optionalKey(
    EffectSchema.String.check(EffectSchema.isMaxLength(AGENT_QUEUE_BOUNDS.MAX_REFUSAL_CHARS)),
  ),
});

export type QueuePaused = typeof queuePausedSchema.Type;

export const agentQueueSchema = EffectSchema.Struct({
  messages: EffectSchema.Array(queuedMessageSchema),
  paused: EffectSchema.optionalKey(queuePausedSchema),
  revision: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0)),
});

export type AgentQueue = typeof agentQueueSchema.Type;
