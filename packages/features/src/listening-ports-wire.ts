import { Schema as EffectSchema } from "effect";
import { SANDBOX_STATE } from "./terminal-wire.js";

/**
 * listening-ports-wire.ts -- the TCP ports a server listens on in a coding agent's cloud sandbox, as the desktop's Forward to localhost control lists them.
 *
 * The list is read from the sandbox itself each time it is asked, and only
 * while the sandbox is running: a read never wakes a stopped sandbox, and
 * answers where it stands with no ports instead. It holds the ports a
 * member's or the agent's own server may take, never one below
 * `LISTENING_PORTS.MIN_PORT`, and none of our own listeners in the
 * sandbox. An agent on a Mac has no sandbox, and lists none.
 */

/** The ports the list may hold: the unprivileged range, which no server in the sandbox needs root for. */
export const LISTENING_PORTS = {
  MIN_PORT: 1_024,
  MAX_PORT: 65_535,
} as const;

/** A port a server listens on in the sandbox. */
const listeningPortSchema = EffectSchema.Int.check(
  EffectSchema.isBetween({ minimum: LISTENING_PORTS.MIN_PORT, maximum: LISTENING_PORTS.MAX_PORT }),
);

/** Where the agent's sandbox stands, and the ports listened on in it, the lowest first; none unless it is running. */
export const listeningPortsAnswerSchema = EffectSchema.Struct({
  sandbox: EffectSchema.Literals(Object.values(SANDBOX_STATE)),
  ports: EffectSchema.Array(listeningPortSchema),
});

export type ListeningPortsAnswer = typeof listeningPortsAnswerSchema.Type;
