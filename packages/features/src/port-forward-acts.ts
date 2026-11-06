/**
 * port-forward-acts.ts -- what the panel's Forward to localhost control says to the desktop and hears back: forwarding read and turned on or off for one coding agent, and how each of its forwarded ports stands.
 *
 * The desktop's host forwards one agent's ports at a time: while forwarding
 * is on, every port the service detects listening in the agent's cloud
 * sandbox (`listening-ports-wire.ts`) is listened on at this Mac's
 * `127.0.0.1`, on the same port where it is free and the next free one
 * where it is not, and each connection it accepts is carried over the
 * service's tunnel (`sandbox-tunnel-wire.ts`). The acts carry ids and port
 * numbers alone; no byte a connection carries ever enters an act, app
 * state, or a trace.
 */

import { Schema as EffectSchema } from "effect";

/** How one forwarded port stands on this Mac. */
export const PORT_FORWARD_STATE = {
  /** Listened on at its local port, with no tunnel open: the next connection opens one. */
  LISTENING: "listening",
  /** Listened on, its tunnel open and carrying connections. */
  CONNECTED: "connected",
  /** No local port near it was free, so it is not forwarded. */
  UNAVAILABLE: "unavailable",
} as const;

/** A call that names the agent whose forwarding it reads or turns. */
export const portForwardAgentParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
});

/** Forwarding turned on or off for an agent; on for one turns it off for any other. */
export const portForwardSetParamsSchema = EffectSchema.Struct({
  ...portForwardAgentParamsSchema.fields,
  on: EffectSchema.Boolean,
});

/** One port forwarded: the sandbox's, the local one it is listened on where it has one, and how it stands. */
const forwardedPortSchema = EffectSchema.Struct({
  port: EffectSchema.Int,
  localPort: EffectSchema.optional(EffectSchema.Int),
  state: EffectSchema.Literals(Object.values(PORT_FORWARD_STATE)),
});

/**
 * An agent's forwarding as it stands: whether it is on, whether its sandbox
 * was running at the last look, and its forwarded ports, the lowest first;
 * off, not running, and none for any agent but the one forwarded.
 */
export const portForwardingAnswerSchema = EffectSchema.Struct({
  on: EffectSchema.Boolean,
  running: EffectSchema.Boolean,
  ports: EffectSchema.Array(forwardedPortSchema),
});

export type PortForwardingAnswer = typeof portForwardingAnswerSchema.Type;
