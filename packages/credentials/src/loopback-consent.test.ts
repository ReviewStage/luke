import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
  LOOPBACK_CONSENT_CANCELLED,
  type LoopbackAuthorization,
  type LoopbackConsentOptions,
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

function harness(overrides: Partial<LoopbackConsentOptions<Grant>> = {}) {
  const opened: string[] = [];
  const authorizations: LoopbackAuthorization[] = [];
  const exchanges: LoopbackExchange[] = [];
  const consent = loopbackConsent<Grant>({
    callbackPath: "/consent/callback",
    pages: PAGES,
    reasons: { refused: REASON.REFUSED, timedOut: REASON.TIMED_OUT },
    authorizationUrl: (input) => {
      authorizations.push(input);
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

/** The browser is opened once the loopback is listening; wait for that. */
async function armed(authorizations: readonly LoopbackAuthorization[]): Promise<void> {
  while (authorizations.length === 0) await new Promise((resolve) => setImmediate(resolve));
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

test("one trip runs press to grant, with the PKCE pair the exchange answers for", async () => {
  const { consent, opened, authorizations, exchanges } = harness();

  const pending = consent.signIn();
  await armed(authorizations);
  // SAFETY: `armed` returns only once the first authorization was composed.
  const authorization = authorizations[0] as LoopbackAuthorization;
  assert.deepEqual(opened, [
    `https://example.test/consent?state=${encodeURIComponent(authorization.state)}`,
  ]);

  const answered = await answerCallback(authorization.redirectUri, {
    state: authorization.state,
    code: "auth-code",
  });
  assert.equal(answered.status, 200);
  assert.deepEqual(await pending, { token: "granted" });

  // SAFETY: The granted callback above ran the exchange exactly once.
  const exchange = exchanges[0] as LoopbackExchange;
  assert.equal(exchange.code, "auth-code");
  assert.equal(exchange.redirectUri, authorization.redirectUri);
  assert.equal(
    authorization.codeChallenge,
    createHash("sha256").update(exchange.codeVerifier, "ascii").digest("base64url"),
  );
});

test("a state prefix rides in front of the entropy rather than replacing it", async () => {
  const { consent, authorizations } = harness({ statePrefix: "github" });

  const pending = consent.signIn();
  await armed(authorizations);

  consent.cancel();
  assert.deepEqual(await pending, { reason: LOOPBACK_CONSENT_CANCELLED });
});

test("a registered port already held is tried past, not reported", async () => {
  const held = await borrowPort();
  const free = await borrowPort();
  await free.release();
  const { consent, authorizations } = harness({ ports: [held.port, free.port] });

  const pending = consent.signIn();
  await armed(authorizations);
  // SAFETY: `armed` returns only once the first authorization was composed.
  const authorization = authorizations[0] as LoopbackAuthorization;

  const answered = await answerCallback(authorization.redirectUri, {
    state: authorization.state,
    code: "auth-code",
  });
  assert.equal(answered.status, 200);
  assert.deepEqual(await pending, { token: "granted" });

  // The browser holds its connection open after the redirect, and a socket it
  // held would keep this registered port bound against the next trip.
  const second = harness({ ports: [held.port, free.port] });
  const repeated = second.consent.signIn();
  await armed(second.authorizations);
  second.consent.cancel();
  assert.deepEqual(await repeated, { reason: LOOPBACK_CONSENT_CANCELLED });

  await held.release();
});

test("every registered port held is a row that says so, not a throw", async () => {
  const first = await borrowPort();
  const second = await borrowPort();
  const { consent, authorizations } = harness({ ports: [first.port, second.port] });

  assert.deepEqual(await consent.signIn(), {
    reason: "Luke could not open a sign-in callback on this machine.",
  });
  assert.deepEqual(authorizations, []);

  await first.release();
  await second.release();
});

test("another path, or a state this trip never issued, is refused without settling", async () => {
  const { consent, authorizations } = harness();

  const pending = consent.signIn();
  await armed(authorizations);
  // SAFETY: `armed` returns only once the first authorization was composed.
  const authorization = authorizations[0] as LoopbackAuthorization;

  const forged = await answerCallback(authorization.redirectUri, {
    state: "not-it",
    code: "stolen",
  });
  assert.equal(forged.status, 404);

  const strayPath = new URL(authorization.redirectUri);
  strayPath.pathname = "/somewhere-else";
  const stray = await answerCallback(strayPath.toString(), { state: authorization.state });
  assert.equal(stray.status, 404);

  // The real redirect was still on its way, and the trip was still listening.
  const genuine = await answerCallback(authorization.redirectUri, {
    state: authorization.state,
    code: "auth-code",
  });
  assert.equal(genuine.status, 200);
  assert.deepEqual(await pending, { token: "granted" });
});

test("a refusal on the redirect is an answer, not an exchange", async () => {
  const { consent, authorizations, exchanges } = harness();

  const pending = consent.signIn();
  await armed(authorizations);
  // SAFETY: `armed` returns only once the first authorization was composed.
  const authorization = authorizations[0] as LoopbackAuthorization;

  const answered = await answerCallback(authorization.redirectUri, {
    state: authorization.state,
    error: "access_denied",
  });
  assert.equal(answered.status, 200);
  assert.deepEqual(await pending, { reason: REASON.REFUSED });
  assert.deepEqual(exchanges, []);
});

test("a refused exchange draws the attention card and carries its own reason", async () => {
  const { consent, authorizations } = harness({
    exchange: async () => ({ reason: "Example refused the sign-in exchange." }),
  });

  const pending = consent.signIn();
  await armed(authorizations);
  // SAFETY: `armed` returns only once the first authorization was composed.
  const authorization = authorizations[0] as LoopbackAuthorization;

  const answered = await answerCallback(authorization.redirectUri, {
    state: authorization.state,
    code: "auth-code",
  });
  assert.equal(answered.status, 200);
  assert.deepEqual(await pending, { reason: "Example refused the sign-in exchange." });
});

test("the first valid callback claims the one-time code; a second is spent", async () => {
  let finishExchange: ((outcome: Grant) => void) | undefined;
  const exchanges: LoopbackExchange[] = [];
  const { consent, authorizations } = harness({
    exchange: (input) => {
      exchanges.push(input);
      return new Promise<Grant>((resolve) => {
        finishExchange = resolve;
      });
    },
  });

  const pending = consent.signIn();
  await armed(authorizations);
  // SAFETY: `armed` returns only once the first authorization was composed.
  const authorization = authorizations[0] as LoopbackAuthorization;
  const first = answerCallback(authorization.redirectUri, {
    state: authorization.state,
    code: "auth-code",
  });
  while (exchanges.length === 0) await new Promise((resolve) => setImmediate(resolve));

  const duplicate = await answerCallback(authorization.redirectUri, {
    state: authorization.state,
    code: "auth-code",
  });
  assert.equal(duplicate.status, 409);
  assert.equal(exchanges.length, 1);

  finishExchange?.({ token: "granted" });
  assert.equal((await first).status, 200);
  assert.deepEqual(await pending, { token: "granted" });
});

test("an abandoned trip times out instead of listening forever", async () => {
  const { consent } = harness({ timeoutMs: 20 });
  assert.deepEqual(await consent.signIn(), { reason: REASON.TIMED_OUT });
});

test("cancelling ends the wait; a grant given after lands nowhere", async () => {
  const { consent, authorizations, exchanges } = harness();

  const pending = consent.signIn();
  await armed(authorizations);
  // SAFETY: `armed` returns only once the first authorization was composed.
  const authorization = authorizations[0] as LoopbackAuthorization;
  consent.cancel();
  assert.deepEqual(await pending, { reason: LOOPBACK_CONSENT_CANCELLED });

  await assert.rejects(() =>
    answerCallback(authorization.redirectUri, { state: authorization.state, code: "late" }),
  );
  assert.deepEqual(exchanges, []);
});

test("a callback already claimed is left to finish when the trip is cancelled", async () => {
  let finishExchange: ((outcome: Grant) => void) | undefined;
  const exchanges: LoopbackExchange[] = [];
  const { consent, authorizations } = harness({
    exchange: (input) => {
      exchanges.push(input);
      return new Promise<Grant>((resolve) => {
        finishExchange = resolve;
      });
    },
  });

  const pending = consent.signIn();
  await armed(authorizations);
  // SAFETY: `armed` returns only once the first authorization was composed.
  const authorization = authorizations[0] as LoopbackAuthorization;
  const callback = answerCallback(authorization.redirectUri, {
    state: authorization.state,
    code: "auth-code",
  });
  while (exchanges.length === 0) await new Promise((resolve) => setImmediate(resolve));

  // A code in hand is not an open door: cancelling now withdraws nothing.
  consent.cancel();
  finishExchange?.({ token: "granted" });
  assert.equal((await callback).status, 200);
  assert.deepEqual(await pending, { token: "granted" });
});

test("a cancel while the port is still binding is not lost", async () => {
  const { consent, opened } = harness();
  const pending = consent.signIn();
  consent.cancel();
  assert.deepEqual(await pending, { reason: LOOPBACK_CONSENT_CANCELLED });
  // The tab was never opened, because there was never a trip to consent to.
  assert.deepEqual(opened, []);
});

test("a lost tab reopens the very page the trip is listening for", async () => {
  const { consent, opened, authorizations } = harness();

  // Nothing waiting, nothing to reopen.
  consent.reopen();
  assert.deepEqual(opened, []);

  const pending = consent.signIn();
  await armed(authorizations);
  consent.reopen();
  assert.equal(opened.length, 2);
  // The same URL exactly: same state, same challenge, same loopback port.
  assert.equal(opened[1], opened[0]);

  consent.cancel();
  await pending;
  // A finished trip leaves nothing listening, so nothing reopens.
  consent.reopen();
  assert.equal(opened.length, 2);
});

test("one trip at a time", async () => {
  const { consent, authorizations } = harness();

  const first = consent.signIn();
  await armed(authorizations);
  assert.deepEqual(await consent.signIn(), {
    reason: "A sign-in is already waiting in your browser.",
  });

  consent.cancel();
  assert.deepEqual(await first, { reason: LOOPBACK_CONSENT_CANCELLED });
});

test("a browser that will not open is said out loud, not waited out", async () => {
  const { consent } = harness({
    openExternal: () => Promise.reject(new Error("no shell")),
  });

  assert.deepEqual(await consent.signIn(), {
    reason: "Luke could not open the sign-in page in your browser.",
  });
});
