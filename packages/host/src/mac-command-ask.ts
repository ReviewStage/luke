import { Schema } from "effect";

/**
 * mac-command-ask.ts -- a command an agent asked to run on this Mac, held for the developer's answer: the ask every window draws, and the answer one gives.
 *
 * With Settings › This Mac on Ask every time, the host claims the command
 * and holds it here until the developer answers or the command's own
 * timeout passes (`compose-mac-commands.ts`); the asks waiting ride the
 * document (`app-state.ts`'s `macCommands`), the panel draws the oldest as a
 * prompt, and its answer comes back by the ask's id.
 */

/** One command waiting on the developer: the ask's id, which is the command's, the shell text, and when the Mac asked, by its clock. */
export const macCommandAskSchema = Schema.Struct({
  id: Schema.String,
  command: Schema.String,
  askedAt: Schema.Number,
});

export type MacCommandAsk = typeof macCommandAskSchema.Type;

/** The asks waiting, the earliest first, as the host tells them. */
export const macCommandAsksSchema = Schema.Struct({
  asks: Schema.Array(macCommandAskSchema),
});

/** What the developer answers an ask: run it this once, run it and every later one without asking, or not at all. */
export const MAC_COMMAND_DECISION = {
  ALLOW_ONCE: "allow-once",
  ALLOW_ALWAYS: "allow-always",
  DENY: "deny",
} as const;

export type MacCommandDecision = (typeof MAC_COMMAND_DECISION)[keyof typeof MAC_COMMAND_DECISION];

/** One ask answered, by its id. */
export const macCommandAnswerSchema = Schema.Struct({
  id: Schema.String,
  decision: Schema.Literals(Object.values(MAC_COMMAND_DECISION)),
});

export type MacCommandAnswer = typeof macCommandAnswerSchema.Type;
