import { createHash } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import {
  type GitHubRateHold,
  holdGitHubIdentity,
  liftGitHubRateHold,
  readGitHubRateHold,
} from "@repo/database/models/github-rate-holds";
import { Clock, Context, Duration, Effect, Layer, Option, Semaphore } from "effect";
import * as Headers from "effect/http/Headers";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

const GATE = {
  MINIMUM_HOLD: Duration.minutes(1),
  MAXIMUM_HOLD: Duration.minutes(15),
  MUTATIVE_SPACING: Duration.seconds(1),
  SHARED_READ_FOR: Duration.seconds(5),
  HELD_MARK: "x-app-github-held",
} as const;

const GITHUB_API_HOST = "api.github.com";

export const GitHubBackground = Context.Reference<boolean>("@repo/service/GitHubBackground", {
  defaultValue: () => false,
});

const RATE_LIMIT_STATUS = { FORBIDDEN: 403, TOO_MANY_REQUESTS: 429 } as const;

const FIRST_REFUSAL_STATUS = 400;

const RATE_LIMIT_WORDS = /rate limit/iu;

const APP_BEARERS = /^(?:bearer|token)\s+(?:ghs_|ey)/iu;

const IDENTITY = { APP: "app", ANONYMOUS: "anonymous" } as const;

const MUTATIVE_METHODS: ReadonlySet<string> = new Set(["POST", "PATCH", "PUT", "DELETE"]);

interface Hold {
  readonly until: number;
  readonly strikes: number;
}

interface SharedRead {
  readonly readAt: number;
  readonly hold: Hold | undefined;
}

interface Lane {
  readonly turn: Semaphore.Semaphore;
  readonly waiting: number;
}

interface Refusal {
  readonly limited: boolean;
  readonly stated: Duration.Duration | undefined;
}

const NOT_LIMITED: Refusal = { limited: false, stated: undefined };

function header(response: HttpClientResponse.HttpClientResponse, name: string): string | undefined {
  return Option.getOrUndefined(Headers.get(response.headers, name));
}

function identityOf(request: HttpClientRequest.HttpClientRequest): string {
  const authorization = request.headers.authorization;
  if (authorization === undefined) return IDENTITY.ANONYMOUS;
  if (APP_BEARERS.test(authorization)) return IDENTITY.APP;
  return createHash("sha256").update(authorization).digest("hex");
}

function loggedIdentity(identity: string): string {
  return identity === IDENTITY.APP || identity === IDENTITY.ANONYMOUS ? identity : "member";
}

function toGitHubApi(request: HttpClientRequest.HttpClientRequest): boolean {
  return URL.canParse(request.url) && new URL(request.url).host === GITHUB_API_HOST;
}

const refusalOf = Effect.fnUntraced(function* (
  response: HttpClientResponse.HttpClientResponse,
  now: number,
) {
  const status = response.status;
  if (status !== RATE_LIMIT_STATUS.FORBIDDEN && status !== RATE_LIMIT_STATUS.TOO_MANY_REQUESTS) {
    return NOT_LIMITED;
  }
  const retryAfter = header(response, "retry-after")?.trim();
  if (retryAfter !== undefined && /^\d+$/u.test(retryAfter)) {
    return { limited: true, stated: Duration.seconds(Number(retryAfter)) };
  }
  const reset = Number(header(response, "x-ratelimit-reset"));
  if (header(response, "x-ratelimit-remaining") === "0" && Number.isFinite(reset)) {
    return { limited: true, stated: Duration.millis(Math.max(0, reset * 1000 - now)) };
  }
  if (status === RATE_LIMIT_STATUS.TOO_MANY_REQUESTS) return { limited: true, stated: undefined };
  const message = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
  return RATE_LIMIT_WORDS.test(message) ? { limited: true, stated: undefined } : NOT_LIMITED;
});

export function rateLimited(
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<boolean, never, never> {
  return Effect.map(
    Effect.flatMap(Clock.currentTimeMillis, (now) => refusalOf(response, now)),
    (refusal) => refusal.limited,
  );
}

function backoffFor(strikes: number): Duration.Duration {
  return Duration.min(Duration.times(GATE.MINIMUM_HOLD, 2 ** (strikes - 1)), GATE.MAXIMUM_HOLD);
}

function holdFor(refusal: Refusal, strikes: number): Duration.Duration {
  const floor = strikes === 1 ? Duration.zero : backoffFor(strikes);
  return Duration.max(refusal.stated ?? GATE.MINIMUM_HOLD, floor);
}

function waitsFor(refusal: Refusal): [number, ...number[]] {
  const waits: [number, ...number[]] = [Duration.toMillis(holdFor(refusal, 1))];
  let strikes = 1;
  while (Duration.isLessThan(backoffFor(strikes), GATE.MAXIMUM_HOLD)) {
    strikes += 1;
    waits.push(Duration.toMillis(holdFor(refusal, strikes)));
  }
  return waits;
}

function holdOf(stored: GitHubRateHold): Hold {
  return { until: stored.heldUntil.getTime(), strikes: stored.strikes };
}

function heldAnswer(
  request: HttpClientRequest.HttpClientRequest,
  left: number,
): HttpClientResponse.HttpClientResponse {
  const seconds = Math.max(1, Math.ceil(left / 1000));
  return HttpClientResponse.fromWeb(
    request,
    Response.json(
      { message: "API rate limit exceeded; held until GitHub's wait is over." },
      {
        status: RATE_LIMIT_STATUS.TOO_MANY_REQUESTS,
        headers: { "retry-after": String(seconds), [GATE.HELD_MARK]: "1" },
      },
    ),
  );
}

export const githubRateGate: Layer.Layer<
  HttpClient.HttpClient,
  never,
  HttpClient.HttpClient | DatabaseServices
> = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const database = yield* Effect.context<DatabaseServices>();
    const holds = new Map<string, Hold>();
    const shared = new Map<string, SharedRead>();
    const nextWrite = new Map<string, number>();
    const writers = new Map<string, Lane>();
    const senders = new Map<string, Lane>();
    const backgroundSenders = new Map<string, Lane>();

    const remembered = (identity: string, now: number, hold: Hold | undefined) =>
      Effect.sync(() => {
        for (const [kept, read] of shared) {
          if (now - read.readAt >= Duration.toMillis(GATE.SHARED_READ_FOR)) shared.delete(kept);
        }
        shared.set(identity, { readAt: now, hold });
      });

    const unblocking = <A, E>(
      statement: Effect.Effect<A, E, DatabaseServices>,
      identity: string,
      failed: string,
    ): Effect.Effect<A | undefined> =>
      statement.pipe(
        Effect.catch((error) =>
          Effect.as(
            Effect.logWarning(failed, { identity: loggedIdentity(identity), error: String(error) }),
            undefined,
          ),
        ),
        Effect.provideContext(database),
      );

    const sharedHold = Effect.fnUntraced(function* (identity: string, now: number) {
      const read = shared.get(identity);
      if (read !== undefined && now - read.readAt < Duration.toMillis(GATE.SHARED_READ_FOR)) {
        return read.hold;
      }
      const stored = yield* unblocking(
        readGitHubRateHold(identity),
        identity,
        "github: shared rate hold unread; sending",
      );
      const hold = stored === undefined ? undefined : holdOf(stored);
      yield* remembered(identity, now, hold);
      return hold;
    });

    const inLane = <A, E, R>(
      lanes: Map<string, Lane>,
      identity: string,
      run: Effect.Effect<A, E, R>,
    ) =>
      Effect.suspend(() => {
        const lane = lanes.get(identity) ?? { turn: Semaphore.makeUnsafe(1), waiting: 0 };
        lanes.set(identity, { ...lane, waiting: lane.waiting + 1 });
        return lane.turn
          .withPermits(1)(run)
          .pipe(
            Effect.ensuring(
              Effect.sync(() => {
                const standing = lanes.get(identity);
                if (standing === undefined) return;
                if (standing.waiting <= 1) lanes.delete(identity);
                else lanes.set(identity, { ...standing, waiting: standing.waiting - 1 });
              }),
            ),
          );
      });

    const inTurn = <A, E, R>(identity: string, write: Effect.Effect<A, E, R>) => {
      const waited = Effect.flatMap(Clock.currentTimeMillis, (now) => {
        const next = nextWrite.get(identity) ?? now;
        return next > now ? Effect.sleep(Duration.millis(next - now)) : Effect.void;
      });
      return inLane(writers, identity, Effect.andThen(waited, write));
    };

    const started = (identity: string, now: number) => {
      for (const [kept, next] of nextWrite) {
        if (next <= now) nextWrite.delete(kept);
      }
      nextWrite.set(identity, now + Duration.toMillis(GATE.MUTATIVE_SPACING));
    };

    const lifted = Effect.fnUntraced(function* (identity: string, now: number) {
      const hold = shared.get(identity)?.hold;
      if (hold === undefined || now < hold.until) return;
      yield* remembered(identity, now, undefined);
      yield* unblocking(
        liftGitHubRateHold(identity, new Date(now)),
        identity,
        "github: shared rate hold not lifted",
      );
    });

    const heldEverywhere = Effect.fnUntraced(function* (
      identity: string,
      refusal: Refusal,
      now: number,
    ) {
      const forgottenBefore = new Date(now - Duration.toMillis(GATE.MAXIMUM_HOLD));
      const stored = yield* unblocking(
        holdGitHubIdentity(identity, new Date(now), waitsFor(refusal), forgottenBefore),
        identity,
        "github: shared rate hold unwritten; holding this instance alone",
      );
      if (stored === undefined) return undefined;
      const hold = holdOf(stored);
      yield* remembered(identity, now, hold);
      return hold;
    });

    const noted = Effect.fnUntraced(function* (
      identity: string,
      response: HttpClientResponse.HttpClientResponse,
    ) {
      if (response.status < FIRST_REFUSAL_STATUS) {
        const now = yield* Clock.currentTimeMillis;
        const standing = holds.get(identity);
        if (standing === undefined || now >= standing.until) holds.delete(identity);
        yield* lifted(identity, now);
        return;
      }
      const refusal = yield* refusalOf(response, yield* Clock.currentTimeMillis);
      if (!refusal.limited) return;
      const now = yield* Clock.currentTimeMillis;
      for (const [kept, standing] of holds) {
        if (standing.until + Duration.toMillis(GATE.MAXIMUM_HOLD) < now) holds.delete(kept);
      }
      const standing = holds.get(identity);
      const holding = standing !== undefined && now < standing.until;
      const strikes = (standing?.strikes ?? 0) + (holding ? 0 : 1);
      const hold = holdFor(refusal, strikes);
      const until = Math.max(standing?.until ?? 0, now + Duration.toMillis(hold));
      holds.set(identity, { until, strikes });
      const everywhere = yield* heldEverywhere(identity, refusal, now);
      yield* Effect.logWarning("github: rate limited; holding requests", {
        identity: loggedIdentity(identity),
        status: response.status,
        remaining: header(response, "x-ratelimit-remaining"),
        reset: header(response, "x-ratelimit-reset"),
        retryAfter: header(response, "retry-after"),
        resource: header(response, "x-ratelimit-resource"),
        heldForSeconds: Math.ceil((Math.max(until, everywhere?.until ?? 0) - now) / 1000),
        strikes: everywhere?.strikes ?? strikes,
      });
    });

    return HttpClient.transform(client, (sent, request) => {
      if (!toGitHubApi(request)) return sent;
      const identity = identityOf(request);
      const writes = MUTATIVE_METHODS.has(request.method);
      const send = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const local = () => {
          const standing = holds.get(identity);
          return standing !== undefined && now < standing.until ? standing : undefined;
        };
        const shared = local() === undefined ? yield* sharedHold(identity, now) : undefined;
        const held = local() ?? shared;
        if (held !== undefined && now < held.until) return heldAnswer(request, held.until - now);
        if (writes) started(identity, yield* Clock.currentTimeMillis);
        const response = yield* sent;
        yield* noted(identity, response);
        return response;
      });
      const gated = Effect.flatMap(Effect.service(GitHubBackground), (background) =>
        inLane(background ? backgroundSenders : senders, identity, send),
      );
      return writes ? inTurn(identity, gated) : gated;
    });
  }),
);
