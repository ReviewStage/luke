import { Schema as EffectSchema } from "effect";
import { wireUuidSchema } from "./service-wire.js";

/**
 * mac-command-wire.ts -- a shell command an agent asked to run on the developer's Mac, as the Mac takes it from the service and hands back what it printed.
 *
 * An agent's `run_on_mac` call is queued on the service under the account
 * (`packages/service/src/agents/mac-command.ts`). A signed-in Mac with the
 * setting on holds `GET /api/mac-commands` open, and is answered with every
 * command waiting for the account, each claimed for that Mac as it goes; it
 * runs each in a login shell from the home folder and posts what it
 * printed (POST). Nothing is asked of the developer first. Every request
 * refuses a key it does not name, as every request frame on this wire does.
 */

export const MAC_COMMAND_BOUNDS = {
  /** How long a command runs before it is killed, when the agent names no time. */
  DEFAULT_TIMEOUT_SECONDS: 60,
  /**
   * The longest an agent may ask for: inside the minutes one eve step may
   * run, and short enough that the voice's ten-minute follow of a brain
   * turn still hears the answer after the queue, the grace, and the model.
   */
  MAX_TIMEOUT_SECONDS: 480,
  /** The most characters of a command the service queues. */
  MAX_COMMAND_CHARS: 100_000,
  /** The most characters of stdout or stderr a result carries; the Mac cuts each to this. */
  MAX_OUTPUT_CHARS: 20_000,
} as const;

/** One command waiting for the Mac: its id, the shell text, and how long it may run. */
export const macCommandSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  command: EffectSchema.String.check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(MAC_COMMAND_BOUNDS.MAX_COMMAND_CHARS),
  ),
  timeoutSeconds: EffectSchema.Int.check(
    EffectSchema.isBetween({ minimum: 1, maximum: MAC_COMMAND_BOUNDS.MAX_TIMEOUT_SECONDS }),
  ),
});

export type MacCommand = typeof macCommandSchema.Type;

/** The commands claimed for this Mac (GET), none where nothing came while the read was held. */
export const macCommandsAnswerSchema = EffectSchema.Struct({
  commands: EffectSchema.Array(macCommandSchema),
});

const output = EffectSchema.String.check(
  EffectSchema.isMaxLength(MAC_COMMAND_BOUNDS.MAX_OUTPUT_CHARS),
);

/**
 * What a command did: its exit code, null where it never exited on its own
 * (killed at its timeout, or never started), what it printed, whether
 * either stream was cut, and whether the timeout killed it.
 */
export const macCommandResultSchema = EffectSchema.Struct({
  exitCode: EffectSchema.NullOr(EffectSchema.Int),
  stdout: output,
  stderr: output,
  truncated: EffectSchema.Boolean,
  timedOut: EffectSchema.Boolean,
});

export type MacCommandResult = typeof macCommandResultSchema.Type;

/** One command's result, posted by the Mac that claimed it (POST). */
export const macCommandSettleRequestSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  result: macCommandResultSchema,
});
