/**
 * listening-ports-wire.ts -- the TCP ports a server listens on in a coding agent's cloud sandbox, as the desktop's Forward to localhost control lists them.
 *
 * The list is read from the sandbox itself each time it is asked, and only
 * while the sandbox is running: a read never wakes a stopped sandbox, and
 * answers that it is not running, with no ports, instead. It holds the
 * ports a member's or the agent's own server listens on, and none of our
 * own listeners in the sandbox. An agent on a Mac has no sandbox, and lists
 * none.
 */

import { Schema as EffectSchema } from "effect";

/** Whether the agent's sandbox is running, and the ports listened on in it, the lowest first; none unless it is running. */
export const listeningPortsAnswerSchema = EffectSchema.Struct({
  running: EffectSchema.Boolean,
  ports: EffectSchema.Array(EffectSchema.Int),
});

export type ListeningPortsAnswer = typeof listeningPortsAnswerSchema.Type;

/** Whether turning forwarding on started the repository's run command: only where no port listened and its `.vespin.json` names one. */
export const forwardingStartAnswerSchema = EffectSchema.Struct({
  started: EffectSchema.Boolean,
});

export type ForwardingStartAnswer = typeof forwardingStartAnswerSchema.Type;
