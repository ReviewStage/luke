/**
 * terminal.ts -- what a Terminal tab says to the main process and hears back: its acts' payloads and answers, and the messages on the port each attached shell gets.
 *
 * A Terminal tab belongs to one coding agent's sandbox. Its acts carry ids,
 * sizes, and names, never a byte a shell printed; the bytes travel on one
 * `MessagePort` per attached shell, posted by main to the panel that asked
 * and to no other window, so nothing a shell prints ever enters app state,
 * an act, a trace, or the voice window (`docs/proposals/terminal-architecture.md`
 * §11). The port is posted on its own channel with a ticket naming the
 * shell; the preload hands it into the page the way Electron hands a port to
 * an isolated world, and the page reads it back by that channel.
 */

import {
  sandboxResumedAnswerSchema,
  terminalCreatedAnswerSchema,
  terminalsAnswerSchema,
} from "@sidecar/features/terminal-wire";
import { Schema as EffectSchema } from "effect";

/** The channel each attached shell's port is posted on. */
export const TERMINAL_PORT_CHANNEL = "terminal:port";

/** How a shell's connection stands, as the port's `state` message says it. */
export const TERMINAL_CONNECTION = {
  /** The socket is opening; the first message on a new port. */
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

/** The kinds of message on a shell's port. */
export const TERMINAL_PORT_MESSAGE = {
  /** main → renderer: what the shell printed, to `xterm.write`. */
  OUTPUT: "output",
  /** main → renderer: how the connection stands. */
  STATE: "state",
  /** renderer → main: what xterm's `onData` gave. */
  INPUT: "input",
  /** renderer → main: the terminal's size, from the fit addon. */
  RESIZE: "resize",
  /** renderer → main: how many characters xterm has written since the last ack. */
  ACK: "ack",
} as const;

export const TERMINAL_FLOW = {
  /** How many characters xterm writes between acks. */
  ACK_EVERY_CHARS: 5_000,
  /** How many characters may stand unacked before main pauses the socket. */
  PAUSE_ABOVE_CHARS: 100_000,
  /** The most characters one input message carries: a paste is cut into messages of this size. */
  MAX_INPUT_CHARS: 65_536,
  /** The widest and tallest a terminal is taken to be. */
  MAX_COLUMNS: 1_000,
  MAX_ROWS: 1_000,
} as const;

/** Why a terminal act could not be done, where the tab has something to say of it; an outage is the act's own refusal. */
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

const id = EffectSchema.String.check(EffectSchema.isMinLength(1), EffectSchema.isMaxLength(64));
const size = (maximum: number) =>
  EffectSchema.Int.check(EffectSchema.isBetween({ minimum: 1, maximum }));
const title = EffectSchema.String.check(EffectSchema.isMinLength(1), EffectSchema.isMaxLength(60));

/** An act that names an agent. */
export const terminalAgentParamsSchema = EffectSchema.Struct({ agentId: id });

/** An act that names one of an agent's shells. */
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

export const terminalAttachParamsSchema = EffectSchema.Struct({
  agentId: id,
  terminalId: id,
  cols: size(TERMINAL_FLOW.MAX_COLUMNS),
  rows: size(TERMINAL_FLOW.MAX_ROWS),
});

/** A refusal the tab reads, in place of the answer. */
const refusedSchema = EffectSchema.Struct({
  refused: EffectSchema.Literals(Object.values(TERMINAL_REFUSAL)),
});

/** The agent's shells and where its sandbox stands, or why not: `terminal.list`, `terminal.rename`, `terminal.kill`. */
export const terminalsActAnswerSchema = EffectSchema.Union([terminalsAnswerSchema, refusedSchema]);

/** The shell started, or why not: `terminal.create`. */
export const terminalCreatedActAnswerSchema = EffectSchema.Union([
  terminalCreatedAnswerSchema,
  refusedSchema,
]);

/** Where the sandbox stands after a resume, or why not: `terminal.resume`. */
export const terminalResumedActAnswerSchema = EffectSchema.Union([
  sandboxResumedAnswerSchema,
  refusedSchema,
]);

export type TerminalsActAnswer = typeof terminalsActAnswerSchema.Type;
export type TerminalCreatedActAnswer = typeof terminalCreatedActAnswerSchema.Type;
export type TerminalResumedActAnswer = typeof terminalResumedActAnswerSchema.Type;
export type TerminalAgentParams = typeof terminalAgentParamsSchema.Type;
export type TerminalShellParams = typeof terminalShellParamsSchema.Type;
export type TerminalCreateParams = typeof terminalCreateParamsSchema.Type;
export type TerminalRenameParams = typeof terminalRenameParamsSchema.Type;
export type TerminalAttachParams = typeof terminalAttachParamsSchema.Type;

/** The ticket a shell's port is posted with, naming the shell it carries. */
export const terminalPortTicketSchema = terminalShellParamsSchema;

export type TerminalPortTicket = typeof terminalPortTicketSchema.Type;

/** What the renderer sends on a shell's port, read by main before anything is sent on. */
export const terminalPortInboundSchema = EffectSchema.Union([
  EffectSchema.Struct({
    type: EffectSchema.Literal(TERMINAL_PORT_MESSAGE.INPUT),
    data: EffectSchema.String.check(EffectSchema.isMaxLength(TERMINAL_FLOW.MAX_INPUT_CHARS)),
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(TERMINAL_PORT_MESSAGE.RESIZE),
    cols: size(TERMINAL_FLOW.MAX_COLUMNS),
    rows: size(TERMINAL_FLOW.MAX_ROWS),
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(TERMINAL_PORT_MESSAGE.ACK),
    chars: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0)),
  }),
]);

export type TerminalPortInbound = typeof terminalPortInboundSchema.Type;

/** What main sends on a shell's port: bytes the shell printed, or how the connection stands. */
export type TerminalPortOutbound =
  | { readonly type: typeof TERMINAL_PORT_MESSAGE.OUTPUT; readonly data: Uint8Array }
  | {
      readonly type: typeof TERMINAL_PORT_MESSAGE.STATE;
      readonly state: TerminalConnection;
      /** The shell's exit status, on `exited`. */
      readonly code?: number;
    };
