import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { type KeyRing, parseKeyRing } from "@luke/database/models/provider-key-seal";
import { listProviderKeyRows, saveProviderKey } from "@luke/database/models/provider-key-store";
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
import { DateTime, Duration, Effect, Redacted, Result } from "effect";
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
  const state: FakeServerState = { revocationStatus: HTTP_STATUS.OK, tokenStatus: undefined };
  const http = recordingHttpClient(async (request) => {
    if (request.url === CHATGPT_OAUTH.DISCOVERY_URL) {
      return jsonResponse({
        issuer: "https://auth.openai.com",
        revocation_endpoint: REVOCATION_URL,
      });
    }
    if (request.url === REVOCATION_URL) {
      return new Response(null, { status: state.revocationStatus });
    }
    assert.equal(request.url, CHATGPT_OAUTH.TOKEN_URL);
    // A beat between reading the request and answering, so a second renewal not held behind the first reads the refresh token it is about to rotate.
    await new Promise((settle) => setTimeout(settle, 20));
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
      scope: GRANTED.join(" "),
      token_type: "Bearer",
    });
  });
  return { http, state, current: () => current };
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
        yield* signIn(owner);

        const fresh = yield* refreshChatGptAccess(owner, ring());
        assert.equal(tokenOf(fresh), "access-0");
        assert.equal(server.http.requests.length, 0, "OpenAI is not asked while the token is good");

        yield* TestClock.adjust("55 minutes");
        const renewed = yield* refreshChatGptAccess(owner, ring());
        assert.equal(tokenOf(renewed), "access-1");
        assert.equal(
          renewed.outcome === CHATGPT_ACCESS.READY ? renewed.expiresAt.getTime() : 0,
          (55 + 60) * 60 * 1000,
        );
        assert.equal(server.current(), "refresh-1");

        // The renewal was stored: a second renewal an hour on presents the rotated refresh token.
        yield* TestClock.adjust("1 hour");
        assert.equal(tokenOf(yield* refreshChatGptAccess(owner, ring())), "access-2");
        const row = yield* rowOf(owner);
        assert.equal(row?.status, PROVIDER_KEY_STATUS.UNVERIFIED);
        assert.equal(row?.accessExpiresAt?.getTime(), (115 + 60) * 60 * 1000);
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

        const both = yield* Effect.all(
          [refreshChatGptAccess(owner, ring()), refreshChatGptAccess(owner, ring())],
          { concurrency: "unbounded" },
        );

        assert.deepEqual(both.map(tokenOf), ["access-1", "access-1"]);
        const presented = yield* Effect.promise(() =>
          Promise.all(server.http.requests.map(formOf)),
        );
        assert.deepEqual(
          presented.map((form) => form.get("refresh_token")),
          ["refresh-0"],
        );
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

        // An invalid sign-in is never presented to OpenAI again.
        const asked = server.http.requests.length;
        assert.equal(
          tokenOf(yield* refreshChatGptAccess(owner, ring())),
          CHATGPT_ACCESS.SIGNED_OUT,
        );
        assert.equal(server.http.requests.length, asked);
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
      assert.equal(server.http.requests.length, 0);
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

        assert.equal(
          server.http.requests.filter((request) => request.url === REVOCATION_URL).length,
          3,
        );
        assert.equal(yield* rowOf(owner), undefined);
      }).pipe(Effect.provide(server.http.layer));
    },
  );
});
