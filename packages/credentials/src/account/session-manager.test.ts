import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  type FakeResponder,
  fakeHttpClientLayer,
  HTTP_STATUS,
  jsonResponse,
} from "@sidecar/wire/testing";
import { Effect, Exit, Fiber, type Scope, Stream } from "effect";
import { AccountClient, type StoredAccount } from "./client.js";
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
  revoke?: (token: string) => Effect.Effect<void, Error>;
  exchangeCode?: () => Effect.Effect<{ accessToken: string; refreshToken: string }, Error>;
  client?: AccountClient;
  /** Who the service says a token belongs to; the stored account's person unless given. */
  identity?: { id: string; email: string };
  /** Held before the credential is cleared, so a sign-out can be cut mid-way. */
  beforeClear?: Effect.Effect<void>;
}): Effect.Effect<
  {
    instance: AccountSessionManager;
    changes: string[];
    events: string[];
    authorizations: { redirectUri: string; state: string }[];
    stored: () => StoredAccount | undefined;
  },
  never,
  Scope.Scope
> {
  return Effect.gen(function* () {
    let stored = options.stored;
    const changes: string[] = [];
    const events: string[] = [];
    const authorizations: { redirectUri: string; state: string }[] = [];
    // SAFETY: Fixture client implements only the AccountClient methods the manager calls.
    const fixtureClient = {
      revoke: options.revoke ?? (() => Effect.void),
      userInfo: () =>
        Effect.succeed({
          ...(options.identity ?? { id: STORED.id, email: STORED.email }),
          provider: STORED.provider,
        }),
      refresh: () => Effect.succeed({ accessToken: "new-access", refreshToken: "new-refresh" }),
      authorizeUrl: (input: { redirectUri: string; state: string }) => {
        authorizations.push(input);
        return `https://accounts.example/authorize?state=${encodeURIComponent(input.state)}`;
      },
      exchangeCode:
        options.exchangeCode ??
        (() => Effect.succeed({ accessToken: "issued-access", refreshToken: "issued-refresh" })),
    } as unknown as AccountClient;
    const instance = yield* AccountSessionManager.make({
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
    });
    // The subscriber every test is: a fiber forked into the test's own scope,
    // pumping every snapshot the instance settles on, exactly as
    // `compose-account.ts`'s `lifetime` does over the same `changes` stream.
    const subscription = yield* instance.changes;
    yield* Effect.forkScoped(
      Stream.runForEach(subscription, (account) => Effect.sync(() => changes.push(account.status))),
    );
    return { instance, changes, events, authorizations, stored: () => stored };
  });
}

it.effect("sign out closes capabilities, clears storage, broadcasts, then revokes", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    const subject = yield* manager({
      stored: STORED,
      revoke: () =>
        Effect.sync(() => {
          calls.push("revoke");
        }),
    });
    subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });
    yield* subject.instance.signOut({ revokeRemote: true });
    // The subscriber is a separate fiber pumping the published snapshots, so
    // enough turns are given for it to have drained both before they are read.
    yield* Effect.repeat(Effect.yieldNow, { times: 20 });
    assert.deepEqual(subject.events, ["stop"]);
    assert.deepEqual(subject.changes, [ACCOUNT_STATUS.SIGNED_OUT, ACCOUNT_STATUS.SIGNED_OUT]);
    assert.deepEqual(calls, ["revoke"]);
    assert.equal(subject.stored(), undefined);
  }),
);

/**
 * The real `AccountClient` over the ambient `HttpClient`, so the renewal
 * decision below runs through the actual conversion this PR made rather than
 * a synthetic error object: a network the token endpoint cannot be reached
 * over must never be read as the service's own refusal.
 */
function refreshingClient(
  tokenEndpoint: (request: Request) => Promise<Response>,
  userInfoEndpoint: (request: Request) => Response = () =>
    jsonResponse({ error: "invalid_token" }, HTTP_STATUS.UNAUTHORIZED),
): AccountClient {
  const fetchStub: FakeResponder = async (input, init) => {
    const request = new Request(input, init);
    if (request.url.endsWith("/oauth2/userinfo")) return userInfoEndpoint(request);
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
  "a renewal the service refuses with invalid_grant is the one path that signs the account out",
  () =>
    Effect.gen(function* () {
      const subject = yield* manager({
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

/** Answers the consent's own loopback as the browser would, with a code. */
function grantCode(authorizations: readonly { redirectUri: string; state: string }[]) {
  return Effect.gen(function* () {
    yield* Effect.promise(() => armed(authorizations));
    // SAFETY: `armed` returns only once the first authorization was composed.
    const { redirectUri, state } = authorizations[0] as { redirectUri: string; state: string };
    const callback = new URL(redirectUri);
    callback.searchParams.set("state", state);
    callback.searchParams.set("code", "auth-code");
    yield* Effect.promise(() => fetch(callback));
  });
}

it.effect(
  "a sign-in again withdrawn midway leaves the standing session signed in and working",
  () =>
    Effect.gen(function* () {
      const revoked: string[] = [];
      const subject = yield* manager({
        stored: STORED,
        revoke: (token) =>
          Effect.sync(() => {
            revoked.push(token);
          }),
      });
      subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });
      const pending = yield* Effect.forkChild(
        subject.instance.signInAgain(ACCOUNT_PROVIDER.GITHUB),
      );
      yield* Effect.promise(() => armed(subject.authorizations));

      subject.instance.cancelSignIn();
      assert.equal(yield* Fiber.join(pending), false);
      assert.equal(subject.instance.snapshot.status, ACCOUNT_STATUS.SIGNED_IN);
      assert.deepEqual(subject.stored(), STORED);
      assert.deepEqual(revoked, []);
      // The session still renews as it did before the trip began.
      yield* subject.instance.renewOnce();
      assert.equal(subject.stored()?.refreshToken, "new-refresh");
    }),
);

it.effect("a sign-in again that lands replaces the standing session and revokes its token", () =>
  Effect.gen(function* () {
    const revoked: string[] = [];
    const subject = yield* manager({
      stored: STORED,
      revoke: (token) =>
        Effect.sync(() => {
          revoked.push(token);
        }),
    });
    subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });
    const pending = yield* Effect.forkChild(subject.instance.signInAgain(ACCOUNT_PROVIDER.GITHUB));
    yield* grantCode(subject.authorizations);

    assert.equal(yield* Fiber.join(pending), true);
    assert.equal(subject.instance.snapshot.status, ACCOUNT_STATUS.SIGNED_IN);
    assert.equal(subject.stored()?.refreshToken, "issued-refresh");
    assert.deepEqual(revoked, [STORED.refreshToken]);
    // Never signed out on the way, so nothing the session carried was closed.
    assert.equal(subject.events.includes("stop"), false);
  }),
);

it.effect("a sign-in again the account refuses fails and leaves the standing session", () =>
  Effect.gen(function* () {
    const subject = yield* manager({
      stored: STORED,
      exchangeCode: () => Effect.fail(new Error("Account refused the exchange")),
    });
    subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });
    const refused = yield* Effect.forkChild(
      Effect.exit(subject.instance.signInAgain(ACCOUNT_PROVIDER.GITHUB)),
    );
    yield* grantCode(subject.authorizations);

    assert.equal(Exit.isFailure(yield* Fiber.join(refused)), true);
    assert.equal(subject.instance.snapshot.status, ACCOUNT_STATUS.SIGNED_IN);
    assert.deepEqual(subject.stored(), STORED);
  }),
);

it.effect(
  "a sign-in again that lands on another account is refused, its tokens revoked, and the standing session kept",
  () =>
    Effect.gen(function* () {
      const revoked: string[] = [];
      const subject = yield* manager({
        stored: STORED,
        identity: { id: "user-2", email: "someone@example.com" },
        revoke: (token) =>
          Effect.sync(() => {
            revoked.push(token);
          }),
      });
      subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });
      const refused = yield* Effect.forkChild(
        Effect.exit(subject.instance.signInAgain(ACCOUNT_PROVIDER.GITHUB)),
      );
      yield* grantCode(subject.authorizations);

      assert.equal(Exit.isFailure(yield* Fiber.join(refused)), true);
      assert.deepEqual(subject.stored(), STORED);
      assert.deepEqual(revoked, ["issued-refresh"]);
    }),
);

it.effect(
  "an ask to sign in again through another provider while one runs answers no rather than joining it",
  () =>
    Effect.gen(function* () {
      const subject = yield* manager({ stored: STORED });
      subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });
      const github = yield* Effect.forkChild(subject.instance.signInAgain(ACCOUNT_PROVIDER.GITHUB));
      yield* Effect.promise(() => armed(subject.authorizations));

      assert.equal(yield* subject.instance.signInAgain(ACCOUNT_PROVIDER.GOOGLE), false);
      yield* grantCode(subject.authorizations);
      assert.equal(yield* Fiber.join(github), true);
    }),
);
