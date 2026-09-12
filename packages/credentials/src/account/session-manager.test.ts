import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer, HTTP_STATUS, jsonResponse } from "@sidecar/wire/testing";
import { Deferred, Effect, Exit, Fiber, Option } from "effect";
import { AccountClient, type FetchLike, type StoredAccount } from "./client.js";
import { AccountSessionManager } from "./session-manager.js";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "./snapshot.js";

const STORED: StoredAccount = {
  accessToken: "access",
  refreshToken: "refresh",
  id: "user-1",
  email: "dev@example.com",
  provider: ACCOUNT_PROVIDER.GITHUB,
};

function manager(options: {
  stored?: StoredAccount;
  revoke?: (token: string) => Promise<void>;
  exchangeCode?: () => Promise<{ accessToken: string; refreshToken: string }>;
  onSignOut?: (account: StoredAccount) => Effect.Effect<void, Error>;
  client?: AccountClient;
  /** Held before the credential is cleared, so a sign-out can be cut mid-way. */
  beforeClear?: Effect.Effect<void>;
}) {
  let stored = options.stored;
  const changes: string[] = [];
  const events: string[] = [];
  const authorizations: { redirectUri: string; state: string }[] = [];
  // SAFETY: Fixture client implements only the AccountClient methods the manager calls.
  const fixtureClient = {
    revoke: options.revoke ?? (async () => undefined),
    userInfo: async () => STORED,
    refresh: async () => ({ accessToken: "new-access", refreshToken: "new-refresh" }),
    authorizeUrl: (input: { redirectUri: string; state: string }) => {
      authorizations.push(input);
      return `https://accounts.example/authorize?state=${encodeURIComponent(input.state)}`;
    },
    exchangeCode:
      options.exchangeCode ??
      (async () => ({ accessToken: "issued-access", refreshToken: "issued-refresh" })),
  } as unknown as AccountClient;
  const instance = new AccountSessionManager({
    client: options.client ?? fixtureClient,
    store: {
      readAccount: () => Effect.sync(() => stored),
      setAccount: (next) =>
        Effect.sync(() => {
          stored = next;
          return { status: ACCOUNT_STATUS.SIGNED_IN, ...next };
        }),
      clearAccount: () =>
        Effect.gen(function* () {
          if (options.beforeClear) yield* options.beforeClear;
          stored = undefined;
          return { status: ACCOUNT_STATUS.SIGNED_OUT };
        }),
    },
    hostedServiceBaseUrl: "https://example.com",
    requiresAccount: true,
    openExternal: async () => undefined,
    startCapabilities: Effect.sync(() => {
      events.push("start");
    }),
    stopCapabilities: Effect.sync(() => {
      events.push("stop");
    }),
    ...(options.onSignOut ? { onSignOut: options.onSignOut } : undefined),
    onChange: (account) => changes.push(account.status),
  });
  return { instance, changes, events, authorizations, stored: () => stored };
}

it.effect("sign out closes capabilities, clears storage, broadcasts, then revokes", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    const subject = manager({
      stored: STORED,
      revoke: async () => {
        calls.push("revoke");
      },
    });
    subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });
    yield* subject.instance.signOut({ revokeRemote: true });
    assert.deepEqual(subject.events, ["stop"]);
    assert.deepEqual(subject.changes, [ACCOUNT_STATUS.SIGNED_OUT, ACCOUNT_STATUS.SIGNED_OUT]);
    assert.deepEqual(calls, ["revoke"]);
    assert.equal(subject.stored(), undefined);
  }),
);

it.effect(
  "sign out releases the departing account while its token still stands, and a failed release never holds it up",
  () =>
    Effect.gen(function* () {
      const order: string[] = [];
      const subject = manager({
        stored: STORED,
        revoke: async () => {
          order.push("revoke");
        },
        onSignOut: (account) =>
          Effect.gen(function* () {
            order.push(
              `release:${account.accessToken}:${
                subject.stored() === undefined ? "cleared" : "standing"
              }`,
            );
            return yield* Effect.fail(new Error("service unreachable"));
          }),
      });
      subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });
      yield* subject.instance.signOut({ revokeRemote: true });
      assert.deepEqual(order, ["release:access:standing", "revoke"]);
      assert.deepEqual(subject.events, ["stop"]);
      assert.equal(subject.stored(), undefined);
    }),
);

it.effect("a sign-out interrupted mid-way runs to the cleared account rather than tearing", () =>
  Effect.gen(function* () {
    const holding = yield* Deferred.make<void>();
    const subject = manager({ stored: STORED, beforeClear: Deferred.await(holding) });
    subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });

    const signingOut = yield* Effect.fork(subject.instance.signOut());
    yield* Effect.yieldNow();
    yield* Effect.fork(Fiber.interrupt(signingOut));
    // Enough turns for the interruption to have been delivered wherever the
    // sign-out could take it. The departure is reported before the credential
    // is cleared, so it must not be taken anywhere: the fiber is still
    // running on the held clear.
    yield* Effect.repeatN(Effect.yieldNow(), 20);
    assert.equal(Option.isNone(yield* Fiber.poll(signingOut)), true);

    yield* Deferred.succeed(holding, undefined);
    yield* Fiber.await(signingOut);
    assert.equal(subject.stored(), undefined);
    assert.deepEqual(subject.events, ["stop"]);
  }),
);

it.effect("refresh keeps a valid stored account signed in without rewriting it", () =>
  Effect.gen(function* () {
    const subject = manager({ stored: STORED });
    subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });
    yield* subject.instance.refresh();
    assert.equal(subject.instance.snapshot.status, ACCOUNT_STATUS.SIGNED_IN);
    assert.equal(subject.stored()?.accessToken, "access");
  }),
);

/**
 * The real `AccountClient` over the ambient `HttpClient`, so the renewal
 * decision below runs through the actual conversion this PR made rather than
 * a synthetic error object: a network the token endpoint cannot be reached
 * over must never be read as the service's own refusal.
 */
function refreshingClient(tokenEndpoint: (request: Request) => Promise<Response>): AccountClient {
  const fetchStub: FetchLike = async (input, init) => {
    const request = new Request(input, init);
    if (request.url.endsWith("/oauth2/userinfo")) {
      return jsonResponse({ error: "invalid_token" }, HTTP_STATUS.UNAUTHORIZED);
    }
    if (request.url.endsWith("/oauth2/token")) return tokenEndpoint(request);
    throw new Error(`unexpected request to ${request.url}`);
  };
  return new AccountClient({
    baseUrl: "https://tryluke.dev/api/auth",
    clientId: "luke-desktop",
    httpClient: fakeHttpClientLayer(fetchStub),
  });
}

it.effect(
  "a renewal a network cannot carry keeps the stored account standing, never a sign-out",
  () =>
    Effect.gen(function* () {
      const subject = manager({
        stored: STORED,
        client: refreshingClient(() => {
          throw new TypeError("fetch failed");
        }),
      });
      subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });

      yield* subject.instance.refresh();

      assert.equal(subject.instance.snapshot.status, ACCOUNT_STATUS.SIGNED_IN);
      assert.deepEqual(subject.stored(), STORED);
    }),
);

it.effect(
  "a renewal the service refuses with invalid_grant is the one path that signs the account out",
  () =>
    Effect.gen(function* () {
      const subject = manager({
        stored: STORED,
        client: refreshingClient(() =>
          Promise.resolve(
            jsonResponse(
              { error: "invalid_grant", error_description: "Refresh token was revoked" },
              400,
            ),
          ),
        ),
      });
      subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });

      yield* subject.instance.refresh();

      assert.equal(subject.instance.snapshot.status, ACCOUNT_STATUS.SIGNED_OUT);
      assert.equal(subject.stored(), undefined);
    }),
);

/** Waits for the consent trip to have composed its authorization page. */
async function armed(authorizations: readonly unknown[]): Promise<void> {
  while (authorizations.length === 0) await new Promise((resolve) => setImmediate(resolve));
}

it.effect("a withdrawn sign-in settles signed out rather than reporting a failure", () =>
  Effect.gen(function* () {
    const subject = manager({});
    const pending = yield* Effect.fork(subject.instance.beginSignIn(ACCOUNT_PROVIDER.GITHUB));
    yield* Effect.promise(() => armed(subject.authorizations));

    subject.instance.cancelSignIn();
    assert.equal((yield* Fiber.join(pending)).status, ACCOUNT_STATUS.SIGNED_OUT);
  }),
);

it.effect("an exchange the account refuses is a failure the panel can report", () =>
  Effect.gen(function* () {
    const subject = manager({
      exchangeCode: () => Promise.reject(new Error("Account refused the exchange")),
    });
    const refused = yield* Effect.fork(
      Effect.exit(subject.instance.beginSignIn(ACCOUNT_PROVIDER.GITHUB)),
    );
    yield* Effect.promise(() => armed(subject.authorizations));
    // SAFETY: `armed` returns only once the first authorization was composed.
    const { redirectUri, state } = subject.authorizations[0] as {
      redirectUri: string;
      state: string;
    };

    const callback = new URL(redirectUri);
    callback.searchParams.set("state", state);
    callback.searchParams.set("code", "auth-code");
    const answered = yield* Effect.promise(() => fetch(callback));
    assert.equal(answered.status, HTTP_STATUS.OK);

    const outcome = yield* Fiber.join(refused);
    assert.equal(Exit.isFailure(outcome), true);
    assert.equal(subject.instance.snapshot.status, ACCOUNT_STATUS.SIGNED_OUT);
  }),
);
