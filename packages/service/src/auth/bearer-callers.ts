/**
 * bearer-callers.ts -- the callers one instance resolved from a bearer, kept for a minute.
 *
 * Every hosted request resolves its caller (`bearer.ts`), and a held read
 * re-asks every twenty seconds with a poll inside it every half second, each
 * of which asked the auth service, and through it the account store, afresh.
 * The instance keeps what the auth service answered for a bearer instead, so
 * it asks once a minute per bearer. This module imports nothing of the auth
 * service, so the web services layer (`runtime.ts`) builds it without loading
 * Better Auth.
 */

import { createHash } from "node:crypto";
import { Cache, Context, Duration, Effect, Exit, Layer, Option } from "effect";
import type { OAuthUserInfo, UserInfoEndpoint } from "./bearer.js";
import { CREDENTIAL_HEADER } from "./session-credential.js";

/**
 * How long one instance keeps the caller a bearer resolved to. It is the one
 * knob of a security trade-off: a token the auth service has since revoked,
 * or one that has since expired, still resolves for this long on an instance
 * that resolved it just before.
 */
export const BEARER_CALLER_TTL = Duration.seconds(60);

/** How many bearers one instance keeps at once, the least recently asked dropped first. */
const BEARER_CALLER_CAPACITY = 500;

/** What a bearer is kept under: the SHA-256 of its `Authorization` value, never the value itself. */
function bearerDigest(authorization: string): string {
  return createHash("sha256").update(authorization).digest("hex");
}

/** The instance's kept callers. */
export class BearerCallers extends Context.Service<
  BearerCallers,
  {
    /** `ask`, answered from what the instance kept of the bearer, and kept where it names a subject. */
    readonly through: (ask: UserInfoEndpoint) => UserInfoEndpoint;
  }
>()("BearerCallers") {}

/**
 * The kept callers, built once per instance. Only a subject the auth service
 * named is kept: a refusal, an answer naming nobody, and a failure of the
 * auth service are asked again on the next request, so a token issued a
 * moment ago works at once. Note that the cache is read and written by hand
 * rather than through its own lookup, because a lookup is handed only the
 * key, and the key is the digest: the token is never kept, as a key or in
 * the context of a kept lookup's fiber.
 */
export const bearerCallersLayer = Layer.effect(
  BearerCallers,
  Effect.gen(function* () {
    const kept = yield* Cache.makeWith(
      (_digest: string): Effect.Effect<Option.Option<OAuthUserInfo>> => Effect.succeedNone,
      {
        capacity: BEARER_CALLER_CAPACITY,
        timeToLive: (exit) =>
          Exit.isSuccess(exit) && Option.isSome(exit.value) ? BEARER_CALLER_TTL : Duration.zero,
      },
    );
    const through =
      (ask: UserInfoEndpoint): UserInfoEndpoint =>
      (input) =>
        Effect.gen(function* () {
          const authorization = input.headers.get(CREDENTIAL_HEADER.AUTHORIZATION);
          if (authorization === null) return yield* ask(input);
          const digest = bearerDigest(authorization);
          const standing = Option.flatten(yield* Cache.getSuccess(kept, digest));
          if (Option.isSome(standing)) return standing.value;
          const answer = yield* ask(input);
          if (answer?.sub) yield* Cache.set(kept, digest, Option.some(answer));
          return answer;
        });
    return { through };
  }),
);
