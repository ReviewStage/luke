import { unparsedWire, type WireRecord, type WireValue } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Effect, Result, type Schema } from "effect";
import type { GatewayClient } from "./host.js";
import { type GatewayEventKind, InvalidParamsRefusal } from "./protocol.js";

export function carried<Value>(value: Value): WireValue {
  return value as unknown as WireValue;
}

export function invalid(message: string): Effect.Effect<never, InvalidParamsRefusal> {
  return Effect.fail(new InvalidParamsRefusal({ message }));
}

export function readParams<Params>(
  schema: Schema.Codec<Params, unknown>,
  params: WireRecord,
  sentence: string,
): Effect.Effect<Params, InvalidParamsRefusal> {
  const result = readEither(schema)(unparsedWire(params));
  return Result.isFailure(result) ? invalid(sentence) : Effect.succeed(result.success);
}

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
