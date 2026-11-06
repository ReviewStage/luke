import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  type KeyRing,
  parseKeyRing,
  sealProviderKey,
} from "@repo/database/models/provider-key-seal";
import { listProviderKeyRows, saveProviderKey } from "@repo/database/models/provider-key-store";
import { accountProviderKey } from "@repo/database/schemas/account-provider-key";
import { user } from "@repo/database/schemas/auth";
import { getTestDB } from "@repo/database/testing";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
} from "@repo/features/provider-key-wire";
import {
  HTTP_STATUS,
  jsonResponse,
  type RecordedRequest,
  recordingHttpClient,
} from "@repo/wire/testing";
import { eq } from "drizzle-orm";
import { Clock, DateTime, Duration, Effect, Fiber, Redacted, Result, Schema } from "effect";
import { TestClock } from "effect/testing";
import { driven, forkClockDriven } from "../testing/clock-driven.js";
import {
  CHATGPT_ACCESS,
  CHATGPT_OAUTH,
  type ChatGptAccess,
  CODEX_DEVICE_OAUTH,
  chatGptPlanOf,
  refreshChatGptAccess,
  removeChatGptCredentials,
  sealCodexDeviceCredentials,
} from "./chatgpt-credentials.js";

/**
 * An account's ChatGPT plan renewed and revoked against a fake of OpenAI's
 * authorization server, over a real dialect: a renewal rotates the refresh
 * token and replaces the access token and its expiry together; two renewals
 * at once run one after the other, so the rotating refresh token is never
 * presented twice; a refresh token OpenAI refuses for good marks the plan
 * invalid; removing the plan revokes its session first, whether or not
 * OpenAI confirms it; and a plan the retired third-party sign-in sealed
 * reads as not connected.
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

const REVOCATION_URL = "https://auth.openai.com/oauth/revoke";

/** A renewal's JSON body, as Codex sends it. */
const RenewalBodySchema = Schema.Struct({
  grant_type: Schema.String,
  client_id: Schema.String,
  refresh_token: Schema.String,
});

/** The form a recorded request carried, however the client encoded it. */
async function formOf(request: RecordedRequest): Promise<URLSearchParams> {
  return new URLSearchParams(await new Response(request.init.body).text());
}

/** What the fake answers, as a test sets it: the revocation's status, and a status every renewal is answered with. */
interface FakeServerState {
  revocationStatus: number;
  tokenStatus: number | undefined;
  /** Where the discovery document says to revoke. */
  revocationEndpoint: string;
}

/** A gate renewals wait at until it is opened, which a second renewal arriving opens too. */
interface RenewalGate {
  readonly arrived: Promise<void>;
  open(): void;
}

/**
 * OpenAI's authorization server as far as the service reaches it: Codex's
 * token endpoint, which rotates the refresh token on every renewal and
 * refuses one already used, a discovery document naming the revocation
 * endpoint, and that endpoint, which answers what the test sets.
 */
function fakeAuthorizationServer(initialRefresh: string) {
  let current = initialRefresh;
  let issued = 0;
  let renewals = 0;
  let gate: { opened: Promise<void>; open: () => void; reached: () => void } | undefined;
  const state: FakeServerState = {
    revocationStatus: HTTP_STATUS.OK,
    tokenStatus: undefined,
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
    if (request.url !== CODEX_DEVICE_OAUTH.TOKEN_URL) {
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
    const body: unknown = JSON.parse(await new Response(request.init.body).text());
    const asked = Schema.decodeUnknownSync(RenewalBodySchema)(body);
    assert.equal(asked.grant_type, "refresh_token");
    assert.equal(asked.client_id, CODEX_DEVICE_OAUTH.CLIENT_ID);
    if (asked.refresh_token !== current) {
      return jsonResponse({ error: "refresh_token_reused" }, HTTP_STATUS.BAD_REQUEST);
    }
    issued += 1;
    current = `refresh-${issued}`;
    return jsonResponse({
      access_token: `access-${issued}`,
      refresh_token: current,
      expires_in: 3600,
      token_type: "Bearer",
    });
  });
  return { http, state, holdRenewals, current: () => current };
}

const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  }
  return { owner, other };
});

/** The account's plan connected through a device-code login, its access token lapsing an hour on. */
const signIn = (userId: string, overrides: { refreshToken?: string } = {}) =>
  Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const accessExpiresAt = new Date(now.getTime() + 3_600_000);
    const { sealed, hint } = sealCodexDeviceCredentials(ring(), userId, {
      accessToken: "access-0",
      refreshToken: overrides.refreshToken ?? "refresh-0",
      idToken: "id-token-0",
      accountId: "chatgpt-subject",
      chatgptAccountId: undefined,
      accessExpiresAt,
    });
    yield* saveProviderKey(
      userId,
      PROVIDER_KEY_PROVIDER.OPENAI,
      PROVIDER_KEY_KIND.CHATGPT_OAUTH,
      sealed,
      hint,
      null,
      now,
      accessExpiresAt,
    );
  });

const tokenOf = (access: ChatGptAccess) =>
  access.outcome === CHATGPT_ACCESS.READY ? Redacted.value(access.accessToken) : access.outcome;

const rowOf = (userId: string) =>
  Effect.map(listProviderKeyRows(userId, PROVIDER_KEY_KIND.CHATGPT_OAUTH), (rows) => rows[0]);

it.layer(getTestDB())("a ChatGPT plan's renewal and revocation", (it) => {
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
    "a refresh token OpenAI refuses for good marks the plan invalid and keeps it; a server error changes nothing",
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

        // An invalid plan stays signed out, even where OpenAI would now take its refresh token.
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

  it.effect("a renewal reads and writes the caller's own plan alone", () => {
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
    "removing the plan revokes its current refresh token under Codex's client first, then removes it",
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
          ["refresh-0", "refresh_token", CODEX_DEVICE_OAUTH.CLIENT_ID],
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
    "a revocation OpenAI keeps failing is tried again, then the plan is removed anyway and answered unconfirmed",
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

  it.effect(
    "a Codex device-code credential renews under Codex's client in Codex's own body, keeps a token not answered, and a refresh token OpenAI refuses marks it invalid",
    () => {
      const renewals: unknown[] = [];
      let refusing = false;
      const http = recordingHttpClient(async (request) => {
        if (request.url !== CODEX_DEVICE_OAUTH.TOKEN_URL)
          return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
        renewals.push(JSON.parse(await new Response(request.init.body).text()));
        if (refusing) return jsonResponse({ error: "invalid_grant" }, HTTP_STATUS.BAD_REQUEST);
        return jsonResponse({ access_token: "codex-access-1", expires_in: 3600 });
      });
      return Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        const now = yield* DateTime.nowAsDate;
        const { sealed, hint } = sealCodexDeviceCredentials(ring(), owner, {
          accessToken: "codex-access-0",
          refreshToken: "codex-refresh-0",
          idToken: "codex-id-0",
          accountId: "chatgpt-subject",
          chatgptAccountId: "chatgpt-workspace",
          accessExpiresAt: new Date(now.getTime() + 3_600_000),
        });
        yield* saveProviderKey(
          owner,
          PROVIDER_KEY_PROVIDER.OPENAI,
          PROVIDER_KEY_KIND.CHATGPT_OAUTH,
          sealed,
          hint,
          null,
          now,
          new Date(now.getTime() + 3_600_000),
        );
        yield* TestClock.adjust("2 hours");

        const renewed = yield* refreshChatGptAccess(owner, ring());
        assert.equal(tokenOf(renewed), "codex-access-1");
        assert.deepEqual(chatGptPlanOf(renewed), { chatgptAccountId: "chatgpt-workspace" });
        assert.deepEqual(renewals, [
          {
            grant_type: "refresh_token",
            client_id: CODEX_DEVICE_OAUTH.CLIENT_ID,
            refresh_token: "codex-refresh-0",
          },
        ]);
        // No scope is granted this flow, and none is asked of it.
        assert.equal((yield* rowOf(owner))?.status, PROVIDER_KEY_STATUS.UNVERIFIED);

        yield* TestClock.adjust("2 hours");
        refusing = true;
        assert.equal(
          tokenOf(yield* refreshChatGptAccess(owner, ring())),
          CHATGPT_ACCESS.SIGNED_OUT,
        );
        assert.equal((yield* rowOf(owner))?.status, PROVIDER_KEY_STATUS.INVALID);
        // The refresh token the answer did not rotate is the one kept, so the refused renewal presented it again.
        assert.deepEqual(renewals.at(-1), {
          grant_type: "refresh_token",
          client_id: CODEX_DEVICE_OAUTH.CLIENT_ID,
          refresh_token: "codex-refresh-0",
        });
      }).pipe(Effect.provide(http.layer));
    },
  );

  it.effect(
    "a plan the retired third-party sign-in sealed, with or without its flow named, reads as not connected and is removed, and OpenAI is asked nothing",
    () => {
      const server = fakeAuthorizationServer("refresh-0");
      return Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        const now = yield* DateTime.nowAsDate;
        // The seal as the third-party sign-in wrote it, before and after it named its flow.
        const thirdParty = {
          clientId: "oaiapp_test_client",
          accountId: "chatgpt-subject",
          accessToken: "access-0",
          refreshToken: "refresh-0",
          idToken: "id-token-0",
          scopes: ["chatgpt.tokens.use.direct", "offline_access", "openid"],
        };
        const sealRetired = (seal: object) =>
          saveProviderKey(
            owner,
            PROVIDER_KEY_PROVIDER.OPENAI,
            PROVIDER_KEY_KIND.CHATGPT_OAUTH,
            sealProviderKey(
              ring(),
              {
                userId: owner,
                provider: PROVIDER_KEY_PROVIDER.OPENAI,
                kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
              },
              Redacted.make(JSON.stringify(seal)),
            ),
            "ChatGPT",
            null,
            now,
            new Date(now.getTime() + 3_600_000),
          );

        yield* sealRetired(thirdParty);
        assert.equal(tokenOf(yield* refreshChatGptAccess(owner, ring())), CHATGPT_ACCESS.NONE);
        assert.equal(yield* rowOf(owner), undefined);

        yield* sealRetired({ flow: "third_party", ...thirdParty });
        assert.equal(yield* removeChatGptCredentials(owner, ring()), true);
        assert.equal(yield* rowOf(owner), undefined);
        assert.deepEqual(server.http.requests, []);
      }).pipe(Effect.provide(server.http.layer));
    },
  );
});
