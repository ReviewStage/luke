import { Schema as EffectSchema } from "effect";
import {
  TERMINAL_CONNECTION,
  type TerminalRefusal as TerminalViewRefusal,
  terminalShellParamsSchema,
  TERMINAL_FLOW as VIEW_FLOW,
} from "./terminal-view.js";

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

/** @public */
export const TERMINAL_FLOW = VIEW_FLOW;

/** @public */
export type TerminalRefusal = TerminalViewRefusal;

export const TERMINAL_PORT_CHANNEL = "terminal:port";

/** @public */
export const TERMINAL_PORT_MESSAGE = {
  OUTPUT: "output",
  STATE: "state",
  INPUT: "input",
  RESIZE: "resize",
  ACK: "ack",
} as const;

const size = (maximum: number) =>
  EffectSchema.Int.check(EffectSchema.isBetween({ minimum: 1, maximum }));

export const terminalAttachParamsSchema = EffectSchema.Struct({
  ...terminalShellParamsSchema.fields,
  cols: size(TERMINAL_FLOW.MAX_COLUMNS),
  rows: size(TERMINAL_FLOW.MAX_ROWS),
});

export const terminalPortTicketSchema = terminalShellParamsSchema;

export type TerminalPortTicket = typeof terminalPortTicketSchema.Type;

/** @public */
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

/** @public */
export type TerminalPortInbound = typeof terminalPortInboundSchema.Type;

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
