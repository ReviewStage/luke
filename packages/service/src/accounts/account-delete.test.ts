// account-delete.test.ts -- an account's deletion retires its agents' sessions, over a session bearer or a browser's session cookie, then has Better Auth erase it.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  readAccountAccess,
  readAccountDeletionReach,
  readAccountPreferences,
  settleAccountDeletion,
  writeAccountPreferences,
} from "@repo/database/models/account-store";
import { standingSessionsOf } from "@repo/database/models/recorded-session";
import { user } from "@repo/database/schemas/auth";
import { conversations } from "@repo/database/schemas/storage";
import { CONVERSATION_KIND } from "@repo/database/storage-vocabulary";
import { getTestDB } from "@repo/database/testing";
import { HOSTED_API_ERROR, HOSTED_SERVICE_PATH } from "@repo/features";
import { HTTP_METHOD, type WireBoundaryInput } from "@repo/wire";
import { noNetwork } from "@repo/wire/testing";
import { eq } from "drizzle-orm";
import { Clock, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { accountFastOffer } from "../agents/coder-host/agent-runtime-choice.js";
import { NATIVE_SESSION_PREFIX } from "../agents/coder-host/native-runtime.js";
import type { NativeAgentSessions } from "../agents/coder-host/runtime-sessions.js";
import { type AgentSessions, EVE_RESET_OUTCOME } from "../agents/eve-host/eve-sessions.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { modelCatalogOf } from "../providers/model-catalog.js";
import { hostedAnswer } from "../testing/hosted-route.js";
import { CONNECTOR_ASKED_NOTHING, integrationConnectOf } from "../testing/integration-connect.js";
import { harnessFor, scriptedHarnessLayer } from "../testing/native-harness-fake.js";
import type { AccountDeletionCalls } from "./account-deletion-calls.js";
import { accountProcedures } from "./account-procedures.js";

/**
 * An account's deletion, answered by the account procedures the way the
 * hosted oRPC route answers it, over a real dialect, with the request's account resolved as
 * `resolveHostedUserId` resolves it and the auth service faked. Before
 * anything is erased, every session the account's standing agents'
 * conversations run in is retired through its harness, acting for the
 * account the request named, over its bearer or, where only a browser's
 * session cookie names the account, as the deployment acting for it, which
 * a deployment with no secret of its own cannot be. The account a cookie
 * names is the only one it erases, and the only one whose sessions it
 * retires.
 *
 * The harness is a fake that writes down each retire with whom it acted
 * for. Synthetic accounts, bearers, sessions, and session ids throughout.
 */

const ORIGIN = "https://app.test";

const NO_ENVIRONMENT: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
};

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** The cookie a browser signed in to the account sends, as the fake auth service reads it. */
function sessionCookieOf(userId: string): string {
  return `better-auth.session_token=${userId}`;
}

/** A harness as a deletion reaches it: every retire written down with whom it acted for, and nothing else a deletion asks. */
function retiringEve() {
  const retired: (readonly [string, string])[] = [];
  const asked = (caller: string): AgentSessions => ({
    open: () => Effect.die(new Error("a deletion opens no session")),
    send: () => Effect.die(new Error("a deletion sends no message")),
    cancel: () => Effect.die(new Error("an account's deletion cancels no turn")),
    reset: (sessionId) =>
      Effect.sync(() => {
        retired.push([caller, sessionId]);
        return { outcome: EVE_RESET_OUTCOME.RESET };
      }),
  });
  return {
    retired,
    harness: scriptedHarnessLayer((account) => asked(harnessFor(account))),
  };
}

const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
  return userId;
});

/** A standing conversation of the account, of the kind given, recorded as running in a Claude Code session of its own: the session's id. */
const sessionOf = (
  userId: string,
  kind: (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND],
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const sessionId = `${NATIVE_SESSION_PREFIX.claude_code}${randomUUID()}`;
    yield* db.insert(conversations).values({ userId, kind, runtimeSessionId: sessionId });
    return sessionId;
  });

/**
 * Two accounts, each behind its session bearer and its browser's session
 * cookie, and the procedures answering on the test's database and clock over
 * the harness given. Better Auth's own delete is faked: it holds a session
 * fresh as `fresh` says and deletes the user row the session names, as
 * Better Auth's does, every dependent row cascading.
 */
const openAccounts = (eve: ReturnType<typeof retiringEve>, fresh = true) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const services = yield* Effect.context<Database | SqlClient.SqlClient>();
    const owner = yield* openUser;
    const other = yield* openUser;
    const accounts = [owner, other];
    const accountOf = (headers: Headers) =>
      accounts.find(
        (id) =>
          headers.get("authorization") === `Bearer ${id}` ||
          headers.get("cookie") === sessionCookieOf(id),
      );
    const accountDeletion: AccountDeletionCalls = {
      sessionFresh: () => Effect.succeed(fresh),
      deleteUser: (headers) =>
        Effect.orDie(
          Effect.provide(db.delete(user).where(eq(user.id, accountOf(headers) ?? "")), services),
        ),
    };
    const procedures = accountProcedures({
      resolveUserId: (incoming) =>
        Effect.succeed(Option.fromNullishOr(accountOf(incoming.headers))),
      resolveSessionUserId: (incoming) =>
        Effect.succeed(Option.fromNullishOr(accountOf(incoming.headers))),
      standingSessions: (userId) => standingSessionsOf(userId),
      readDeletionReach: readAccountDeletionReach,
      settleDeletion: settleAccountDeletion,
      accountDeletion,
      readPreferences: readAccountPreferences,
      readAccess: readAccountAccess,
      accountFastOffer,
      writePreferences: writeAccountPreferences,
    });
    const stands = (userId: string) =>
      Effect.map(
        db.select({ id: user.id }).from(user).where(eq(user.id, userId)),
        (rows) => rows.length === 1,
      );
    return {
      owner,
      other,
      stands,
      ask: (request: Request) => answer(procedures, request, eve.harness),
    };
  });

const answer = (
  procedures: ReturnType<typeof accountProcedures>,
  request: Request,
  harness: Layer.Layer<NativeAgentSessions> | Layer.Layer<never>,
) =>
  Effect.gen(function* () {
    // The procedures run on oRPC's own fiber, so they are handed the test's clock and services.
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(HostedEnvironment, NO_ENVIRONMENT),
      harness,
      noNetwork,
      modelCatalogOf([]),
      // A delete revokes each provider's first grant whatever the account holds, which Connect takes; nothing else is asked.
      integrationConnectOf(() => ({ ...CONNECTOR_ASKED_NOTHING, revoke: () => Effect.void })),
    );
    const response = yield* hostedAnswer({ account: procedures }, services, request);
    const text = yield* Effect.promise(() => response.text());
    // SAFETY: the route answers JSON; the test compares it as the wire value it is.
    const body = JSON.parse(text) as WireBoundaryInput;
    return { status: response.status, body } satisfies Answer;
  });

function sent(path: string, method: string, headers: Record<string, string>): Request {
  return new Request(new URL(path, ORIGIN), { method, headers });
}

it.layer(getTestDB())("an account's deletion", (it) => {
  it.effect(
    "over a browser's session cookie erases the account the cookie names alone, retiring every session of that account's standing agents' conversations through the harness acting for it, none of another account's, and none of a conversation of another kind",
    () =>
      Effect.gen(function* () {
        const eve = retiringEve();
        const { owner, other, stands, ask } = yield* openAccounts(eve);
        const mainSession = yield* sessionOf(owner, CONVERSATION_KIND.MAIN);
        const agentSession = yield* sessionOf(owner, CONVERSATION_KIND.AGENT);
        yield* sessionOf(other, CONVERSATION_KIND.MAIN);
        const cookie = sessionCookieOf(owner);

        const read = yield* ask(
          sent(HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES, HTTP_METHOD.GET, { cookie }),
        );
        assert.equal(read.status, HOSTED_HTTP_STATUS.OK, "the cookie names the account on a read");
        assert.deepEqual(
          yield* ask(sent(HOSTED_SERVICE_PATH.ACCOUNT_DELETE, HTTP_METHOD.POST, { cookie })),
          { status: HOSTED_HTTP_STATUS.OK, body: { deleted: true } },
        );

        assert.notEqual(mainSession, agentSession);
        assert.deepEqual(eve.retired, [[harnessFor(owner), agentSession]]);
        assert.equal(yield* stands(owner), false, "the cookie erased its account");
        assert.equal(yield* stands(other), true, "and no other");
      }),
  );

  it.effect(
    "over the bearer retires the account's sessions through the harness acting for the bearer's account, whatever cookie rides beside it, and erases that account",
    () =>
      Effect.gen(function* () {
        const eve = retiringEve();
        const { owner, other, stands, ask } = yield* openAccounts(eve);
        const agentSession = yield* sessionOf(owner, CONVERSATION_KIND.AGENT);
        yield* sessionOf(other, CONVERSATION_KIND.AGENT);

        assert.deepEqual(
          yield* ask(
            sent(HOSTED_SERVICE_PATH.ACCOUNT_DELETE, HTTP_METHOD.POST, {
              authorization: `Bearer ${owner}`,
              cookie: sessionCookieOf(other),
            }),
          ),
          { status: HOSTED_HTTP_STATUS.OK, body: { deleted: true } },
        );

        assert.deepEqual(eve.retired, [[harnessFor(owner), agentSession]]);
        assert.equal(yield* stands(owner), false);
        assert.equal(yield* stands(other), true);
      }),
  );

  it.effect(
    "over a session signed in longer ago than Better Auth deletes for is refused, retiring nothing and erasing nothing",
    () =>
      Effect.gen(function* () {
        const eve = retiringEve();
        const { owner, stands, ask } = yield* openAccounts(eve, false);
        yield* sessionOf(owner, CONVERSATION_KIND.AGENT);

        const refused = yield* ask(
          sent(HOSTED_SERVICE_PATH.ACCOUNT_DELETE, HTTP_METHOD.POST, {
            authorization: `Bearer ${owner}`,
          }),
        );

        assert.deepEqual(refused, {
          status: HOSTED_HTTP_STATUS.FORBIDDEN,
          body: { error: HOSTED_API_ERROR.SESSION_NOT_FRESH },
        });
        assert.deepEqual(eve.retired, []);
        assert.equal(yield* stands(owner), true);
      }),
  );
});
