import { Schema as EffectSchema } from "effect";
import { wireUuidSchema } from "./service-wire.js";

export const SANDBOX_STATE = {
  RUNNING: "running",
  STOPPED: "stopped",
  STARTING: "starting",
} as const;

export type SandboxState = (typeof SANDBOX_STATE)[keyof typeof SANDBOX_STATE];

const TERMINAL_BOUNDS = {
  MAX_TITLE_CHARS: 60,
} as const;

const title = EffectSchema.String.check(
  EffectSchema.isMinLength(1),
  EffectSchema.isMaxLength(TERMINAL_BOUNDS.MAX_TITLE_CHARS),
  EffectSchema.isPattern(/^\P{Cc}+$/u),
);

const terminalSummarySchema = EffectSchema.Struct({
  id: wireUuidSchema,
  title: EffectSchema.String,
  command: EffectSchema.String,
  cwd: EffectSchema.String,
  running: EffectSchema.Boolean,
});

export type TerminalSummary = typeof terminalSummarySchema.Type;

export const terminalsAnswerSchema = EffectSchema.Struct({
  sandbox: EffectSchema.Literals(Object.values(SANDBOX_STATE)),
  terminals: EffectSchema.Array(terminalSummarySchema),
});

export type TerminalsAnswer = typeof terminalsAnswerSchema.Type;

export const terminalCreateRequestSchema = EffectSchema.Struct({
  title: EffectSchema.optional(title),
});

export const terminalCreatedAnswerSchema = EffectSchema.Struct({
  terminal: terminalSummarySchema,
});

export const terminalRenameRequestSchema = EffectSchema.Struct({ title });

export const sandboxResumedAnswerSchema = EffectSchema.Struct({
  sandbox: EffectSchema.Literals(Object.values(SANDBOX_STATE)),
});

export const TERMINAL_RELAY = {
  PATH: "/api/terminal/sessions",
  QUERY: { AGENT: "agent", TERMINAL: "terminal", COLUMNS: "cols", ROWS: "rows" },
} as const;

export const TERMINAL_RELAY_CLOSE = {
  IDLE: 4000,
  STOPPED: 4001,
  STARTING: 4002,
  GONE: 4003,
  EXITED: 4004,
  UNAVAILABLE: 4005,
} as const;

export const TERMINAL_RELAY_FRAME = {
  RESIZE: "resize",
  ATTACHED: "attached",
  EXITED: "exited",
} as const;

export const terminalRelayResizeSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(TERMINAL_RELAY_FRAME.RESIZE),
  cols: EffectSchema.Int.check(EffectSchema.isBetween({ minimum: 1, maximum: 1_000 })),
  rows: EffectSchema.Int.check(EffectSchema.isBetween({ minimum: 1, maximum: 1_000 })),
});

/** @public */
export const terminalRelayServiceFrameSchema = EffectSchema.Union([
  EffectSchema.Struct({ type: EffectSchema.Literal(TERMINAL_RELAY_FRAME.ATTACHED) }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(TERMINAL_RELAY_FRAME.EXITED),
    code: EffectSchema.Int,
  }),
]);
