/**
 * github-rate-gate.ts -- every request the deployment sends GitHub's API, sent a few at a time, spaced where it writes, and held back on every instance while GitHub says it is rate limited.
 *
 * GitHub's own guidance is the design
 * (https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api,
 * https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api):
 * make requests serially rather than concurrently, since its secondary limit
 * refuses past a hundred at once; wait at least a second between each POST,
 * PATCH, PUT, or DELETE; and on a 403 or 429 for a rate limit, ask nothing
 * again before `retry-after` seconds have passed, or before
 * `x-ratelimit-reset` where `x-ratelimit-remaining` is 0, or else before a
 * minute has, waiting exponentially longer as the refusals repeat, because
 * an integration that keeps asking while limited may be banned.
 *
 * So the instance's `HttpClient` is wrapped: a request that writes waits its
 * identity's turn, one write at a time, until `GATE.MUTATIVE_SPACING` after
 * the last one under that identity started; a request to the API then waits
 * for one of `GATE.CONCURRENCY` places; and a refusal that names a rate
 * limit holds every later request under the same bearer's identity until
 * GitHub said it may ask again. A request asked while held is not sent; it
 * is answered here as GitHub would answer it, a 429 with the `retry-after`
 * left, marked `GATE.HELD_MARK`, so every caller reads the refusal it
 * already handles. Any answer under 400 once the hold is over lifts the
 * identity's backoff. A 403 whose message is read here is still the
 * caller's to read, since the response keeps its body once read.
 *
 * Note that every installation token and the App's own JWT share one
 * identity, because an installation's tokens are minted per repository and
 * per permission set, and a hold on one token would leave its siblings
 * asking; a member's own token is its own identity, as GitHub limits it
 * apart. Note too that a hold is written to the database as well as kept
 * here (`@luke/database/models/github-rate-holds`), so one instance's
 * refusal holds every instance, rather than each finding the limit with a
 * request of its own. An instance reads an identity's shared hold at most
 * once per `GATE.SHARED_READ_FOR`, so it may still send a request in the
 * seconds after another instance was refused; and a database that does not
 * answer holds nothing, because GitHub is never kept waiting on it. The
 * places and the spacing are the instance's alone.
 */

import { createHash } from "node:crypto";
import type { DatabaseServices } from "@luke/database/core/query";
import {
  type GitHubRateHold,
  holdGitHubIdentity,
  liftGitHubRateHold,
  readGitHubRateHold,
} from "@luke/database/models/github-rate-holds";
import { Clock, Duration, Effect, Layer, Option, Semaphore } from "effect";
import * as Headers from "effect/http/Headers";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

const GATE = {
  /** How many requests to the API one instance has out at once. */
  CONCURRENCY: 6,
  /** The wait GitHub asks for a rate limit that names none, and the first step of the backoff. */
  MINIMUM_HOLD: Duration.minutes(1),
  /** The longest a repeated refusal is backed off. */
  MAXIMUM_HOLD: Duration.minutes(15),
  /** The least time between the starts of two requests that write under one identity. */
  MUTATIVE_SPACING: Duration.seconds(1),
  /** How long an instance trusts its last read of an identity's shared hold. */
  SHARED_READ_FOR: Duration.seconds(5),
  /** The header a held answer carries, so a log or a test can tell it from GitHub's own. */
  HELD_MARK: "x-luke-github-held",
} as const;

const GITHUB_API_HOST = "api.github.com";

/** The statuses GitHub answers a rate limit with. */
const RATE_LIMIT_STATUS = { FORBIDDEN: 403, TOO_MANY_REQUESTS: 429 } as const;

/** Below this an answer is not a refusal, and lifts the backoff. */
const FIRST_REFUSAL_STATUS = 400;

/** The words GitHub's message carries for a secondary limit that sends neither header. */
const RATE_LIMIT_WORDS = /rate limit/iu;

/** The bearer prefixes of the App's installation tokens and of its own JWT, which share one identity. */
const APP_BEARERS = /^(?:bearer|token)\s+(?:ghs_|ey)/iu;

const IDENTITY = { APP: "app", ANONYMOUS: "anonymous" } as const;

/** The methods GitHub asks a second between: the ones that write. */
const MUTATIVE_METHODS: ReadonlySet<string> = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/** One identity's standing hold: when it lifts, and how many refusals in a row it follows. */
interface Hold {
  readonly until: number;
  readonly strikes: number;
}

/** The instance's last read of one identity's shared hold: when it was read, and the hold, where one stood. */
interface SharedRead {
  readonly readAt: number;
  readonly hold: Hold | undefined;
}

/** One identity's turn to write, and how many writes are in it or waiting on it. */
interface Writer {
  readonly turn: Semaphore.Semaphore;
  readonly waiting: number;
}

/** What one refusal said of a rate limit: whether it was one, and how long GitHub asked to wait where it said. */
interface Refusal {
  readonly limited: boolean;
  readonly stated: Duration.Duration | undefined;
}

const NOT_LIMITED: Refusal = { limited: false, stated: undefined };

function header(response: HttpClientResponse.HttpClientResponse, name: string): string | undefined {
  return Option.getOrUndefined(Headers.get(response.headers, name));
}

/** The identity GitHub limits the request under: the App, nobody, or a member's own token by its digest alone. */
function identityOf(request: HttpClientRequest.HttpClientRequest): string {
  const authorization = request.headers.authorization;
  if (authorization === undefined) return IDENTITY.ANONYMOUS;
  if (APP_BEARERS.test(authorization)) return IDENTITY.APP;
  return createHash("sha256").update(authorization).digest("hex");
}

/** The identity's kind alone, as a log line may carry it: never a member token's digest. */
function loggedIdentity(identity: string): string {
  return identity === IDENTITY.APP || identity === IDENTITY.ANONYMOUS ? identity : "member";
}

function toGitHubApi(request: HttpClientRequest.HttpClientRequest): boolean {
  return URL.canParse(request.url) && new URL(request.url).host === GITHUB_API_HOST;
}

/**
 * Whether an answer is GitHub refusing for a rate limit, and the wait it
 * named: `retry-after` in seconds, else the time left to
 * `x-ratelimit-reset` where nothing remains. A 403 naming neither is read
 * for GitHub's message, since a secondary limit may send no header; the
 * body is kept by the response, so the caller still reads it.
 */
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

/** The backoff the refusal numbered `strikes` in a row waits at least, before what GitHub named. */
function backoffFor(strikes: number): Duration.Duration {
  return Duration.min(Duration.times(GATE.MINIMUM_HOLD, 2 ** (strikes - 1)), GATE.MAXIMUM_HOLD);
}

/**
 * How long a refusal holds its identity: the wait GitHub named, or a minute
 * where it named none, the first time; each refusal after that in a row
 * waits at least twice as long as the one before. The backoff stops growing
 * at `GATE.MAXIMUM_HOLD`, but a wait GitHub named is kept whole, since a
 * primary limit's reset may be most of an hour away.
 */
function holdFor(refusal: Refusal, strikes: number): Duration.Duration {
  const floor = strikes === 1 ? Duration.zero : backoffFor(strikes);
  return Duration.max(refusal.stated ?? GATE.MINIMUM_HOLD, floor);
}

/**
 * The milliseconds each refusal in a row holds for, from the first to the
 * first whose backoff reached `GATE.MAXIMUM_HOLD`, which stands for every
 * one after it: `holdFor` as the shared hold's one statement reads it, so
 * the rule is stated once.
 */
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

/** The answer a held request gets in place of being sent: GitHub's own 429, with the seconds left. */
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

/**
 * The instance's client with the gate around every request to GitHub's API;
 * any other request passes as it was. Built once per instance, as the
 * runtime's layers are, so the places, the spacing, and the reads of the
 * shared holds are the instance's; the holds themselves are every
 * instance's, through the database the layer is built over.
 */
export const githubRateGate: Layer.Layer<
  HttpClient.HttpClient,
  never,
  HttpClient.HttpClient | DatabaseServices
> = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const database = yield* Effect.context<DatabaseServices>();
    const places = yield* Semaphore.make(GATE.CONCURRENCY);
    const holds = new Map<string, Hold>();
    const shared = new Map<string, SharedRead>();
    const nextWrite = new Map<string, number>();
    const writers = new Map<string, Writer>();

    const remembered = (identity: string, now: number, hold: Hold | undefined) =>
      Effect.sync(() => {
        // Note that a read past trusting is let go here, so a member token asked once is not kept.
        for (const [kept, read] of shared) {
          if (now - read.readAt >= Duration.toMillis(GATE.SHARED_READ_FOR)) shared.delete(kept);
        }
        shared.set(identity, { readAt: now, hold });
      });

    /** A statement on the shared holds, which logs its failure and answers nothing rather than keep GitHub waiting. */
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

    /** The identity's shared hold as last read, read again once that read is past trusting. */
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

    /**
     * The write runs in the identity's turn: one write under an identity at
     * a time, each waiting first until `GATE.MUTATIVE_SPACING` after the
     * last one started, so the wait holds no place a read could be sent in.
     * A turn no write waits on is let go, so a member token that wrote once
     * keeps none.
     */
    const inTurn = <A, E, R>(identity: string, write: Effect.Effect<A, E, R>) =>
      Effect.suspend(() => {
        const writer = writers.get(identity) ?? { turn: Semaphore.makeUnsafe(1), waiting: 0 };
        writers.set(identity, { ...writer, waiting: writer.waiting + 1 });
        const waited = Effect.flatMap(Clock.currentTimeMillis, (now) => {
          const next = nextWrite.get(identity) ?? now;
          return next > now ? Effect.sleep(Duration.millis(next - now)) : Effect.void;
        });
        return writer.turn
          .withPermits(1)(Effect.andThen(waited, write))
          .pipe(
            Effect.ensuring(
              Effect.sync(() => {
                const standing = writers.get(identity);
                if (standing === undefined) return;
                if (standing.waiting <= 1) writers.delete(identity);
                else writers.set(identity, { ...standing, waiting: standing.waiting - 1 });
              }),
            ),
          );
      });

    /** Books the start of a write under the identity at `now`, which the next write waits a second past. */
    const started = (identity: string, now: number) => {
      // Note that a booking already past is let go, so a member token that wrote once is not kept.
      for (const [kept, next] of nextWrite) {
        if (next <= now) nextWrite.delete(kept);
      }
      nextWrite.set(identity, now + Duration.toMillis(GATE.MUTATIVE_SPACING));
    };

    /** Lets go of the shared hold an answer came after, where the instance last read one now over. */
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

    /** Writes the refusal's hold where every instance reads it, answering the hold as it stands there now. */
    const heldEverywhere = Effect.fnUntraced(function* (
      identity: string,
      refusal: Refusal,
      now: number,
    ) {
      // Note that a hold lifted more than `GATE.MAXIMUM_HOLD` ago counts no strike, as the instance's own holds are let go then.
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
      // Note that an answer sent before the refusal and landing after it
      // lifts nothing, because the hold GitHub asked for still stands.
      if (response.status < FIRST_REFUSAL_STATUS) {
        const now = yield* Clock.currentTimeMillis;
        const standing = holds.get(identity);
        if (standing === undefined || now >= standing.until) holds.delete(identity);
        yield* lifted(identity, now);
        return;
      }
      // Note that the hold standing is read only once the refusal is, because
      // reading its message waits on GitHub, and a longer hold another
      // refusal set meanwhile must not be written over.
      const refusal = yield* refusalOf(response, yield* Clock.currentTimeMillis);
      if (!refusal.limited) return;
      const now = yield* Clock.currentTimeMillis;
      // Note that a hold long lifted is let go before this refusal is
      // counted, so it counts no strike, as the shared hold's statement
      // reads it, and a member token refused once and never again is not kept.
      for (const [kept, standing] of holds) {
        if (standing.until + Duration.toMillis(GATE.MAXIMUM_HOLD) < now) holds.delete(kept);
      }
      const standing = holds.get(identity);
      const holding = standing !== undefined && now < standing.until;
      // Note that refusals of requests already out as the hold began are
      // one strike, not one each, so a burst does not jump the backoff.
      const strikes = (standing?.strikes ?? 0) + (holding ? 0 : 1);
      const hold = holdFor(refusal, strikes);
      const until = Math.max(standing?.until ?? 0, now + Duration.toMillis(hold));
      holds.set(identity, { until, strikes });
      const everywhere = yield* heldEverywhere(identity, refusal, now);
      // The identity's kind and GitHub's own counters alone: nothing of the bearer or the request.
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
      // Note that the hold is read once a place is had, because a request
      // that queued behind the refusal must not be sent after it; this
      // instance's own hold is read first, and the shared one only where
      // that holds nothing.
      const writes = MUTATIVE_METHODS.has(request.method);
      const gated = places.withPermits(1)(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const local = holds.get(identity);
          const held =
            local !== undefined && now < local.until ? local : yield* sharedHold(identity, now);
          if (held !== undefined && now < held.until) return heldAnswer(request, held.until - now);
          // Note that a write books its start only now, as it is sent, so a
          // write that waited for its place still starts a second after the
          // last; one held, or given up on before this, books nothing.
          if (writes) started(identity, yield* Clock.currentTimeMillis);
          const response = yield* sent;
          yield* noted(identity, response);
          return response;
        }),
      );
      // Note that a write waits its turn before it takes a place, and reads the hold after, so the wait holds no place and misses no hold set meanwhile.
      return writes ? inTurn(identity, gated) : gated;
    });
  }),
);
