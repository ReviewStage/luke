import { Schema as EffectSchema } from "effect";
import {
  sandboxResumedAnswerSchema,
  terminalCreatedAnswerSchema,
  terminalsAnswerSchema,
} from "./terminal-wire.js";

/**
 * terminal-view.ts -- a coding agent's terminals as the host answers the desktop for them: what each call takes and answers, why one could not be done, and the events an attached shell's connection is heard through.
 *
 * The host speaks Luke's own relay for each attached shell
 * (`terminal-wire.ts`) and answers the desktop through the Gateway: the
 * calls carry ids, sizes, and names; what a shell printed is heard as the
 * connection's own events, named by a connection id the desktop minted for
 * the one panel it posted a port to, so the bytes reach that panel and no
 * other place. A refusal the tab acts on is an answer; an outage is the
 * call's own failure.
 */

/** Why a terminal call could not be done, where the tab has something to say of it. */
export const TERMINAL_REFUSAL = {
  /** The sandbox is stopped, so no shell starts until the developer resumes it. */
  SANDBOX_STOPPED: "sandbox-stopped",
  /** The agent has not opened its sandbox yet. */
  AGENT_NOT_READY: "agent-not-ready",
  /** No such agent or shell, or another workspace's. */
  NOT_FOUND: "not-found",
  /** The agent was archived. */
  GONE: "gone",
} as const;

export type TerminalRefusal = (typeof TERMINAL_REFUSAL)[keyof typeof TERMINAL_REFUSAL];

/** How a shell's connection stands. */
export const TERMINAL_CONNECTION = {
  /** The socket is opening; the first word on a new connection. */
  CONNECTING: "connecting",
  /** Connected, and the shell reattached. */
  ATTACHED: "attached",
  /** The socket dropped — a sleep, a network change, the relay's bound — and the host is reconnecting on its own. */
  RECONNECTING: "reconnecting",
  /** Closed after five minutes without typing; the host does not reconnect until the tab attaches again. */
  IDLE: "idle",
  /** The sandbox is stopped; only the developer's resume brings it back. */
  STOPPED: "stopped",
  /** The agent has not opened its sandbox yet; the host asks again until it has. */
  STARTING: "starting",
  /** The shell ended, its exit status in `code`. */
  EXITED: "exited",
  /** The agent was archived, or the shell was ended elsewhere. */
  GONE: "gone",
} as const;

export type TerminalConnection = (typeof TERMINAL_CONNECTION)[keyof typeof TERMINAL_CONNECTION];

const id = EffectSchema.String.check(EffectSchema.isMinLength(1), EffectSchema.isMaxLength(64));
const size = (maximum: number) =>
  EffectSchema.Int.check(EffectSchema.isBetween({ minimum: 1, maximum }));
const title = EffectSchema.String.check(EffectSchema.isMinLength(1), EffectSchema.isMaxLength(60));

/**
 * How a shell's output is paced to what the tab has drawn, and the bounds of
 * what the tab sends. Both ends count output in bytes, as the port's
 * `Uint8Array` carries it, never characters: the tab acks every
 * `ACK_EVERY_BYTES` it has written, the host stops reading the socket once
 * more than `PAUSE_ABOVE_BYTES` stand unacked, and reads again once fewer
 * than `RESUME_BELOW_BYTES` do. These are VS Code's watermarks.
 */
export const TERMINAL_FLOW = {
  ACK_EVERY_BYTES: 5_000,
  PAUSE_ABOVE_BYTES: 100_000,
  RESUME_BELOW_BYTES: 5_000,
  /** The most characters one input message carries: a paste is cut into messages of this size. */
  MAX_INPUT_CHARS: 65_536,
  /** The widest and tallest a terminal is taken to be. */
  MAX_COLUMNS: 1_000,
  MAX_ROWS: 1_000,
} as const;

/** A call that names an agent. */
export const terminalAgentParamsSchema = EffectSchema.Struct({ agentId: id });

/** A call that names one of an agent's shells. */
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

/** A shell attached for one panel, under the connection id the desktop minted for it. */
export const terminalConnectParamsSchema = EffectSchema.Struct({
  connectionId: id,
  agentId: id,
  terminalId: id,
  cols: size(TERMINAL_FLOW.MAX_COLUMNS),
  rows: size(TERMINAL_FLOW.MAX_ROWS),
});

/** A connection the call names. */
export const terminalConnectionParamsSchema = EffectSchema.Struct({ connectionId: id });

/** What was typed on a connection. */
export const terminalInputParamsSchema = EffectSchema.Struct({
  connectionId: id,
  data: EffectSchema.String.check(EffectSchema.isMaxLength(TERMINAL_FLOW.MAX_INPUT_CHARS)),
});

/** A connection's terminal resized. */
export const terminalResizeParamsSchema = EffectSchema.Struct({
  connectionId: id,
  cols: size(TERMINAL_FLOW.MAX_COLUMNS),
  rows: size(TERMINAL_FLOW.MAX_ROWS),
});

/** How many bytes of a connection's output the terminal has written since the last ack. */
export const terminalAckParamsSchema = EffectSchema.Struct({
  connectionId: id,
  bytes: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0)),
});

/** A refusal the tab reads, in place of the answer. */
const refusedSchema = EffectSchema.Struct({
  refused: EffectSchema.Literals(Object.values(TERMINAL_REFUSAL)),
});

/** The agent's shells and where its sandbox stands, or why not. */
export const terminalsActAnswerSchema = EffectSchema.Union([terminalsAnswerSchema, refusedSchema]);

/** The shell started, or why not. */
export const terminalCreatedActAnswerSchema = EffectSchema.Union([
  terminalCreatedAnswerSchema,
  refusedSchema,
]);

/** Where the sandbox stands after a resume, or why not. */
export const terminalResumedActAnswerSchema = EffectSchema.Union([
  sandboxResumedAnswerSchema,
  refusedSchema,
]);

export type TerminalsActAnswer = typeof terminalsActAnswerSchema.Type;
export type TerminalCreatedActAnswer = typeof terminalCreatedActAnswerSchema.Type;
export type TerminalResumedActAnswer = typeof terminalResumedActAnswerSchema.Type;

/** What a connection's shell printed, its bytes in base64, as the host's event carries it. */
export const terminalOutputEventSchema = EffectSchema.Struct({
  connectionId: id,
  data: EffectSchema.String,
});

/** How a connection stands, as the host's event carries it. */
export const terminalStateEventSchema = EffectSchema.Struct({
  connectionId: id,
  state: EffectSchema.Literals(Object.values(TERMINAL_CONNECTION)),
  code: EffectSchema.optional(EffectSchema.Int),
});

export type TerminalStateEvent = typeof terminalStateEventSchema.Type;
