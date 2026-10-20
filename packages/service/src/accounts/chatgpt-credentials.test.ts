import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { type KeyRing, parseKeyRing } from "@luke/database/models/provider-key-seal";
import { listProviderKeyRows, saveProviderKey } from "@luke/database/models/provider-key-store";
import { accountProviderKey } from "@luke/database/schemas/account-provider-key";
import { user } from "@luke/database/schemas/auth";
import { getTestDB } from "@luke/database/testing";
import {
  type ChatGptCredentialsSaveRequest,
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
} from "@luke/features/provider-key-wire";
import {
  HTTP_STATUS,
  jsonResponse,
  type RecordedRequest,
  recordingHttpClient,
} from "@luke/wire/testing";
import { eq } from "drizzle-orm";
import { Clock, DateTime, Duration, Effect, Fiber, Redacted, Result } from "effect";
import { TestClock } from "effect/testing";
import { driven, forkClockDriven } from "../testing/clock-driven.js";
import {
  CHATGPT_ACCESS,
  CHATGPT_OAUTH,
  type ChatGptAccess,
  refreshChatGptAccess,
  removeChatGptCredentials,
  sealChatGptCredentials,
} from "./chatgpt-credentials.js";

/**
 * An account's ChatGPT sign-in renewed and revoked against a fake of
 * OpenAI's authorization server, over a real dialect: a renewal rotates the
 * refresh token and replaces the access token, its expiry and the scopes
 * together; two renewals at once run one after the other, so the rotating
 * refresh token is never presented twice; a refresh token OpenAI refuses for
 * good marks the sign-in invalid; and removing the sign-in revokes its
 * session first, whether or not OpenAI confirms it.
 *
 * Synthetic accounts and tokens throughout; the key-encryption key is fixed
 * bytes written for this file.
 */

const KEK = `1:${Buffer.alloc(32, 5).toString("base64")}`;

function ring(): KeyRing {
  const parsed = parseKeyRing(Redacted.make(KEK));
  if (Result.isFailure(parsed)) return assert.fail(`not a ring: ${parsed.failure}`);
  return parsed.success;
}

const ISSUED_CLIENT = "oaiapp_test_client";
const REVOCATION_URL = "https://auth.openai.com/oauth/revoke";
const GRANTED = [CHATGPT_OAUTH.USAGE_SCOPE, "offline_access", "openid"];

/** The form a recorded request carried, however the client encoded it. */
async function formOf(request: RecordedRequest): Promise<URLSearchParams> {
  return new URLSearchParams(await new Response(request.init.body).text());
}

/** What the fake answers, as a test sets it: the revocation's status, and a status every renewal is answered with. */
interface FakeServerState {
  revocationStatus: number;
  tokenStatus: number | undefined;
  /** The scopes a renewal is answered as granting. */
  granted: readonly string[];
  /** Where the discovery document says to revoke. */
  revocationEndpoint: string;
}

/** A gate renewals wait at until it is opened, which a second renewal arriving opens too. */
interface RenewalGate {
  readonly arrived: Promise<void>;
  open(): void;
}

/**
 * OpenAI's authorization server as far as the service reaches it: a token
 * endpoint that rotates the refresh token on every renewal and refuses one
 * already used, a discovery document naming the revocation endpoint, and
 * that endpoint, which answers what the test sets.
 */
function fakeAuthorizationServer(initialRefresh: string) {
  let current = initialRefresh;
  let issued = 0;
  let renewals = 0;
  let gate: { opened: Promise<void>; open: () => void; reached: () => void } | undefined;
  const state: FakeServerState = {
    revocationStatus: HTTP_STATUS.OK,
    tokenStatus: undefined,
    granted: GRANTED,
    revocationEndpoint: REVOCATION_URL,
  };
  /** Holds every renewal at a gate from here on, until the test opens it or a second renewal arrives. */
  const holdRenewals = (): RenewalGate => {
    const opening = Promise.withResolvers<void>();
    const arriving = Promise.withResolvers<void>();
    gate = { opened: opening.promise, open: opening.resolve, reached: arriving.resolve };
    return { arrived: arriving.promise, open: opening.resolve };
  };
  const http = recordingHttpClient(async (request) => {
    if (request.url === CHATGPT_OAUTH.DISCOVERY_URL) {
      return jsonResponse({
        issuer: "https://auth.openai.com",
        revocation_endpoint: state.revocationEndpoint,
      });
    }
    if (request.url !== CHATGPT_OAUTH.TOKEN_URL) {
      return new Response(null, { status: state.revocationStatus });
    }
    renewals += 1;
    if (gate !== undefined) {
      // A second renewal let through while the first is held is the race the lock exists to prevent: both are let go at once.
      if (renewals === 1) gate.reached();
      else gate.open();
      await gate.opened;
    }
    if (state.tokenStatus !== undefined) return jsonResponse({}, state.tokenStatus);
    const form = await formOf(request);
    assert.equal(form.get("grant_type"), "refresh_token");
    assert.equal(form.get("client_id"), ISSUED_CLIENT);
    assert.equal(form.get("resource"), CHATGPT_OAUTH.RESOURCE);
    assert.equal(form.get("scope"), null, "a renewal names no scope, so the grant is kept");
    if (form.get("refresh_token") !== current) {
      return jsonResponse({ error: "refresh_token_reused" }, HTTP_STATUS.BAD_REQUEST);
    }
    issued += 1;
    current = `refresh-${issued}`;
    return jsonResponse({
      access_token: `access-${issued}`,
      refresh_token: current,
      expires_in: 3600,
      scope: state.granted.join(" "),
      token_type: "Bearer",
    });
  });
  return { http, state, holdRenewals, current: () => current };
}

const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  }
  return { owner, other };
});

const signIn = (userId: string, overrides: Partial<ChatGptCredentialsSaveRequest> = {}) =>
  Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const request: ChatGptCredentialsSaveRequest = {
      clientId: ISSUED_CLIENT,
      accountId: "chatgpt-subject",
      accessToken: "access-0",
      refreshToken: "refresh-0",
      idToken: "id-token-0",
      expiresInSeconds: 3600,
      scopes: GRANTED,
      ...overrides,
    };
    const { sealed, accessExpiresAt, hint } = sealChatGptCredentials(ring(), userId, request, now);
    const kept = yield* saveProviderKey(
      userId,
      PROVIDER_KEY_PROVIDER.OPENAI,
      PROVIDER_KEY_KIND.CHATGPT_OAUTH,
      sealed,
      hint,
      null,
      now,
      accessExpiresAt,
    );
    assert.ok(kept);
  });

/** An access token as OpenAI shapes one, a JWT whose only claim read is `exp`, in Unix seconds; unsigned, as nothing verifies it. */
const accessTokenExpiringAt = (exp: number) =>
  ["header", Buffer.from(JSON.stringify({ exp })).toString("base64url"), "signature"].join(".");

const tokenOf = (access: ChatGptAccess) =>
  access.outcome === CHATGPT_ACCESS.READY ? Redacted.value(access.accessToken) : access.outcome;

const rowOf = (userId: string) =>
  Effect.map(listProviderKeyRows(userId, PROVIDER_KEY_KIND.CHATGPT_OAUTH), (rows) => rows[0]);

it.layer(getTestDB())("a ChatGPT sign-in's renewal and revocation", (it) => {
  it.effect(
    "an access token still good past the margin is handed out as it stands; one near its expiry is renewed, its refresh token rotated, and the renewal stored",
    () => {
      const server = fakeAuthorizationServer("refresh-0");
      return Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        const signedInAt = yield* Clock.currentTimeMillis;
        yield* signIn(owner);

        const fresh = yield* refreshChatGptAccess(owner, ring());
        assert.equal(tokenOf(fresh), "access-0");
        assert.equal(
          server.current(),
          "refresh-0",
          "the refresh token is not rotated while the token is good",
        );

        yield* TestClock.adjust("55 minutes");
        const renewed = yield* refreshChatGptAccess(owner, ring());
        assert.equal(tokenOf(renewed), "access-1");
        assert.equal(
          renewed.outcome === CHATGPT_ACCESS.READY ? renewed.expiresAt.getTime() : 0,
          signedInAt + (55 + 60) * 60 * 1000,
        );
        assert.equal(server.current(), "refresh-1");

        // The renewal was stored: a second renewal an hour on presents the rotated refresh token.
        yield* TestClock.adjust("1 hour");
        assert.equal(tokenOf(yield* refreshChatGptAccess(owner, ring())), "access-2");
        const row = yield* rowOf(owner);
        assert.equal(row?.status, PROVIDER_KEY_STATUS.UNVERIFIED);
        assert.equal(row?.accessExpiresAt?.getTime(), signedInAt + (115 + 60) * 60 * 1000);
      }).pipe(Effect.provide(server.http.layer));
    },
  );

  it.effect(
    "two renewals at once run one after the other: OpenAI sees the refresh token once, and both callers get the one renewed access token",
    () => {
      const server = fakeAuthorizationServer("refresh-0");
      return Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        yield* signIn(owner);
        yield* TestClock.adjust("2 hours");

        const gate = server.holdRenewals();
        const first = yield* Effect.forkChild(refreshChatGptAccess(owner, ring()));
        const second = yield* Effect.forkChild(refreshChatGptAccess(owner, ring()));
        // The first renewal is held at OpenAI; the second is given every turn of the event loop it needs to read the row too, were it not held behind the lock.
        yield* Effect.promise(() => gate.arrived);
        for (let turn = 0; turn < 50; turn += 1) {
          yield* Effect.promise(() => new Promise<void>((settle) => setImmediate(settle)));
        }
        gate.open();
        const both = [yield* Fiber.join(first), yield* Fiber.join(second)];

        assert.deepEqual(both.map(tokenOf), ["access-1", "access-1"]);
        assert.equal(server.current(), "refresh-1", "the refresh token was rotated once");
      }).pipe(Effect.provide(server.http.layer));
    },
  );

  it.effect(
    "a refresh token OpenAI refuses for good marks the sign-in invalid and keeps it; a server error changes nothing",
    () => {
      const server = fakeAuthorizationServer("refresh-0");
      return Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        yield* signIn(owner);
        yield* TestClock.adjust("2 hours");

        server.state.tokenStatus = HTTP_STATUS.SERVER_ERROR;
        assert.equal(
          tokenOf(yield* refreshChatGptAccess(owner, ring())),
          CHATGPT_ACCESS.UNREACHABLE,
        );
        assert.equal((yield* rowOf(owner))?.status, PROVIDER_KEY_STATUS.UNVERIFIED);

        server.state.tokenStatus = undefined;
        yield* signIn(owner, { refreshToken: "refresh-stale" });
        yield* TestClock.adjust("2 hours");
        assert.equal(
          tokenOf(yield* refreshChatGptAccess(owner, ring())),
          CHATGPT_ACCESS.SIGNED_OUT,
        );
        assert.equal((yield* rowOf(owner))?.status, PROVIDER_KEY_STATUS.INVALID);

        // An invalid sign-in stays signed out, even where OpenAI would now take its refresh token.
        yield* signIn(owner, { refreshToken: "refresh-stale" });
        yield* Database.use((db) =>
          db
            .update(accountProviderKey)
            .set({ status: PROVIDER_KEY_STATUS.INVALID, accessExpiresAt: new Date(0) })
            .where(eq(accountProviderKey.userId, owner)),
        );
        assert.equal(
          tokenOf(yield* refreshChatGptAccess(owner, ring())),
          CHATGPT_ACCESS.SIGNED_OUT,
        );
        assert.equal(server.current(), "refresh-0");
      }).pipe(Effect.provide(server.http.layer));
    },
  );

  it.effect("a renewal reads and writes the caller's own sign-in alone", () => {
    const server = fakeAuthorizationServer("refresh-0");
    return Effect.gen(function* () {
      const { owner, other } = yield* openAccounts;
      yield* signIn(owner);
      yield* TestClock.adjust("2 hours");

      assert.equal(tokenOf(yield* refreshChatGptAccess(other, ring())), CHATGPT_ACCESS.NONE);
      assert.equal(server.current(), "refresh-0");
      assert.equal(tokenOf(yield* refreshChatGptAccess(owner, ring())), "access-1");
      assert.equal(yield* rowOf(other), undefined);
    }).pipe(Effect.provide(server.http.layer));
  });

  it.effect(
    "removing the sign-in revokes its current refresh token under its issued client first, then removes it",
    () => {
      const server = fakeAuthorizationServer("refresh-0");
      return Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        yield* signIn(owner);

        assert.equal(yield* removeChatGptCredentials(owner, ring()), true);

        const revocation = server.http.requests.find((request) => request.url === REVOCATION_URL);
        assert.ok(revocation);
        const form = yield* Effect.promise(() => formOf(revocation));
        assert.deepEqual(
          [form.get("token"), form.get("token_type_hint"), form.get("client_id")],
          ["refresh-0", "refresh_token", ISSUED_CLIENT],
        );
        assert.equal(yield* rowOf(owner), undefined);
        assert.equal(
          yield* removeChatGptCredentials(owner, ring()),
          true,
          "nothing left to revoke",
        );
      }).pipe(Effect.provide(server.http.layer));
    },
  );

  it.effect(
    "a revocation OpenAI keeps failing is tried again, then the sign-in is removed anyway and answered unconfirmed",
    () => {
      const server = fakeAuthorizationServer("refresh-0");
      return Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        yield* signIn(owner);
        server.state.revocationStatus = HTTP_STATUS.SERVER_ERROR;

        const removing = yield* forkClockDriven(removeChatGptCredentials(owner, ring()));
        assert.equal(yield* driven(removing, Duration.seconds(1)), false);

        assert.equal(yield* rowOf(owner), undefined);
      }).pipe(Effect.provide(server.http.layer));
    },
  );

  it.effect(
    "a sign-in handed over late is renewed by its access token's own expiry, not by when it was saved",
    () => {
      const server = fakeAuthorizationServer("refresh-0");
      return Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        // OpenAI issued the token to expire an hour on; the desktop saves it 50 minutes later.
        const issuedAt = yield* Clock.currentTimeMillis;
        yield* TestClock.adjust("50 minutes");
        yield* signIn(owner, { accessToken: accessTokenExpiringAt((issuedAt + 3_600_000) / 1000) });

        assert.equal(tokenOf(yield* refreshChatGptAccess(owner, ring())), "access-1");
        assert.equal(
          (yield* rowOf(owner))?.accessExpiresAt?.getTime(),
          issuedAt + (50 + 60) * 60 * 1000,
        );
      }).pipe(Effect.provide(server.http.layer));
    },
  );

  it.effect(
    "a renewal whose grant lost the plan's scope is kept, since it rotated the refresh token, and marks the sign-in invalid",
    () => {
      const server = fakeAuthorizationServer("refresh-0");
      return Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        yield* signIn(owner);
        yield* TestClock.adjust("2 hours");
        server.state.granted = ["openid", "offline_access"];

        assert.equal(
          tokenOf(yield* refreshChatGptAccess(owner, ring())),
          CHATGPT_ACCESS.SIGNED_OUT,
        );
        assert.equal((yield* rowOf(owner))?.status, PROVIDER_KEY_STATUS.INVALID);

        // The rotated refresh token is the one kept, so its revocation names it.
        assert.equal(yield* removeChatGptCredentials(owner, ring()), true);
        const revocation = server.http.requests.find((request) => request.url === REVOCATION_URL);
        assert.ok(revocation);
        assert.equal((yield* Effect.promise(() => formOf(revocation))).get("token"), "refresh-1");
      }).pipe(Effect.provide(server.http.layer));
    },
  );

  it.effect(
    "a revocation endpoint off OpenAI's own server is sent no refresh token, and the removal is answered unconfirmed",
    () => {
      const server = fakeAuthorizationServer("refresh-0");
      return Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        yield* signIn(owner);
        server.state.revocationEndpoint = "https://attacker.test/revoke";

        assert.equal(yield* removeChatGptCredentials(owner, ring()), false);
        assert.ok(
          server.http.requests.every(
            (request) => new URL(request.url).origin !== "https://attacker.test",
          ),
        );
        assert.equal(yield* rowOf(owner), undefined);
      }).pipe(Effect.provide(server.http.layer));
    },
  );
});
