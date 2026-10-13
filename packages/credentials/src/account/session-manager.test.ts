import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  type FakeResponder,
  fakeHttpClientLayer,
  HTTP_STATUS,
  jsonResponse,
} from "@sidecar/wire/testing";
import { Effect, type Scope, Stream } from "effect";
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
      userInfo: () => Effect.succeed(STORED),
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
