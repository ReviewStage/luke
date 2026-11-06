import {
  portForwardingAnswerSchema,
  portForwardSetParamsSchema,
} from "@repo/features/port-forward-acts";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { PORT_FORWARD_ACT_KIND } from "./kinds.js";

/**
 * port-forwards.ts -- Forward to localhost as the panel reaches main for it: an agent's forwarding turned on or off, as a procedure.
 *
 * Main answers them itself (`act-port/port-forward-procedures.ts`), since
 * its host listens on the Mac's loopback; a browser tab refuses it. It
 * carries an agent's id and port numbers alone, never a byte a forwarded
 * connection carries.
 */
export const portForwardActsContract = {
  [PORT_FORWARD_ACT_KIND.PORT_FORWARD_SET]: actProcedure("Could not forward this agent's ports.")
    .input(exactInput(portForwardSetParamsSchema))
    .output(EffectSchema.flip(portForwardingAnswerSchema)),
};
