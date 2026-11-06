import { unparsedWire } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Effect, Result, type Schema } from "effect";
import { Base64 } from "effect/encoding";

export interface ImageBody<Type extends string> {
  readonly contentType: Type;
  readonly base64: string;
}

export function imageBodyOf<Type extends string>(
  response: Response,
  types: Schema.Codec<Type, Type>,
): Effect.Effect<ImageBody<Type> | undefined> {
  const contentType = Result.getOrUndefined(
    readEither(types)(unparsedWire(response.headers.get("content-type"))),
  );
  if (contentType === undefined) return Effect.succeed(undefined);
  return Effect.promise(() =>
    response
      .arrayBuffer()
      .then(
        (bytes): ImageBody<Type> => ({ contentType, base64: Base64.encode(new Uint8Array(bytes)) }),
      )
      .catch(() => undefined),
  );
}
