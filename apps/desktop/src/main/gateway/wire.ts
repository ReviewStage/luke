import { type GatewayClient, gatewayError } from "@sidecar/runtime";
import { GATEWAY_ERROR, type GatewayEventKind } from "@sidecar/runtime-contracts";
import type { WireValue } from "@sidecar/wire";

/**
 * The three things every side of the Gateway boundary does with the protocol:
 * hand a value the build already made to the wire, refuse a parameter that is
 * not the shape its method takes, and read one event kind under a guard.
 */

/** A value this build made, carried as the JSON it already is; every field of these shapes is a wire value. */
export function carried<Value>(value: Value): WireValue {
  // SAFETY: the values carried here (settings, snapshots, rosters, offers, History entries, event properties) are the structured-clone payloads the bridge already guarded; each is JSON data.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The protocol carries JSON; the domain type is set aside at this one boundary.
  return value as unknown as WireValue;
}

/** A parameter that is not the shape its method takes, as the protocol's own refusal. */
export function invalid(message: string) {
  return gatewayError(GATEWAY_ERROR.INVALID_PARAMS, message);
}

/** Subscribes to one event kind, delivering only payloads its own reader accepted. */
export function onGatewayEvent<Payload>(
  client: GatewayClient,
  kind: GatewayEventKind,
  read: (payload: WireValue) => Payload | undefined,
  listener: (payload: Payload) => void,
) {
  return client.on(kind, (event) => {
    const payload = read(event.payload);
    if (payload !== undefined) listener(payload);
  });
}
