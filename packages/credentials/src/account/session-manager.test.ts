import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { layerFromCloudFetch } from "@sidecar/wire/effect";
import { HTTP_STATUS, jsonResponse } from "@sidecar/wire/testing";
import { Effect, Exit, Fiber } from "effect";
import { test } from "vitest";
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
  onSignOut?: (account: StoredAccount) => Promise<void>;
  client?: AccountClient;
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
      readAccount: async () => stored,
      setAccount: async (next) => {
        stored = next;
        return { status: ACCOUNT_STATUS.SIGNED_IN, ...next };
      },
      clearAccount: async () => {
        stored = undefined;
        return { status: ACCOUNT_STATUS.SIGNED_OUT };
      },
    },
    hostedServiceBaseUrl: "https://example.com",
    requiresAccount: true,
    openExternal: async () => undefined,
    startCapabilities: async () => {
      events.push("start");
    },
    stopCapabilities: async () => {
      events.push("stop");
    },
    ...(options.onSignOut ? { onSignOut: options.onSignOut } : undefined),
    onChange: (account) => changes.push(account.status),
  });
  return { instance, changes, events, authorizations, stored: () => stored };
}

test("sign out closes capabilities, clears storage, broadcasts, then revokes", async () => {
  const calls: string[] = [];
  const subject = manager({
    stored: STORED,
    revoke: async () => {
      calls.push("revoke");
    },
  });
  subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });
  await subject.instance.signOut({ revokeRemote: true });
  assert.deepEqual(subject.events, ["stop"]);
  assert.deepEqual(subject.changes, [ACCOUNT_STATUS.SIGNED_OUT, ACCOUNT_STATUS.SIGNED_OUT]);
  assert.deepEqual(calls, ["revoke"]);
  assert.equal(subject.stored(), undefined);
});

test("sign out releases the departing account while its token still stands, and a failed release never holds it up", async () => {
  const order: string[] = [];
  const subject = manager({
    stored: STORED,
    revoke: async () => {
      order.push("revoke");
    },
    onSignOut: async (account) => {
      order.push(
        `release:${account.accessToken}:${subject.stored() === undefined ? "cleared" : "standing"}`,
      );
      throw new Error("service unreachable");
    },
  });
  subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });
  await subject.instance.signOut({ revokeRemote: true });
  assert.deepEqual(order, ["release:access:standing", "revoke"]);
  assert.deepEqual(subject.events, ["stop"]);
  assert.equal(subject.stored(), undefined);
});

test("refresh keeps a valid stored account signed in without rewriting it", async () => {
  const subject = manager({ stored: STORED });
  subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });
  await subject.instance.refresh();
  assert.equal(subject.instance.snapshot.status, ACCOUNT_STATUS.SIGNED_IN);
  assert.equal(subject.stored()?.accessToken, "access");
});

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
    httpClient: layerFromCloudFetch(fetchStub),
  });
}

test("a renewal a network cannot carry keeps the stored account standing, never a sign-out", async () => {
  const subject = manager({
    stored: STORED,
    client: refreshingClient(() => {
      throw new TypeError("fetch failed");
    }),
  });
  subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });

  await subject.instance.refresh();

  assert.equal(subject.instance.snapshot.status, ACCOUNT_STATUS.SIGNED_IN);
  assert.deepEqual(subject.stored(), STORED);
});

test("a renewal the service refuses with invalid_grant is the one path that signs the account out", async () => {
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

  await subject.instance.refresh();

  assert.equal(subject.instance.snapshot.status, ACCOUNT_STATUS.SIGNED_OUT);
  assert.equal(subject.stored(), undefined);
});

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
