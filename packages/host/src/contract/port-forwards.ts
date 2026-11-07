import {
  portForwardingAnswerSchema,
  portForwardSetParamsSchema,
} from "@repo/features/port-forward-acts";
import { ACT } from "@repo/sync";
import { contractOf, declaredActs, hostAct } from "./declared-act.js";

/**
 * port-forwards.ts -- Forward to localhost as the panel reaches the host for it: an agent's forwarding turned on or off, declared.
 *
 * The host's port forwards concern answers it (`compose-port-forwards.ts`),
 * since it listens on the Mac's loopback; a host without that concern, a
 * browser tab's, refuses it. Only a panel draws the control. It carries an
 * agent's id and port numbers alone, never a byte a forwarded connection
 * carries.
 */

/** Forward to localhost's one act, answered by the port forwards composer. */
export const PORT_FORWARD_ACTS = declaredActs({
  PORT_FORWARD_SET: hostAct({
    input: portForwardSetParamsSchema,
    output: portForwardingAnswerSchema,
    refusal: "Could not forward this agent's ports.",
    panelOnly: true,
    // Note that turning forwarding on asks the service to start it, and its state is this Mac's listeners, never a row.
    door: ACT.REMOTE_WORK,
  }),
});

export const portForwardActsContract = contractOf(PORT_FORWARD_ACTS);
