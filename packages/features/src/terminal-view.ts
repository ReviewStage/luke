import { Schema as EffectSchema } from "effect";
import {
  sandboxResumedAnswerSchema,
  terminalCreatedAnswerSchema,
  terminalsAnswerSchema,
} from "./terminal-wire.js";

export const TERMINAL_REFUSAL = {
  SANDBOX_STOPPED: "sandbox-stopped",
  SANDBOX_SNAPSHOT_GONE: "sandbox-snapshot-gone",
  AGENT_NOT_READY: "agent-not-ready",
  NOT_FOUND: "not-found",
  SANDBOX_UNANSWERED: "sandbox-unanswered",
  GONE: "gone",
} as const;

export type TerminalRefusal = (typeof TERMINAL_REFUSAL)[keyof typeof TERMINAL_REFUSAL];

export const TERMINAL_CONNECTION = {
  CONNECTING: "connecting",
  ATTACHED: "attached",
  RECONNECTING: "reconnecting",
  IDLE: "idle",
  STOPPED: "stopped",
  STARTING: "starting",
  EXITED: "exited",
  GONE: "gone",
  UNAVAILABLE: "unavailable",
} as const;

export type TerminalConnection = (typeof TERMINAL_CONNECTION)[keyof typeof TERMINAL_CONNECTION];

const id = EffectSchema.String.check(EffectSchema.isMinLength(1), EffectSchema.isMaxLength(64));
const size = (maximum: number) =>
  EffectSchema.Int.check(EffectSchema.isBetween({ minimum: 1, maximum }));
const title = EffectSchema.String.check(EffectSchema.isMinLength(1), EffectSchema.isMaxLength(60));

export const TERMINAL_FLOW = {
  ACK_EVERY_BYTES: 5_000,
  PAUSE_ABOVE_BYTES: 100_000,
  RESUME_BELOW_BYTES: 5_000,
  MAX_INPUT_CHARS: 65_536,
  MAX_COLUMNS: 1_000,
  MAX_ROWS: 1_000,
} as const;

export const terminalAgentParamsSchema = EffectSchema.Struct({ agentId: id });

export const terminalShellParamsSchema = EffectSchema.Struct({ agentId: id, terminalId: id });

export const terminalCreateParamsSchema = EffectSchema.Struct({
  agentId: id,
  title: EffectSchema.optional(title),
});

export const terminalRenameParamsSchema = EffectSchema.Struct({
  agentId: id,
  terminalId: id,
  title,
});

export const terminalConnectParamsSchema = EffectSchema.Struct({
  connectionId: id,
  agentId: id,
  terminalId: id,
  cols: size(TERMINAL_FLOW.MAX_COLUMNS),
  rows: size(TERMINAL_FLOW.MAX_ROWS),
});

export const terminalConnectionParamsSchema = EffectSchema.Struct({ connectionId: id });

export const terminalInputParamsSchema = EffectSchema.Struct({
  connectionId: id,
  data: EffectSchema.String.check(EffectSchema.isMaxLength(TERMINAL_FLOW.MAX_INPUT_CHARS)),
});

export const terminalResizeParamsSchema = EffectSchema.Struct({
  connectionId: id,
  cols: size(TERMINAL_FLOW.MAX_COLUMNS),
  rows: size(TERMINAL_FLOW.MAX_ROWS),
});

export const terminalAckParamsSchema = EffectSchema.Struct({
  connectionId: id,
  bytes: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0)),
});

const refusedSchema = EffectSchema.Struct({
  refused: EffectSchema.Literals(Object.values(TERMINAL_REFUSAL)),
});

export const terminalsActAnswerSchema = EffectSchema.Union([terminalsAnswerSchema, refusedSchema]);

export const terminalCreatedActAnswerSchema = EffectSchema.Union([
  terminalCreatedAnswerSchema,
  refusedSchema,
]);

export const terminalResumedActAnswerSchema = EffectSchema.Union([
  sandboxResumedAnswerSchema,
  refusedSchema,
]);

export type TerminalsActAnswer = typeof terminalsActAnswerSchema.Type;
export type TerminalCreatedActAnswer = typeof terminalCreatedActAnswerSchema.Type;
export type TerminalResumedActAnswer = typeof terminalResumedActAnswerSchema.Type;

export const terminalOutputEventSchema = EffectSchema.Struct({
  connectionId: id,
  data: EffectSchema.String,
});

export const terminalStateEventSchema = EffectSchema.Struct({
  connectionId: id,
  state: EffectSchema.Literals(Object.values(TERMINAL_CONNECTION)),
  code: EffectSchema.optional(EffectSchema.Int),
});

export type TerminalStateEvent = typeof terminalStateEventSchema.Type;
