/**
 * listening-ports-wire.ts -- the TCP ports a server listens on in a coding agent's cloud sandbox, as the desktop's Forward to localhost control lists them, and the one port shared by public link.
 *
 * The list is read from the sandbox itself each time it is asked, and only
 * while the sandbox is running: a read never wakes a stopped sandbox, and
 * answers that it is not running, with no ports, instead. It holds the
 * ports a member's or the agent's own server listens on, and none of our
 * own listeners in the sandbox. An agent on a Mac has no sandbox, and lists
 * none.
 *
 * One of those ports may be shared at a time by a public link, which anyone
 * holding it can open: Vercel's own route into the running sandbox. Sharing
 * another port replaces the first, and a link no one has visited for ten
 * minutes stops on its own.
 */

import { Schema as EffectSchema } from "effect";
import { FORWARD_PORT } from "./sandbox-tunnel-wire.js";

/** Whether the agent's sandbox is running, and the ports listened on in it, the lowest first; none unless it is running. */
export const listeningPortsAnswerSchema = EffectSchema.Struct({
  running: EffectSchema.Boolean,
  ports: EffectSchema.Array(EffectSchema.Int),
});

export type ListeningPortsAnswer = typeof listeningPortsAnswerSchema.Type;

/** The port to share, one a forward may name. */
export const portShareRequestSchema = EffectSchema.Struct({
  port: EffectSchema.Int.check(
    EffectSchema.isBetween({ minimum: FORWARD_PORT.MIN, maximum: FORWARD_PORT.MAX }),
  ),
});

export type PortShareRequest = typeof portShareRequestSchema.Type;

/** The public link the shared port opens at. */
export const portShareAnswerSchema = EffectSchema.Struct({ url: EffectSchema.String });

export type PortShareAnswer = typeof portShareAnswerSchema.Type;

/** The port shared now and its public link; none where no port is shared or the sandbox is not running. */
export const sharedPortAnswerSchema = EffectSchema.Struct({
  shared: EffectSchema.NullOr(
    EffectSchema.Struct({ port: EffectSchema.Int, url: EffectSchema.String }),
  ),
});

export type SharedPortAnswer = typeof sharedPortAnswerSchema.Type;
