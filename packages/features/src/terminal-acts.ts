/**
 * terminal-acts.ts -- what a Terminal tab says to the main process and hears back: its acts' payloads, and the messages on the port each attached shell gets.
 *
 * A cloud agent's Terminal tab holds shells on this Mac, opened in the
 * agent's mirror (`@repo/host/contract`'s `mac-shells.ts`). Its acts carry ids,
 * sizes, and names, never a byte a shell printed; the bytes travel on one
 * `MessagePort` per attached shell, posted by main to the panel that asked
 * and to no other window, so nothing a shell prints ever enters app state,
 * an act, or a trace. The port is posted on its own channel with a ticket naming the
 * shell; the preload hands it into the page the way Electron hands a port to
 * an isolated world, and the page reads it back by that channel.
 */

import { Schema as EffectSchema } from "effect";

/** How a shell's connection stands, as its port says it. */
export const TERMINAL_CONNECTION = {
  /** Connected to the shell; what follows on the port is what it prints. */
  ATTACHED: "attached",
  /** The shell ended, its exit status in `code`. */
  EXITED: "exited",
} as const;

export type TerminalConnection = (typeof TERMINAL_CONNECTION)[keyof typeof TERMINAL_CONNECTION];

const id = EffectSchema.String.check(EffectSchema.isMinLength(1), EffectSchema.isMaxLength(64));

/**
 * How a shell's output is paced to what the tab has drawn, and the bounds of
 * what the tab sends. Both ends count output in bytes, as the port's
 * `Uint8Array` carries it, never characters: the tab acks every
 * `ACK_EVERY_BYTES` it has written, main stops reading the shell once
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

/** The channel each attached shell's port is posted on. */
export const TERMINAL_PORT_CHANNEL = "terminal:port";

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
  /** renderer → main: how many bytes of output xterm has written since the last ack. */
  ACK: "ack",
} as const;

const size = (maximum: number) =>
  EffectSchema.Int.check(EffectSchema.isBetween({ minimum: 1, maximum }));

/** An attach: the shell, and the terminal's size its connection opens at. */
export const terminalAttachParamsSchema = EffectSchema.Struct({
  ...terminalShellParamsSchema.fields,
  cols: size(TERMINAL_FLOW.MAX_COLUMNS),
  rows: size(TERMINAL_FLOW.MAX_ROWS),
});

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
    bytes: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0)),
  }),
]);

export type TerminalPortInbound = typeof terminalPortInboundSchema.Type;

/**
 * What main sends on a shell's port: bytes the shell printed, or how the
 * connection stands, its exit status on `exited`. The tab reads each message
 * through it before anything reaches the screen.
 */
export const terminalPortOutboundSchema = EffectSchema.Union([
  EffectSchema.Struct({
    type: EffectSchema.Literal(TERMINAL_PORT_MESSAGE.OUTPUT),
    data: EffectSchema.Uint8Array,
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(TERMINAL_PORT_MESSAGE.STATE),
    state: EffectSchema.Literals(Object.values(TERMINAL_CONNECTION)),
    code: EffectSchema.optional(EffectSchema.Int),
  }),
]);

export type TerminalPortOutbound = typeof terminalPortOutboundSchema.Type;
