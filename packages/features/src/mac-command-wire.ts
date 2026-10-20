import { Effect, Schema as EffectSchema } from "effect";
import { wireUuidSchema } from "./service-wire.js";

/**
 * mac-command-wire.ts -- a command an agent asked to run on the developer's Mac, as the Mac takes it from the service and hands back what it came to.
 *
 * A command is of a kind (`MAC_COMMAND_KIND`): a shell command, or an act
 * on a Browser tab. An agent's `run_on_mac` call is queued on the service under the account
 * (`packages/service/src/agents/mac-command.ts`). A signed-in Mac with the
 * setting on holds `GET /api/mac-commands` open, naming in its `kinds`
 * query the kinds it runs beyond `shell`, and is answered with every
 * command of those kinds waiting for the account, each claimed for that
 * Mac as it goes; it runs each in a login shell from the home folder and
 * posts what it printed (POST), or posts a refusal for a command of a kind
 * it cannot run. Nothing is asked of the developer first. Every request
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
  /** The most characters of a browser command's params, written as JSON, the service queues. */
  MAX_BROWSER_PARAMS_CHARS: 100_000,
} as const;

/**
 * What a command asks the Mac to do. Every Mac that reads runs `shell`, an
 * older one that names no kinds among them; a newer one names the others
 * it runs in its read, and is handed only commands of the kinds it named.
 */
export const MAC_COMMAND_KIND = {
  /** A shell command, run in the login shell from the home folder (`run_on_mac`). */
  SHELL: "shell",
  /** An act on one of the desktop's Browser tabs; what it carries is opaque here. */
  BROWSER: "browser",
} as const;

export type MacCommandKind = (typeof MAC_COMMAND_KIND)[keyof typeof MAC_COMMAND_KIND];

const MAC_COMMAND_KINDS: ReadonlySet<string> = new Set(Object.values(MAC_COMMAND_KIND));

function isMacCommandKind(kind: string): kind is MacCommandKind {
  return MAC_COMMAND_KINDS.has(kind);
}

/** The separator between the kinds a read names in its `kinds` query. */
const KIND_SEPARATOR = ",";

/** The kinds a Mac's read names, as its `kinds` query carries them; `shell` goes without saying. */
export function macCommandKindsQuery(kinds: readonly MacCommandKind[]): string {
  return kinds.join(KIND_SEPARATOR);
}

/**
 * The kinds a Mac's read may be handed: `shell`, which every Mac runs, and
 * each other kind its query names that this build knows. Note that a kind
 * it does not know is passed over rather than refused, so a newer Mac's
 * read is answered with what this service can queue.
 */
export function macCommandKindsRead(query: string | undefined): readonly MacCommandKind[] {
  const named = (query ?? "").split(KIND_SEPARATOR).map((kind) => kind.trim());
  return [...new Set([MAC_COMMAND_KIND.SHELL, ...named.filter(isMacCommandKind)])];
}

const commandTimeout = EffectSchema.Int.check(
  EffectSchema.isBetween({ minimum: 1, maximum: MAC_COMMAND_BOUNDS.MAX_TIMEOUT_SECONDS }),
);

/** One shell command waiting for the Mac: its id, the shell text, and how long it may run. */
const macShellCommandSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  kind: EffectSchema.Literal(MAC_COMMAND_KIND.SHELL),
  command: EffectSchema.String.check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(MAC_COMMAND_BOUNDS.MAX_COMMAND_CHARS),
  ),
  timeoutSeconds: commandTimeout,
});

export type MacShellCommand = typeof macShellCommandSchema.Type;

/** Whether a JSON value's text is within the bound a browser command's params are held to. */
function withinParamsBound(params: EffectSchema.Json): boolean {
  return JSON.stringify(params).length <= MAC_COMMAND_BOUNDS.MAX_BROWSER_PARAMS_CHARS;
}

/**
 * One browser command waiting for the Mac: its id, what it asks of a
 * Browser tab, and how long it may take. Note that the params are any JSON
 * within a bound for now, because what they hold is the browser acts' own
 * vocabulary, which the Mac that runs them declares.
 */
const macBrowserCommandSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  kind: EffectSchema.Literal(MAC_COMMAND_KIND.BROWSER),
  params: EffectSchema.Json.check(EffectSchema.makeFilter(withinParamsBound)),
  timeoutSeconds: commandTimeout,
});

/** One command waiting for the Mac, of a kind the service queues. */
export const macCommandSchema = EffectSchema.Union([
  macShellCommandSchema,
  macBrowserCommandSchema,
]);

export type MacCommand = typeof macCommandSchema.Type;

/**
 * A kind this build does not know, as a newer service wrote one: read as
 * the kind's name alone, so the Mac refuses that command rather than the
 * whole read. A kind this build knows is refused here, because a known one
 * that fails its own shape is a broken read and not a newer one.
 */
const unknownMacCommandKindSchema = EffectSchema.String.check(
  EffectSchema.makeFilter((kind) => !isMacCommandKind(kind)),
).pipe(EffectSchema.brand("UnknownMacCommandKind"));

/**
 * A shell command as the Mac reads one: with its kind, or without one, as
 * a service from before kinds wrote it, which claimed the command before it
 * answered and so must not have it dropped.
 */
const macShellCommandReadSchema = macShellCommandSchema.mapFields((fields) => ({
  ...fields,
  kind: fields.kind.pipe(
    EffectSchema.withDecodingDefaultKey(Effect.succeed(MAC_COMMAND_KIND.SHELL)),
  ),
}));

/** A command as the Mac reads one: one of a kind this build knows, or the id and kind alone of one it does not. */
const macCommandReadSchema = EffectSchema.Union([
  macShellCommandReadSchema,
  macBrowserCommandSchema,
  EffectSchema.Struct({ id: wireUuidSchema, kind: unknownMacCommandKindSchema }),
]);

export type MacCommandRead = typeof macCommandReadSchema.Type;

/**
 * Whether a command the Mac read is a shell command. Note that this is
 * read off the kind alone, which TypeScript cannot narrow on by itself,
 * because an unknown kind is any text but a known one.
 */
export function isMacShellCommand(command: MacCommandRead): command is MacShellCommand {
  return command.kind === MAC_COMMAND_KIND.SHELL;
}

/** The commands claimed for this Mac (GET), none where nothing came while the read was held. */
export const macCommandsAnswerSchema = EffectSchema.Struct({
  commands: EffectSchema.Array(macCommandReadSchema),
});

const output = EffectSchema.String.check(
  EffectSchema.isMaxLength(MAC_COMMAND_BOUNDS.MAX_OUTPUT_CHARS),
);

/**
 * What a shell command did: its exit code, null where it never exited on
 * its own (killed at its timeout, or never started), what it printed,
 * whether either stream was cut, and whether the timeout killed it.
 */
const macShellResultSchema = EffectSchema.Struct({
  exitCode: EffectSchema.NullOr(EffectSchema.Int),
  stdout: output,
  stderr: output,
  truncated: EffectSchema.Boolean,
  timedOut: EffectSchema.Boolean,
});

export type MacShellResult = typeof macShellResultSchema.Type;

/** A command the Mac would not run, such as one of a kind it cannot run, and why, in words the agent can act on. */
const macCommandRefusalSchema = EffectSchema.Struct({
  refused: EffectSchema.String.check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(MAC_COMMAND_BOUNDS.MAX_OUTPUT_CHARS),
  ),
});

export type MacCommandRefusal = typeof macCommandRefusalSchema.Type;

/** What a command came to: what a shell command did, or why the Mac ran nothing. */
export const macCommandResultSchema = EffectSchema.Union([
  macShellResultSchema,
  macCommandRefusalSchema,
]);

export type MacCommandResult = typeof macCommandResultSchema.Type;

/** One command's result, posted by the Mac that claimed it (POST). */
export const macCommandSettleRequestSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  result: macCommandResultSchema,
});

/** A result the service kept (POST). */
export const macCommandSettledAnswerSchema = EffectSchema.Struct({
  settled: EffectSchema.Literal(true),
});
