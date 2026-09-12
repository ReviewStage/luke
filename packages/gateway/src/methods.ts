import type { WireRecord, WireValue } from "@sidecar/wire";
import type { Effect } from "effect";
import type {
  GatewayClientIdentity,
  GatewayMethod,
  GatewayRefusal,
  GatewayRequest,
} from "./protocol.js";
import type { GatewayHostConnection } from "./transport.js";

/**
 * What a host's method handler is handed and what it answers. This is the
 * vocabulary the barrel carries: a handler table is written against these
 * shapes wherever the host composes one, and nothing here reaches
 * `@effect/rpc`, which stays behind the `./server` door that runs the table.
 */

/**
 * What a request said beside its own id. The id is the transport's to echo
 * back on the answer and never a handler's to read, so the Rpc model keeps it
 * out of the handler's reach and this shape leaves it out too.
 */
export type GatewayRequestFields = Omit<GatewayRequest, "id">;

export interface GatewayMethodContext {
  client: GatewayClientIdentity;
  request: GatewayRequestFields;
  /** The connection the request arrived on, when the transport can be asked back through it; a node registers against this. */
  connection?: GatewayHostConnection;
}

/**
 * A method handler as the server runs it: an effect answering the wire value
 * the method's result is, or nothing where the method answers no value, and
 * failing with one of the protocol's own refusals.
 */
export type GatewayMethodHandler = (
  params: WireRecord,
  context: GatewayMethodContext,
) => Effect.Effect<WireValue | undefined, GatewayRefusal>;

export type GatewayMethodTable = Partial<Record<GatewayMethod, GatewayMethodHandler>>;
