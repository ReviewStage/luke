import type { MaybePromise } from "@sidecar/runtime/vocabulary";
import type { WireRecord, WireValue } from "@sidecar/wire";
import type { Effect } from "effect";
import type {
  GatewayClientIdentity,
  GatewayError,
  GatewayErrorCode,
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

/** What one method answers: a result, or a typed error the envelope carries back. */
export type GatewayMethodOutcome =
  | { ok: true; result?: WireValue }
  | { ok: false; error: GatewayError };

export function gatewayOk(result?: WireValue): GatewayMethodOutcome {
  return { ok: true, ...(result !== undefined ? { result } : undefined) };
}

export function gatewayError(code: GatewayErrorCode, message: string): GatewayMethodOutcome {
  return { ok: false, error: { code, message } };
}

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

export type GatewayMethodHandler = (
  params: WireRecord,
  context: GatewayMethodContext,
) => MaybePromise<GatewayMethodOutcome>;

export type GatewayMethodTable = Partial<Record<GatewayMethod, GatewayMethodHandler>>;

/** A method handler as the server runs it: an effect answering a wire value or nothing, failing with one of the refusal family. */
export type GatewayMethodEffect = (
  params: WireRecord,
  context: GatewayMethodContext,
) => Effect.Effect<WireValue | undefined, GatewayRefusal>;

export type GatewayMethodEffectTable = Partial<Record<GatewayMethod, GatewayMethodEffect>>;
