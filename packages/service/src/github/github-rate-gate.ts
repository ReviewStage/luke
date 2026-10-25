/**
 * github-rate-gate.ts -- every request an instance sends GitHub's API, sent a few at a time and held back while GitHub says it is rate limited.
 *
 * GitHub's own guidance is the design
 * (https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api,
 * https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api):
 * make requests serially rather than concurrently, since its secondary limit
 * refuses past a hundred at once; and on a 403 or 429 for a rate limit, ask
 * nothing again before `retry-after` seconds have passed, or before
 * `x-ratelimit-reset` where `x-ratelimit-remaining` is 0, or else before a
 * minute has, waiting exponentially longer as the refusals repeat, because
 * an integration that keeps asking while limited may be banned.
 *
 * So the instance's `HttpClient` is wrapped: a request to the API waits for
 * one of `GATE.CONCURRENCY` places, and a refusal that names a rate limit
 * holds every later request under the same bearer's identity until GitHub
 * said it may ask again. A request asked while held is not sent; it is
 * answered here as GitHub would answer it, a 429 with the `retry-after` left,
 * marked `GATE.HELD_MARK`, so every caller reads the refusal it already
 * handles. Any answer under 400 lifts the identity's backoff.
 *
 * Note that every installation token and the App's own JWT share one
 * identity, because an installation's tokens are minted per repository and
 * per permission set, and a hold on one token would leave its siblings
 * asking; a member's own token is its own identity, as GitHub limits it
 * apart. Note too that the gate is the instance's alone: another instance
 * finds the limit with one request of its own and holds from there.
 */

import { createHash } from "node:crypto";
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

/** One identity's standing hold: when it lifts, and how many refusals in a row it follows. */
interface Hold {
  readonly until: number;
  readonly strikes: number;
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

/**
 * How long a refusal holds its identity: the wait GitHub named, or a minute
 * where it named none, the first time; each refusal after that in a row
 * waits at least twice as long as the one before, never past
 * `GATE.MAXIMUM_HOLD`.
 */
function holdFor(refusal: Refusal, strikes: number): Duration.Duration {
  const backoff = Duration.times(GATE.MINIMUM_HOLD, 2 ** (strikes - 1));
  const floor = strikes === 1 ? Duration.zero : backoff;
  const wanted = Duration.max(refusal.stated ?? GATE.MINIMUM_HOLD, floor);
  return Duration.min(wanted, GATE.MAXIMUM_HOLD);
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
 * runtime's layers are, so the places and the holds are the instance's.
 */
export const githubRateGate: Layer.Layer<HttpClient.HttpClient, never, HttpClient.HttpClient> =
  Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const places = yield* Semaphore.make(GATE.CONCURRENCY);
      const holds = new Map<string, Hold>();

      const noted = Effect.fnUntraced(function* (
        identity: string,
        response: HttpClientResponse.HttpClientResponse,
      ) {
        const now = yield* Clock.currentTimeMillis;
        if (response.status < FIRST_REFUSAL_STATUS) {
          holds.delete(identity);
          return;
        }
        const refusal = yield* refusalOf(response, now);
        if (!refusal.limited) return;
        const strikes = (holds.get(identity)?.strikes ?? 0) + 1;
        const hold = holdFor(refusal, strikes);
        // Note that a hold long lifted is let go here, so a member token refused once and never again is not kept.
        for (const [kept, standing] of holds) {
          if (standing.until + Duration.toMillis(GATE.MAXIMUM_HOLD) < now) holds.delete(kept);
        }
        holds.set(identity, { until: now + Duration.toMillis(hold), strikes });
        // The identity's kind and GitHub's own counters alone: nothing of the bearer or the request.
        yield* Effect.logWarning("github: rate limited; holding requests", {
          identity:
            identity === IDENTITY.APP || identity === IDENTITY.ANONYMOUS ? identity : "member",
          status: response.status,
          remaining: header(response, "x-ratelimit-remaining"),
          reset: header(response, "x-ratelimit-reset"),
          retryAfter: header(response, "retry-after"),
          resource: header(response, "x-ratelimit-resource"),
          heldForSeconds: Duration.toSeconds(hold),
          strikes,
        });
      });

      return HttpClient.transform(client, (sent, request) => {
        if (!toGitHubApi(request)) return sent;
        const identity = identityOf(request);
        // Note that the hold is read once a place is had, because a request
        // that queued behind the refusal must not be sent after it.
        return places.withPermits(1)(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const held = holds.get(identity);
            if (held !== undefined && now < held.until)
              return heldAnswer(request, held.until - now);
            const response = yield* sent;
            yield* noted(identity, response);
            return response;
          }),
        );
      });
    }),
  );
