import { Schema } from "effect";

const macCommandAskSchema = Schema.Struct({
  id: Schema.String,
  command: Schema.String,
  askedAt: Schema.Number,
});

export type MacCommandAsk = typeof macCommandAskSchema.Type;

export const macCommandAsksSchema = Schema.Struct({
  asks: Schema.Array(macCommandAskSchema),
});

export const MAC_COMMAND_DECISION = {
  ALLOW_ONCE: "allow-once",
  ALLOW_ALWAYS: "allow-always",
  DENY: "deny",
} as const;

export type MacCommandDecision = (typeof MAC_COMMAND_DECISION)[keyof typeof MAC_COMMAND_DECISION];

export const macCommandAnswerSchema = Schema.Struct({
  id: Schema.String,
  decision: Schema.Literals(Object.values(MAC_COMMAND_DECISION)),
});

export type MacCommandAnswer = typeof macCommandAnswerSchema.Type;
