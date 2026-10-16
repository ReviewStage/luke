import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "@effect/vitest";
import {
  type FakeResponder,
  fakeHttpClientLayer,
  HTTP_STATUS,
  jsonResponse,
} from "@luke/wire/testing";
import { Deferred, Effect, Exit, Fiber, type Scope, Stream } from "effect";
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
  /** The capability start a sign-in runs; recording "start" unless given. */
  startCapabilities?: Effect.Effect<void>;
  /** The capability stop a sign-out runs; recording "stop" unless given. */
  stopCapabilities?: Effect.Effect<void>;
  /** The refresh grant's answer; new tokens unless given. */
  refresh?: AccountClient["refresh"];
  /** Held before the credential is cleared, so a sign-out can be cut mid-way. */
  beforeClear?: Effect.Effect<void>;
  /** Whose session the hand-off's exchange answers; the stored account's person unless given. */
  sessionUserId?: string;
  /** That session's account's address; the stored account's unless given. */
  sessionEmail?: string;
}): Effect.Effect<
  {
    instance: AccountSessionManager;
    changes: string[];
    events: string[];
    authorizations: { redirectUri: string; state: string }[];
    opened: string[];
    sessionExchanges: { code: string; state: string; codeVerifier: string }[];
    endedSessions: string[];
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
    const opened: string[] = [];
    const sessionExchanges: { code: string; state: string; codeVerifier: string }[] = [];
    const endedSessions: string[] = [];
    // SAFETY: Fixture client implements only the AccountClient methods the manager calls.
    const fixtureClient = {
      revoke: options.revoke ?? (() => Effect.void),
      userInfo: () =>
        Effect.succeed({
          ...(options.identity ?? { id: STORED.id, email: STORED.email }),
          provider: STORED.provider,
        }),
      refresh:
        options.refresh ??
        (() => Effect.succeed({ accessToken: "new-access", refreshToken: "new-refresh" })),
      authorizeUrl: (input: { redirectUri: string; state: string }) => {
        authorizations.push(input);
        return `https://accounts.example/authorize?state=${encodeURIComponent(input.state)}`;
      },
      exchangeCode:
        options.exchangeCode ??
        (() => Effect.succeed({ accessToken: "issued-access", refreshToken: "issued-refresh" })),
      exchangeSessionCode: (input: { code: string; state: string; codeVerifier: string }) =>
        Effect.sync(() => {
          sessionExchanges.push(input);
          return {
            sessionToken: "signed-session",
            userId: options.sessionUserId ?? STORED.id,
            email: options.sessionEmail ?? STORED.email,
          };
        }),
      endSession: (token: string) =>
        Effect.sync(() => {
          endedSessions.push(token);
        }),
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
      openExternal: async (url) => {
        opened.push(url);
      },
      startCapabilities:
        options.startCapabilities ??
        Effect.sync(() => {
          events.push("start");
        }),
      stopCapabilities:
        options.stopCapabilities ??
        Effect.sync(() => {
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
    return {
      instance,
      changes,
      events,
      authorizations,
      opened,
      sessionExchanges,
      endedSessions,
      stored: () => stored,
    };
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

it.effect(
  "a renewal that signs out answers its caller before the sign-out's capability stop settles",
  () =>
    Effect.gen(function* () {
      // The stop waits on the renewal's caller, as `tasks.reset` waits on the
      // lock a Plans read holds while it renews.
      const callerDone = yield* Deferred.make<void>();
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
        stopCapabilities: Deferred.await(callerDone),
      });
      subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });
      const changes = yield* subject.instance.changes;

      yield* subject.instance.renewOnce();
      yield* Deferred.succeed(callerDone, undefined);

      const settled = yield* Stream.runCollect(Stream.take(changes, 2));
      assert.deepEqual(
        settled.map((account) => account.status),
        [ACCOUNT_STATUS.SIGNED_OUT, ACCOUNT_STATUS.SIGNED_OUT],
      );
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
    // The browser is handed on to the hand-off page rather than following it here.
    return yield* Effect.promise(() => fetch(callback, { redirect: "manual" }));
  });
}

/** Lets the event loop turn `count` times, long enough for a loopback round trip to land. */
async function turns(count: number): Promise<void> {
  for (let turn = 0; turn < count; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}

it.effect(
  "a sign-in begun while a refused renewal's sign-out stops capabilities starts only after it",
  () =>
    Effect.gen(function* () {
      const refusing = refreshingClient(() =>
        Promise.resolve(
          jsonResponse(
            { error: "invalid_grant", error_description: "Refresh token was revoked" },
            400,
          ),
        ),
      );
      const released = yield* Deferred.make<void>();
      const order: string[] = [];
      const subject = yield* manager({
        stored: STORED,
        refresh: (token) => refusing.refresh(token),
        startCapabilities: Effect.sync(() => order.push("start")),
        stopCapabilities: Deferred.await(released).pipe(
          Effect.andThen(Effect.sync(() => order.push("stop"))),
        ),
      });
      subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });
      yield* subject.instance.renewOnce();

      const signingIn = yield* Effect.forkChild(
        subject.instance.beginSignIn(ACCOUNT_PROVIDER.GITHUB),
      );
      const granting = yield* Effect.forkChild(grantCode(subject.authorizations));
      // The stop is held until a sign-in that did not wait would have landed.
      yield* Effect.race(
        Fiber.join(signingIn),
        Effect.promise(() => turns(500)),
      );
      yield* Deferred.succeed(released, undefined);
      yield* Fiber.join(granting);
      yield* Fiber.join(signingIn);

      assert.equal(subject.instance.snapshot.status, ACCOUNT_STATUS.SIGNED_IN);
      assert.equal(subject.stored()?.refreshToken, "issued-refresh");
      assert.deepEqual(order, ["stop", "start"]);
    }),
);

it.effect("a sign-in cancelled while a refused renewal's sign-out settles opens no browser", () =>
  Effect.gen(function* () {
    const refusing = refreshingClient(() =>
      Promise.resolve(
        jsonResponse(
          { error: "invalid_grant", error_description: "Refresh token was revoked" },
          400,
        ),
      ),
    );
    const released = yield* Deferred.make<void>();
    const subject = yield* manager({
      stored: STORED,
      refresh: (token) => refusing.refresh(token),
      stopCapabilities: Deferred.await(released),
    });
    subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });
    yield* subject.instance.renewOnce();

    const signingIn = yield* Effect.forkChild(
      subject.instance.beginSignIn(ACCOUNT_PROVIDER.GITHUB),
    );
    yield* Effect.yieldNow;
    subject.instance.cancelSignIn();
    yield* Deferred.succeed(released, undefined);

    assert.equal((yield* Fiber.join(signingIn)).status, ACCOUNT_STATUS.SIGNED_OUT);
    assert.deepEqual(subject.authorizations, []);
    assert.deepEqual(subject.opened, []);
  }),
);

it.effect(
  "a cancel pressed while a sign-in waits on the sign-out also ends a sign-in again already open",
  () =>
    Effect.gen(function* () {
      const refusing = refreshingClient(() =>
        Promise.resolve(
          jsonResponse(
            { error: "invalid_grant", error_description: "Refresh token was revoked" },
            400,
          ),
        ),
      );
      const released = yield* Deferred.make<void>();
      const subject = yield* manager({
        stored: STORED,
        refresh: (token) => refusing.refresh(token),
        stopCapabilities: Deferred.await(released),
      });
      subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });
      const again = yield* Effect.forkChild(subject.instance.signInAgain(ACCOUNT_PROVIDER.GITHUB));
      yield* Effect.promise(() => armed(subject.authorizations));
      yield* subject.instance.renewOnce();

      const signingIn = yield* Effect.forkChild(
        subject.instance.beginSignIn(ACCOUNT_PROVIDER.GITHUB),
      );
      yield* Effect.yieldNow;
      subject.instance.cancelSignIn();
      yield* Deferred.succeed(released, undefined);

      assert.equal(yield* Fiber.join(again), false);
      assert.equal((yield* Fiber.join(signingIn)).status, ACCOUNT_STATUS.SIGNED_OUT);
      assert.equal(subject.authorizations.length, 1);
    }),
);

/** The hand-off page the sign-in sent the browser on to, read off its redirect. */
function handOffPage(response: Response): URL {
  assert.equal(response.status, 303);
  return new URL(response.headers.get("location") ?? "");
}

/** The hand-off page returning the plugin's code to the loopback, as it does on a transfer. */
function returnCode(page: URL, code = "session-code") {
  return Effect.promise(async () => {
    const back = new URL(page.searchParams.get("return_to") ?? "");
    back.searchParams.set("code", code);
    back.searchParams.set("state", page.searchParams.get("state") ?? "");
    return fetch(back);
  });
}

/** Waits for the session trip to have opened its hand-off page in the browser. */
async function openedPage(opened: readonly string[]): Promise<URL> {
  while (opened.length === 0) await new Promise((resolve) => setImmediate(resolve));
  // SAFETY: the loop returns only once a page was opened.
  return new URL(opened[0] as string);
}

function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

it.effect(
  "a sign-in sends the browser on to the hand-off page, and keeps the session it hands back beside the tokens",
  () =>
    Effect.gen(function* () {
      const subject = yield* manager({});
      const signingIn = yield* Effect.forkChild(
        subject.instance.beginSignIn(ACCOUNT_PROVIDER.GITHUB),
      );
      const page = handOffPage(yield* grantCode(subject.authorizations));
      assert.equal((yield* Fiber.join(signingIn)).status, ACCOUNT_STATUS.SIGNED_IN);
      assert.equal(page.origin + page.pathname, "https://example.com/desktop-session.html");
      assert.equal(new URL(page.searchParams.get("return_to") ?? "").hostname, "127.0.0.1");

      const landed = yield* returnCode(page);

      assert.equal(landed.status, 200);
      assert.equal(subject.stored()?.sessionToken, "signed-session");
      assert.equal(subject.stored()?.refreshToken, "issued-refresh");
      const [exchanged] = subject.sessionExchanges;
      assert.equal(exchanged?.code, "session-code");
      assert.equal(exchanged?.state, page.searchParams.get("state"));
      assert.equal(s256(exchanged?.codeVerifier ?? ""), page.searchParams.get("code_challenge"));
      // One tab for the whole sign-in: the hand-off page rode the sign-in's redirect.
      assert.equal(subject.opened.length, 1);
      assert.equal(new URL(subject.opened[0] ?? "").origin, "https://accounts.example");
    }),
);

it.effect(
  "a browser signed in as someone else hands over nothing, and the session it handed is ended",
  () =>
    Effect.gen(function* () {
      const subject = yield* manager({ stored: STORED, sessionUserId: "user-2" });
      subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });
      const asked = yield* Effect.forkChild(Effect.exit(subject.instance.obtainSession()));

      yield* returnCode(yield* Effect.promise(() => openedPage(subject.opened)));

      const refused = yield* Fiber.join(asked);
      assert.equal(Exit.isFailure(refused), true);
      assert.deepEqual(subject.stored(), STORED);
      assert.deepEqual(subject.endedSessions, ["signed-session"]);
    }),
);

it.effect("an account signed in without a session asks for one through the hand-off page", () =>
  Effect.gen(function* () {
    const subject = yield* manager({ stored: STORED });
    subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });
    const asked = yield* Effect.forkChild(subject.instance.obtainSession());

    const page = yield* Effect.promise(() => openedPage(subject.opened));
    yield* returnCode(page);

    assert.equal(yield* Fiber.join(asked), true);
    assert.equal(page.pathname, "/desktop-session.html");
    assert.deepEqual(subject.stored(), { ...STORED, sessionToken: "signed-session" });
  }),
);

it.effect("signed out, there is no session to ask for and no page opens", () =>
  Effect.gen(function* () {
    const subject = yield* manager({});

    assert.equal(yield* subject.instance.obtainSession(), false);
    assert.deepEqual(subject.opened, []);
  }),
);

it.effect("a sign-out ends the Mac's session on the service along with its tokens", () =>
  Effect.gen(function* () {
    const subject = yield* manager({ stored: { ...STORED, sessionToken: "signed-session" } });
    subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });

    yield* subject.instance.signOut({ revokeRemote: true });

    assert.deepEqual(subject.endedSessions, ["signed-session"]);
    assert.equal(subject.stored(), undefined);
  }),
);

it.effect(
  "a sign-in again over an account holding a session keeps it, and ends on the sign-in's card",
  () =>
    Effect.gen(function* () {
      const subject = yield* manager({ stored: { ...STORED, sessionToken: "standing-session" } });
      subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });
      const pending = yield* Effect.forkChild(
        subject.instance.signInAgain(ACCOUNT_PROVIDER.GITHUB),
      );

      const landed = yield* grantCode(subject.authorizations);

      assert.equal(landed.status, 200);
      assert.equal(yield* Fiber.join(pending), true);
      assert.equal(subject.stored()?.sessionToken, "standing-session");
      assert.equal(subject.stored()?.refreshToken, "issued-refresh");
    }),
);

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

it.effect(
  "an account stored before it named an id takes a session for its own address, and the session's id with it",
  () =>
    Effect.gen(function* () {
      const { id: _id, ...unnamed } = STORED;
      const subject = yield* manager({ stored: unnamed });
      subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...unnamed });
      const asked = yield* Effect.forkChild(subject.instance.obtainSession());

      yield* returnCode(yield* Effect.promise(() => openedPage(subject.opened)));

      assert.equal(yield* Fiber.join(asked), true);
      assert.deepEqual(subject.stored(), { ...STORED, sessionToken: "signed-session" });
      assert.deepEqual(subject.endedSessions, []);
    }),
);

it.effect("an account stored without an id still refuses a session for another address", () =>
  Effect.gen(function* () {
    const { id: _id, ...unnamed } = STORED;
    const subject = yield* manager({ stored: unnamed, sessionEmail: "someone@example.com" });
    subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...unnamed });
    const asked = yield* Effect.forkChild(Effect.exit(subject.instance.obtainSession()));

    yield* returnCode(yield* Effect.promise(() => openedPage(subject.opened)));

    assert.equal(Exit.isFailure(yield* Fiber.join(asked)), true);
    assert.deepEqual(subject.stored(), unnamed);
    assert.deepEqual(subject.endedSessions, ["signed-session"]);
  }),
);
