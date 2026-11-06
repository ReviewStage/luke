import type { WireRecord, WireValue } from "@repo/wire";
import type { Effect } from "effect";
import type { GatewayClientIdentity, GatewayMethod, GatewayRefusal } from "./protocol.js";

export interface GatewayMethodContext {
  client: GatewayClientIdentity;
}

export type GatewayMethodHandler = (
  params: WireRecord,
  context: GatewayMethodContext,
) => Effect.Effect<WireValue | undefined, GatewayRefusal>;

export type GatewayMethodTable = Partial<Record<GatewayMethod, GatewayMethodHandler>>;
