import { Effect, Schema as EffectSchema } from "effect";
import { wireUuidSchema } from "./service-wire.js";

export const MAC_COMMAND_BOUNDS = {
  DEFAULT_TIMEOUT_SECONDS: 60,
  MAX_TIMEOUT_SECONDS: 480,
  MAX_COMMAND_CHARS: 100_000,
  MAX_OUTPUT_CHARS: 20_000,
} as const;

export const MAC_COMMAND_KIND = {
  SHELL: "shell",
} as const;

export type MacCommandKind = (typeof MAC_COMMAND_KIND)[keyof typeof MAC_COMMAND_KIND];

const MAC_COMMAND_KINDS: ReadonlySet<string> = new Set(Object.values(MAC_COMMAND_KIND));

function isMacCommandKind(kind: string): kind is MacCommandKind {
  return MAC_COMMAND_KINDS.has(kind);
}

const KIND_SEPARATOR = ",";

export function macCommandKindsQuery(kinds: readonly MacCommandKind[]): string {
  return kinds.join(KIND_SEPARATOR);
}

export function macCommandKindsRead(query: string | undefined): readonly MacCommandKind[] {
  const named = (query ?? "").split(KIND_SEPARATOR).map((kind) => kind.trim());
  return [...new Set([MAC_COMMAND_KIND.SHELL, ...named.filter(isMacCommandKind)])];
}

const commandTimeout = EffectSchema.Int.check(
  EffectSchema.isBetween({ minimum: 1, maximum: MAC_COMMAND_BOUNDS.MAX_TIMEOUT_SECONDS }),
);

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

export const macCommandSchema = EffectSchema.Union([macShellCommandSchema]);

export type MacCommand = typeof macCommandSchema.Type;

const unknownMacCommandKindSchema = EffectSchema.String.check(
  EffectSchema.makeFilter((kind) => !isMacCommandKind(kind)),
).pipe(EffectSchema.brand("UnknownMacCommandKind"));

const macShellCommandReadSchema = macShellCommandSchema.mapFields((fields) => ({
  ...fields,
  kind: fields.kind.pipe(
    EffectSchema.withDecodingDefaultKey(Effect.succeed(MAC_COMMAND_KIND.SHELL)),
  ),
}));

const macCommandReadSchema = EffectSchema.Union([
  macShellCommandReadSchema,
  EffectSchema.Struct({ id: wireUuidSchema, kind: unknownMacCommandKindSchema }),
]);

export type MacCommandRead = typeof macCommandReadSchema.Type;

export function isMacShellCommand(command: MacCommandRead): command is MacShellCommand {
  return command.kind === MAC_COMMAND_KIND.SHELL;
}

export const macCommandsAnswerSchema = EffectSchema.Struct({
  commands: EffectSchema.Array(macCommandReadSchema),
});

const output = EffectSchema.String.check(
  EffectSchema.isMaxLength(MAC_COMMAND_BOUNDS.MAX_OUTPUT_CHARS),
);

const macShellResultSchema = EffectSchema.Struct({
  exitCode: EffectSchema.NullOr(EffectSchema.Int),
  stdout: output,
  stderr: output,
  truncated: EffectSchema.Boolean,
  timedOut: EffectSchema.Boolean,
});

export type MacShellResult = typeof macShellResultSchema.Type;

const macCommandRefusalSchema = EffectSchema.Struct({
  refused: EffectSchema.String.check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(MAC_COMMAND_BOUNDS.MAX_OUTPUT_CHARS),
  ),
});

export type MacCommandRefusal = typeof macCommandRefusalSchema.Type;

export const macCommandResultSchema = EffectSchema.Union([
  macShellResultSchema,
  macCommandRefusalSchema,
]);

export type MacCommandResult = typeof macCommandResultSchema.Type;

export const macCommandSettleRequestSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  result: macCommandResultSchema,
});

export const macCommandSettledAnswerSchema = EffectSchema.Struct({
  settled: EffectSchema.Literal(true),
});

export const macCommandClaimRequestSchema = EffectSchema.Struct({
  id: wireUuidSchema,
});

export const macCommandClaimAnswerSchema = EffectSchema.Struct({
  command: macCommandSchema,
});

export const macCommandListeningAnswerSchema = EffectSchema.Struct({
  listening: EffectSchema.Literal(true),
});
