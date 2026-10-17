import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber } from "effect";
import type { LoopbackAuthorization, LoopbackConsentOptions, LoopbackExchange } from "./consent.js";
import { loopbackConsent } from "./loopback-consent.js";

interface Grant {
  token: string;
}

const PAGES = {
  granted: { badge: "Connected", title: "Connected to Example", body: "Close this tab." },
  notGranted: { badge: "Not connected", title: "Sign-in didn’t complete", body: "Try again." },
} as const;

const REASON = {
  REFUSED: "Example did not grant access.",
  TIMED_OUT: "Sign-in timed out. Try again from the Example row.",
} as const;

/**
 * The trip under test, with the browser and the exchange recorded rather than
 * performed. `armed` settles with the authorization the trip composed, which
 * is the moment the loopback is listening and the tab would have opened.
 */
function harness(
  armed: Deferred.Deferred<LoopbackAuthorization>,
  overrides: Partial<LoopbackConsentOptions<Grant>> = {},
) {
  const opened: string[] = [];
  const authorizations: LoopbackAuthorization[] = [];
  const exchanges: LoopbackExchange[] = [];
  const consent = loopbackConsent<Grant>({
    callbackPath: "/consent/callback",
    pages: PAGES,
    reasons: { refused: REASON.REFUSED, timedOut: REASON.TIMED_OUT },
    authorizationUrl: (input) => {
      authorizations.push(input);
      Deferred.doneUnsafe(armed, Exit.succeed(input));
      return `https://example.test/consent?state=${encodeURIComponent(input.state)}`;
    },
    exchange: (input) =>
      Effect.sync(() => {
        exchanges.push(input);
        return { token: "granted" };
      }),
    openExternal: (url) => {
      opened.push(url);
    },
    ...overrides,
  });
  return { consent, opened, authorizations, exchanges };
}

/** One trip in a scope of its own, the way a press runs one. */
function trip(consent: ReturnType<typeof harness>["consent"]) {
  return Effect.forkChild(Effect.scoped(consent.signInEffect()));
}

/**
 * The authorization the trip composed, read once the trip has armed itself on
 * it: the tab opened and the page held for reopening. Composing the page is
 * what settles `armed`, and a fiber that completes a Deferred resumes its
 * waiters on its own stack, so a read of `armed` alone lands inside the trip's
 * own compose, a statement ahead of the browser. The scheduler turn is what
 * stands between the two.
 */
function armedTrip(
  armed: Deferred.Deferred<LoopbackAuthorization>,
): Effect.Effect<LoopbackAuthorization> {
  return Effect.gen(function* () {
    const authorization = yield* Deferred.await(armed);
    yield* Effect.yieldNow;
    return authorization;
  });
}

/**
 * Follows the redirect the browser would make. On its own connection every
 * time: a trip may bind a registered port rather than an ephemeral one, so a
 * pooled socket left over from an earlier trip would be reused against a
 * server that has since closed.
 */
function answerCallback(
  redirectUri: string,
  parameters: Record<string, string>,
): Promise<{ status: number; body: string; location: string | undefined }> {
  const callback = new URL(redirectUri);
  for (const [name, value] of Object.entries(parameters)) {
    callback.searchParams.set(name, value);
  }
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        host: callback.hostname,
        port: callback.port,
        path: `${callback.pathname}${callback.search}`,
        agent: false,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body, location: response.headers.location }),
        );
      },
    );
    request.on("error", reject);
  });
}

function callback(
  redirectUri: string,
  parameters: Record<string, string>,
): Effect.Effect<{ status: number; body: string; location: string | undefined }> {
  return Effect.promise(() => answerCallback(redirectUri, parameters));
}

it.effect("one trip runs press to grant, with the PKCE pair the exchange answers for", () =>
  Effect.gen(function* () {
    const armed = yield* Deferred.make<LoopbackAuthorization>();
    const { consent, opened, exchanges } = harness(armed);

    const waiting = yield* trip(consent);
    const authorization = yield* armedTrip(armed);
    assert.deepEqual(opened, [
      `https://example.test/consent?state=${encodeURIComponent(authorization.state)}`,
    ]);

    const answered = yield* callback(authorization.redirectUri, {
      state: authorization.state,
      code: "auth-code",
    });
    assert.equal(answered.status, 200);
    assert.deepEqual(yield* Fiber.join(waiting), { token: "granted" });

    // SAFETY: The granted callback above ran the exchange exactly once.
    const exchange = exchanges[0] as LoopbackExchange;
    assert.equal(exchange.code, "auth-code");
    assert.equal(exchange.redirectUri, authorization.redirectUri);
    assert.equal(
      authorization.codeChallenge,
      createHash("sha256").update(exchange.codeVerifier, "ascii").digest("base64url"),
    );
  }),
);

it.effect(
  "a grant with somewhere to continue sends the browser on, and hands the exchange its state",
  () =>
    Effect.gen(function* () {
      const armed = yield* Deferred.make<LoopbackAuthorization>();
      const { consent, exchanges } = harness(armed, {
        continueTo: (grant) => Effect.succeed(`https://example.test/next?for=${grant.token}`),
      });

      const waiting = yield* trip(consent);
      const authorization = yield* armedTrip(armed);
      const answered = yield* callback(authorization.redirectUri, {
        state: authorization.state,
        code: "auth-code",
      });

      assert.equal(answered.status, 303);
      assert.equal(answered.location, "https://example.test/next?for=granted");
      assert.deepEqual(yield* Fiber.join(waiting), { token: "granted" });
      assert.equal(exchanges[0]?.state, authorization.state);
    }),
);

it.effect("a refusal lands on its card whatever the flow would continue to", () =>
  Effect.gen(function* () {
    const armed = yield* Deferred.make<LoopbackAuthorization>();
    const { consent } = harness(armed, {
      continueTo: () => Effect.succeed("https://example.test/next"),
    });

    const waiting = yield* trip(consent);
    const authorization = yield* armedTrip(armed);
    const answered = yield* callback(authorization.redirectUri, {
      state: authorization.state,
      error: "access_denied",
    });

    assert.equal(answered.status, 200);
    assert.equal(answered.location, undefined);
    assert.deepEqual(yield* Fiber.join(waiting), { reason: REASON.REFUSED });
  }),
);

it.effect("another path, or a state this trip never issued, is refused without settling", () =>
  Effect.gen(function* () {
    const armed = yield* Deferred.make<LoopbackAuthorization>();
    const { consent } = harness(armed);

    const waiting = yield* trip(consent);
    const authorization = yield* Deferred.await(armed);

    const forged = yield* callback(authorization.redirectUri, {
      state: "not-it",
      code: "stolen",
    });
    assert.equal(forged.status, 404);

    const strayPath = new URL(authorization.redirectUri);
    strayPath.pathname = "/somewhere-else";
    const stray = yield* callback(strayPath.toString(), { state: authorization.state });
    assert.equal(stray.status, 404);

    // The real redirect was still on its way, and the trip was still listening.
    const genuine = yield* callback(authorization.redirectUri, {
      state: authorization.state,
      code: "auth-code",
    });
    assert.equal(genuine.status, 200);
    assert.deepEqual(yield* Fiber.join(waiting), { token: "granted" });
  }),
);
