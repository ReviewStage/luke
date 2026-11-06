import type { Cause } from "effect";
import { Effect, Option } from "effect";
import { auth } from "./auth.js";

export function resolveBrowserSessionUserId(input: {
  headers: Headers;
}): Effect.Effect<Option.Option<string>, Cause.UnknownError> {
  return Effect.tryPromise(async () => {
    const session = await auth.api.getSession({ headers: input.headers });
    return Option.fromNullishOr(session?.user.id);
  });
}
