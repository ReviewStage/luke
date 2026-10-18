import type { Cause } from "effect";
import { Effect, Option } from "effect";
import { auth } from "./auth.js";

/**
 * browser-session.ts -- the account a Better Auth session names: a browser's own cookie, for the few routes a web page calls and for any hosted route reached with no `Authorization` (`bearer.ts`'s `requestUserId`), or the Mac's signed session bearer, which the bearer plugin reads as that cookie.
 *
 * Better Auth's `getSession` is a promise of somebody else's, so it is
 * wrapped once here. Its failure propagates, so a route can answer an auth
 * outage as unavailable rather than as a signed-out browser sent to a
 * sign-in that cannot succeed. It reads the headers alone, so a caller may
 * hand it a request or only the headers it chose to carry on.
 */
export function resolveBrowserSessionUserId(input: {
  headers: Headers;
}): Effect.Effect<Option.Option<string>, Cause.UnknownError> {
  return Effect.tryPromise(async () => {
    const session = await auth.api.getSession({ headers: input.headers });
    return Option.fromNullishOr(session?.user.id);
  });
}
