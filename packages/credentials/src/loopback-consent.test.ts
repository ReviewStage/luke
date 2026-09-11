import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { it } from "@effect/vitest";
import { Deferred, Duration, Effect, Either, Exit, Fiber, TestClock } from "effect";
import {
  LOOPBACK_CONSENT_CANCELLED,
  type LoopbackAuthorization,
  type LoopbackConsentOptions,
  type LoopbackConsentOutcome,
  type LoopbackExchange,
  loopbackConsent,
} from "./loopback-consent.js";

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
      Deferred.unsafeDone(armed, Exit.succeed(input));
      return `https://example.test/consent?state=${encodeURIComponent(input.state)}`;
    },
    exchange: async (input) => {
      exchanges.push(input);
      return { token: "granted" };
    },
    openExternal: (url) => {
      opened.push(url);
    },
    ...overrides,
  });
  return { consent, opened, authorizations, exchanges };
}

/** One trip in a scope of its own, the way a press runs one. */
function trip(consent: ReturnType<typeof harness>["consent"]) {
  return Effect.fork(Effect.scoped(consent.signInEffect()));
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
): Promise<{ status: number; body: string }> {
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
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
      },
    );
    request.on("error", reject);
  });
}

function callback(
  redirectUri: string,
  parameters: Record<string, string>,
): Effect.Effect<{ status: number; body: string }> {
  return Effect.promise(() => answerCallback(redirectUri, parameters));
}

/** One port nothing is listening on, and one another server is holding. */
async function borrowPort(): Promise<{ port: number; release: () => Promise<void> }> {
  const server = http.createServer(() => undefined);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  // SAFETY: A TCP server listening on port 0 has an AddressInfo address.
  const { port } = server.address() as AddressInfo;
  return {
    port,
    release: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * Keeps the virtual clock moving until the trip gives up. The deadline is
 * armed inside the trip's own fiber, so a single adjustment could reach the
 * clock before the sleep it is meant to fire.
 */
function untilDeadline(
  waiting: Fiber.Fiber<LoopbackConsentOutcome<Grant>>,
  timeoutMs: number,
): Effect.Effect<LoopbackConsentOutcome<Grant>> {
  return Effect.raceFirst(
    Fiber.join(waiting),
    Effect.forever(
      Effect.zipRight(TestClock.adjust(Duration.millis(timeoutMs)), Effect.yieldNow()),
    ),
  );
}

it.effect("one trip runs press to grant, with the PKCE pair the exchange answers for", () =>
  Effect.gen(function* () {
    const armed = yield* Deferred.make<LoopbackAuthorization>();
    const { consent, opened, exchanges } = harness(armed);

    const waiting = yield* trip(consent);
    const authorization = yield* Deferred.await(armed);
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

it.effect("a state prefix rides in front of the entropy rather than replacing it", () =>
  Effect.gen(function* () {
    const armed = yield* Deferred.make<LoopbackAuthorization>();
    const { consent } = harness(armed, { statePrefix: "github" });

    const waiting = yield* trip(consent);
    const authorization = yield* Deferred.await(armed);
    const [prefix, entropy] = authorization.state.split(".");
    assert.equal(prefix, "github");
    // The entropy after the prefix is unreduced: 32 bytes, base64url.
    assert.equal(Buffer.from(entropy ?? "", "base64url").byteLength, 32);

    consent.cancel();
    assert.deepEqual(yield* Fiber.join(waiting), { reason: LOOPBACK_CONSENT_CANCELLED });
  }),
);

it.effect("a registered port already held is tried past, not reported", () =>
  Effect.gen(function* () {
    const held = yield* Effect.promise(() => borrowPort());
    const free = yield* Effect.promise(() => borrowPort());
    yield* Effect.promise(() => free.release());
    const ports = [held.port, free.port];

    const armed = yield* Deferred.make<LoopbackAuthorization>();
    const { consent } = harness(armed, { ports });
    const waiting = yield* trip(consent);
    const authorization = yield* Deferred.await(armed);
    assert.equal(new URL(authorization.redirectUri).port, String(free.port));

    const answered = yield* callback(authorization.redirectUri, {
      state: authorization.state,
      code: "auth-code",
    });
    assert.equal(answered.status, 200);
    assert.deepEqual(yield* Fiber.join(waiting), { token: "granted" });

    // The browser holds its connection open after the redirect, and a socket it
    // held would keep this registered port bound against the next trip.
    const rearmed = yield* Deferred.make<LoopbackAuthorization>();
    const second = harness(rearmed, { ports });
    const repeated = yield* trip(second.consent);
    const reopened = yield* Deferred.await(rearmed);
    assert.equal(new URL(reopened.redirectUri).port, String(free.port));
    second.consent.cancel();
    assert.deepEqual(yield* Fiber.join(repeated), { reason: LOOPBACK_CONSENT_CANCELLED });

    yield* Effect.promise(() => held.release());
  }),
);

it.effect("every registered port held is a row that says so, not a throw", () =>
  Effect.gen(function* () {
    const first = yield* Effect.promise(() => borrowPort());
    const second = yield* Effect.promise(() => borrowPort());
    const armed = yield* Deferred.make<LoopbackAuthorization>();
    const { consent, authorizations } = harness(armed, { ports: [first.port, second.port] });

    assert.deepEqual(yield* Effect.scoped(consent.signInEffect()), {
      reason: "Luke could not open a sign-in callback on this machine.",
    });
    assert.deepEqual(authorizations, []);

    yield* Effect.promise(() => first.release());
    yield* Effect.promise(() => second.release());
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

it.effect("a refusal on the redirect is an answer, not an exchange", () =>
  Effect.gen(function* () {
    const armed = yield* Deferred.make<LoopbackAuthorization>();
    const { consent, exchanges } = harness(armed);

    const waiting = yield* trip(consent);
    const authorization = yield* Deferred.await(armed);

    const answered = yield* callback(authorization.redirectUri, {
      state: authorization.state,
      error: "access_denied",
    });
    assert.equal(answered.status, 200);
    assert.deepEqual(yield* Fiber.join(waiting), { reason: REASON.REFUSED });
    assert.deepEqual(exchanges, []);
  }),
);

it.effect("a refused exchange draws the attention card and carries its own reason", () =>
  Effect.gen(function* () {
    const armed = yield* Deferred.make<LoopbackAuthorization>();
    const { consent } = harness(armed, {
      exchange: async () => ({ reason: "Example refused the sign-in exchange." }),
    });

    const waiting = yield* trip(consent);
    const authorization = yield* Deferred.await(armed);

    const answered = yield* callback(authorization.redirectUri, {
      state: authorization.state,
      code: "auth-code",
    });
    assert.equal(answered.status, 200);
    assert.deepEqual(yield* Fiber.join(waiting), {
      reason: "Example refused the sign-in exchange.",
    });
  }),
);

it.effect("the first valid callback claims the one-time code; a second is spent", () =>
  Effect.gen(function* () {
    const exchanges: LoopbackExchange[] = [];
    const running = yield* Deferred.make<LoopbackExchange>();
    const finishExchange = yield* Deferred.make<Grant>();
    const armed = yield* Deferred.make<LoopbackAuthorization>();
    const { consent } = harness(armed, {
      exchange: (input) => {
        exchanges.push(input);
        Deferred.unsafeDone(running, Exit.succeed(input));
        return Effect.runPromise(Deferred.await(finishExchange));
      },
    });

    const waiting = yield* trip(consent);
    const authorization = yield* Deferred.await(armed);
    const first = yield* Effect.fork(
      callback(authorization.redirectUri, { state: authorization.state, code: "auth-code" }),
    );
    yield* Deferred.await(running);

    const duplicate = yield* callback(authorization.redirectUri, {
      state: authorization.state,
      code: "auth-code",
    });
    assert.equal(duplicate.status, 409);
    assert.equal(exchanges.length, 1);

    yield* Deferred.succeed(finishExchange, { token: "granted" });
    assert.equal((yield* Fiber.join(first)).status, 200);
    assert.deepEqual(yield* Fiber.join(waiting), { token: "granted" });
  }),
);

it.effect("a claimed code whose exchange answered nothing still ends the trip", () =>
  Effect.gen(function* () {
    const armed = yield* Deferred.make<LoopbackAuthorization>();
    const { consent } = harness(armed, {
      // The contract says an exchange never throws. One that breaks it has
      // still spent the code, and the deadline no longer stands, so the trip
      // has to end on the flow's own refusal rather than listen forever.
      exchange: () => Promise.reject(new Error("exchange broke its contract")),
    });

    const waiting = yield* trip(consent);
    const authorization = yield* Deferred.await(armed);
    yield* callback(authorization.redirectUri, {
      state: authorization.state,
      code: "auth-code",
    });
    assert.deepEqual(yield* Fiber.join(waiting), { reason: REASON.REFUSED });
  }),
);

it.effect("an abandoned trip times out instead of listening forever", () =>
  Effect.gen(function* () {
    const armed = yield* Deferred.make<LoopbackAuthorization>();
    const { consent } = harness(armed, { timeoutMs: 20 });

    const waiting = yield* trip(consent);
    yield* Deferred.await(armed);
    assert.deepEqual(yield* untilDeadline(waiting, 20), { reason: REASON.TIMED_OUT });
  }),
);

it.effect("the deadline leaves a claimed callback alone", () =>
  Effect.gen(function* () {
    const running = yield* Deferred.make<LoopbackExchange>();
    const finishExchange = yield* Deferred.make<Grant>();
    const armed = yield* Deferred.make<LoopbackAuthorization>();
    const { consent } = harness(armed, {
      timeoutMs: 20,
      exchange: (input) => {
        Deferred.unsafeDone(running, Exit.succeed(input));
        return Effect.runPromise(Deferred.await(finishExchange));
      },
    });

    const waiting = yield* trip(consent);
    const authorization = yield* Deferred.await(armed);
    const answering = yield* Effect.fork(
      callback(authorization.redirectUri, { state: authorization.state, code: "auth-code" }),
    );
    yield* Deferred.await(running);

    // A code in hand outlives the deadline: the exchange is still going, and
    // the trip settles on what it answers rather than on the clock.
    yield* TestClock.adjust(Duration.millis(20));
    yield* Deferred.succeed(finishExchange, { token: "granted" });
    assert.equal((yield* Fiber.join(answering)).status, 200);
    assert.deepEqual(yield* Fiber.join(waiting), { token: "granted" });
  }),
);

it.effect("a stray request delays the deadline rather than holding the trip open", () =>
  Effect.gen(function* () {
    const armed = yield* Deferred.make<LoopbackAuthorization>();
    const { consent } = harness(armed, { timeoutMs: 20 });

    const waiting = yield* trip(consent);
    const authorization = yield* Deferred.await(armed);
    const stray = yield* callback(authorization.redirectUri, { state: "not-it" });
    assert.equal(stray.status, 404);

    // The deadline gives way for a request that had already arrived, and
    // decides once the grace period after it has passed.
    assert.deepEqual(yield* untilDeadline(waiting, 20), { reason: REASON.TIMED_OUT });
  }),
);

it.effect("cancelling ends the wait; a grant given after lands nowhere", () =>
  Effect.gen(function* () {
    const armed = yield* Deferred.make<LoopbackAuthorization>();
    const { consent, exchanges } = harness(armed);

    const waiting = yield* trip(consent);
    const authorization = yield* Deferred.await(armed);
    consent.cancel();
    assert.deepEqual(yield* Fiber.join(waiting), { reason: LOOPBACK_CONSENT_CANCELLED });

    // The trip's scope closed with it, so the loopback is no longer listening.
    const late = yield* Effect.either(
      Effect.tryPromise(() =>
        answerCallback(authorization.redirectUri, { state: authorization.state, code: "late" }),
      ),
    );
    assert.ok(Either.isLeft(late));
    assert.deepEqual(exchanges, []);
  }),
);

it.effect("a callback already claimed is left to finish when the trip is cancelled", () =>
  Effect.gen(function* () {
    const exchanges: LoopbackExchange[] = [];
    const running = yield* Deferred.make<LoopbackExchange>();
    const finishExchange = yield* Deferred.make<Grant>();
    const armed = yield* Deferred.make<LoopbackAuthorization>();
    const { consent } = harness(armed, {
      exchange: (input) => {
        exchanges.push(input);
        Deferred.unsafeDone(running, Exit.succeed(input));
        return Effect.runPromise(Deferred.await(finishExchange));
      },
    });

    const waiting = yield* trip(consent);
    const authorization = yield* Deferred.await(armed);
    const answering = yield* Effect.fork(
      callback(authorization.redirectUri, { state: authorization.state, code: "auth-code" }),
    );
    yield* Deferred.await(running);

    // A code in hand is not an open door: cancelling now withdraws nothing.
    consent.cancel();
    yield* Deferred.succeed(finishExchange, { token: "granted" });
    assert.equal((yield* Fiber.join(answering)).status, 200);
    assert.deepEqual(yield* Fiber.join(waiting), { token: "granted" });
  }),
);

it.effect("a cancel while the port is still binding is not lost", () =>
  Effect.gen(function* () {
    const armed = yield* Deferred.make<LoopbackAuthorization>();
    const { consent, opened } = harness(armed);

    // The cancel runs the moment the trip suspends, which it first does while
    // the loopback is binding.
    yield* Effect.fork(Effect.sync(() => consent.cancel()));
    assert.deepEqual(yield* Effect.scoped(consent.signInEffect()), {
      reason: LOOPBACK_CONSENT_CANCELLED,
    });
    // The tab was never opened, because there was never a trip to consent to.
    assert.deepEqual(opened, []);
  }),
);

it.effect("a lost tab reopens the very page the trip is listening for", () =>
  Effect.gen(function* () {
    const armed = yield* Deferred.make<LoopbackAuthorization>();
    const { consent, opened } = harness(armed);

    // Nothing waiting, nothing to reopen.
    consent.reopen();
    assert.deepEqual(opened, []);

    const waiting = yield* trip(consent);
    yield* Deferred.await(armed);
    consent.reopen();
    assert.equal(opened.length, 2);
    // The same URL exactly: same state, same challenge, same loopback port.
    assert.equal(opened[1], opened[0]);

    consent.cancel();
    yield* Fiber.join(waiting);
    // A finished trip leaves nothing listening, so nothing reopens.
    consent.reopen();
    assert.equal(opened.length, 2);
  }),
);

it.effect("one trip at a time", () =>
  Effect.gen(function* () {
    const armed = yield* Deferred.make<LoopbackAuthorization>();
    const { consent } = harness(armed);

    const first = yield* trip(consent);
    yield* Deferred.await(armed);
    assert.deepEqual(yield* Effect.scoped(consent.signInEffect()), {
      reason: "A sign-in is already waiting in your browser.",
    });

    consent.cancel();
    assert.deepEqual(yield* Fiber.join(first), { reason: LOOPBACK_CONSENT_CANCELLED });
  }),
);

it.effect("a browser that will not open is said out loud, not waited out", () =>
  Effect.gen(function* () {
    const armed = yield* Deferred.make<LoopbackAuthorization>();
    const { consent } = harness(armed, {
      openExternal: () => Promise.reject(new Error("no shell")),
    });

    assert.deepEqual(yield* Effect.scoped(consent.signInEffect()), {
      reason: "Luke could not open the sign-in page in your browser.",
    });
  }),
);
