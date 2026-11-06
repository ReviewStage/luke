import { createHash } from "node:crypto";
import { Cache, Context, Duration, Effect, Exit, Layer, Option } from "effect";
import type { OAuthUserInfo, UserInfoEndpoint } from "./bearer.js";
import { CREDENTIAL_HEADER } from "./session-credential.js";

export const BEARER_CALLER_TTL = Duration.seconds(60);

const BEARER_CALLER_CAPACITY = 500;

function bearerDigest(authorization: string): string {
  return createHash("sha256").update(authorization).digest("hex");
}

export class BearerCallers extends Context.Service<
  BearerCallers,
  {
    readonly through: (ask: UserInfoEndpoint) => UserInfoEndpoint;
  }
>()("BearerCallers") {}

class AskingBearer extends Context.Service<
  AskingBearer,
  { readonly input: { headers: Headers }; readonly ask: UserInfoEndpoint }
>()("AskingBearer") {}

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
    const asking = yield* Cache.makeWith(
      (_digest: string) =>
        Effect.gen(function* () {
          const { input, ask } = yield* AskingBearer;
          return yield* ask(input);
        }),
      {
        capacity: BEARER_CALLER_CAPACITY,
        requireServicesAt: "lookup",
        timeToLive: () => Duration.zero,
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
          const answer = yield* Cache.get(asking, digest).pipe(
            Effect.provideService(AskingBearer, { input, ask }),
          );
          if (answer?.sub) yield* Cache.set(kept, digest, Option.some(answer));
          return answer;
        });
    return { through };
  }),
);
