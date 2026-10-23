/**
 * wire.ts -- the four things every side of the Gateway boundary does with
 * the protocol: hand a value the build already made to the wire, refuse a
 * parameter that is not the shape its method takes, read a method's
 * parameters by its schema, and read one event kind under a guard.
 */
import { unparsedWire, type WireRecord, type WireValue } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Result, type Schema } from "effect";
import type { GatewayClient } from "./host.js";
import { type GatewayEventKind, InvalidParamsRefusal } from "./protocol.js";

/** A value this build made, carried as the JSON it already is; every field of these shapes is a wire value. */
export function carried<Value>(value: Value): WireValue {
  // SAFETY: the values carried here (settings, snapshots, rosters, offers, Conversation entries, event properties) are the structured-clone payloads the bridge already guarded; each is JSON data.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The protocol carries JSON; the domain type is set aside at this one boundary.
  return value as unknown as WireValue;
}

/** A parameter that is not the shape its method takes, as the protocol's own refusal. */
export function invalid(message: string): Effect.Effect<never, InvalidParamsRefusal> {
  return Effect.fail(new InvalidParamsRefusal({ message }));
}

/** A method's parameters read by its schema, or the invalid-params refusal `sentence` words. */
export function readParams<Params>(
  schema: Schema.Codec<Params, unknown>,
  params: WireRecord,
  sentence: string,
): Effect.Effect<Params, InvalidParamsRefusal> {
  const result = readEither(schema)(unparsedWire(params));
  return Result.isFailure(result) ? invalid(sentence) : Effect.succeed(result.success);
}

/**
 * One client's event subscription, bound once: each kind is delivered only
 * when its own reader accepted the payload, so no listener sees a shape the
 * host never sent.
 */
export function gatewayEventReader(client: GatewayClient) {
  return <Payload>(
    kind: GatewayEventKind,
    read: (payload: WireValue) => Payload | undefined,
    listener: (payload: Payload) => void,
  ) =>
    client.on(kind, (event) => {
      const payload = read(event);
      if (payload !== undefined) listener(payload);
    });
}
