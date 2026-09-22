/**
 * methods.ts -- what a host's method handler is handed and what it answers.
 * A handler table is written against these shapes wherever the host composes
 * one, and the dispatcher in `./host` runs it.
 */
import type { WireRecord, WireValue } from "@sidecar/wire";
import type { Effect } from "effect";
import type { GatewayClientIdentity, GatewayMethod, GatewayRefusal } from "./protocol.js";

/** Who is asking, as the process declared itself when the host was built. */
export interface GatewayMethodContext {
  client: GatewayClientIdentity;
}

/**
 * A method handler as the dispatcher runs it: an effect answering the wire
 * value the method's result is, or nothing where the method answers no value,
 * and failing with one of the protocol's own refusals.
 */
export type GatewayMethodHandler = (
  params: WireRecord,
  context: GatewayMethodContext,
) => Effect.Effect<WireValue | undefined, GatewayRefusal>;

export type GatewayMethodTable = Partial<Record<GatewayMethod, GatewayMethodHandler>>;
