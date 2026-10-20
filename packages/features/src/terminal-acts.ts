/**
 * terminal.ts -- what a Terminal tab says to the main process and hears back: its acts' payloads and answers, and the messages on the port each attached shell gets.
 *
 * A Terminal tab belongs to one coding agent's sandbox. Its acts carry ids,
 * sizes, and names, never a byte a shell printed; the bytes travel on one
 * `MessagePort` per attached shell, posted by main to the panel that asked
 * and to no other window, so nothing a shell prints ever enters app state,
 * an act, a trace, or the voice window. The port is posted on its own channel with a ticket naming the
 * shell; the preload hands it into the page the way Electron hands a port to
 * an isolated world, and the page reads it back by that channel.
 */

import { Schema as EffectSchema } from "effect";
import {
  TERMINAL_CONNECTION,
  type TerminalRefusal as TerminalViewRefusal,
  terminalShellParamsSchema,
  TERMINAL_FLOW as VIEW_FLOW,
} from "./terminal-view.js";

// The vocabulary the host answers the tab in is the host's own (`terminal-view.ts`), named here so the tab reads one contract.
export {
  TERMINAL_CONNECTION,
  TERMINAL_REFUSAL,
  type TerminalConnection,
  terminalAgentParamsSchema,
  terminalCreatedActAnswerSchema,
  terminalCreateParamsSchema,
  terminalRenameParamsSchema,
  terminalResumedActAnswerSchema,
  terminalShellParamsSchema,
  terminalsActAnswerSchema,
} from "./terminal-view.js";

/**
 * How the tab paces its acks and cuts its input, in the bytes and characters
 * the host counts them in.
 *
 * @public Read by the Terminal tab (desktop PRs 6–9), which lands above this contract.
 */
export const TERMINAL_FLOW = VIEW_FLOW;

/** @public Read by the Terminal tab, above this contract. */
export type TerminalRefusal = TerminalViewRefusal;

/** The channel each attached shell's port is posted on. */
export const TERMINAL_PORT_CHANNEL = "terminal:port";

/**
 * The kinds of message on a shell's port.
 *
 * @public Read by the Terminal tab (desktop PRs 6–9) and the host's terminal
 * client (PR 4's implementation), which land above this contract.
 */
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

/**
 * What the renderer sends on a shell's port, read by main before anything is sent on.
 *
 * @public Read by the Terminal tab (desktop PRs 6–9) and the host's terminal
 * client (PR 4's implementation), which land above this contract.
 */
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

/** @public Read by the Terminal tab and the host's terminal client, above this contract. */
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
