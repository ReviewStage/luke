import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Result, type Schema } from "effect";
import { Base64 } from "effect/encoding";

/**
 * image-body.ts -- an image a hosted read answered as its bytes, read whole and spelled in base64 for a window to draw from a `data:` URL of its own making.
 *
 * The host fetches the bytes under the account, so a window holds no bearer
 * and no address; what it hears is the type and the base64. An inbox
 * attachment and a workspace's photo are both read this way, each held to
 * the types its own wire names.
 */

/** An image's bytes in base64 under its media type. */
export interface ImageBody<Type extends string> {
  readonly contentType: Type;
  readonly base64: string;
}

/** The response's bytes in base64 under the type it named, or nothing where the type is none `types` admits or the body could not be read. */
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
