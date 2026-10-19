// account-delete.test.ts -- an account's deletion retires its sessions as its caller reaches eve, over a bearer or a browser's session cookie, then erases it.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  deleteAccount,
  readAccountPreferences,
  readPlanTemplate,
  restorePlanTemplate,
  writeAccountPreferences,
  writePlanTemplate,
} from "@luke/database/models/account-store";
import {
  listTemplateRevisions,
  readTemplateRevision,
} from "@luke/database/models/plan-template-revisions";
import { standingSessionsOf } from "@luke/database/models/recorded-session";
import { user } from "@luke/database/schemas/auth";
import { conversations } from "@luke/database/schemas/storage";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { getTestDB } from "@luke/database/testing";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import { HTTP_METHOD, type WireBoundaryInput } from "@luke/wire";
import { noNetwork } from "@luke/wire/testing";
import { eq } from "drizzle-orm";
import { Clock, Effect, Layer, Option, Redacted, Stream } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { EVE_RESET_OUTCOME, type EveSessions } from "../agents/brain-host/eve-sessions.js";
import { anthropicFastAccess } from "../agents/coder-host/account-keys.js";
import { requestUserId, type SessionEndpoint, type UserInfoEndpoint } from "../auth/bearer.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { modelCatalogOf } from "../providers/model-catalog.js";
import { CONNECTOR_ASKED_NOTHING, integrationConnectOf } from "../testing/integration-connect.js";
import { accountApp } from "./account-app.js";

/**
 * An account's deletion, answered by the account group the way its function
 * answers it, over a real dialect, with the request's account resolved as
 * `resolveHostedUserId` resolves it and the auth service faked. Before
 * anything is erased, every eve session the account's standing
 * conversations run in is retired as the request's own caller: over the
 * bearer where the request carries one, and, where only a browser's session
 * cookie names the account, as the deployment acting for that account. The
 * account a cookie names is the only one it erases, and the only one whose
 * sessions it retires.
 *
 * eve is a fake that writes down each retire with who asked it. Synthetic
 * accounts, bearers, sessions, and session ids throughout.
 */

const ORIGIN = "https://luke.test";

const NO_ENVIRONMENT: HostedEnvironmentValues = {
  openAiKey: undefined,
  anthropicKey: undefined,
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

/** How the fake eve writes down the deployment acting for an account, apart from any bearer a request carried. */
function deploymentFor(account: string): string {
  return `deployment for ${account}`;
}

/** eve as a deletion reaches it: every retire written down with who asked it, and nothing else a deletion asks. */
function retiringEve() {
  const retired: (readonly [string, string])[] = [];
  const asked = (caller: string): EveSessions => ({
    open: () => Effect.die(new Error("a deletion opens no session")),
    send: () => Effect.die(new Error("a deletion sends no message")),
    cancel: () => Effect.die(new Error("an account's deletion cancels no turn")),
    reset: (sessionId) =>
      Effect.sync(() => {
        retired.push([caller, sessionId]);
        return { outcome: EVE_RESET_OUTCOME.RESET };
      }),
    stream: () => Stream.empty,
  });
  return {
    retired,
    eve: (authorization: Redacted.Redacted) => asked(Redacted.value(authorization)),
    eveAs: (account: string) => asked(deploymentFor(account)),
  };
}

const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** A standing conversation of the account, of the kind given, recorded as running in a session of its own: the session's id. */
const sessionOf = (
  userId: string,
  kind: (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND],
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const sessionId = `wrun_${randomUUID()}`;
    yield* db.insert(conversations).values({ userId, kind, runtimeSessionId: sessionId });
    return sessionId;
  });

/**
 * Two accounts, each behind its bearer and its browser's session cookie, and
 * the group answering on the test's database and clock over the eve given,
 * or, with none, over the eve the deployment composes itself, which names no
 * secret and reaches no network.
 */
const openAccounts = (eve: ReturnType<typeof retiringEve> | undefined) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const owner = yield* openUser;
    const other = yield* openUser;
    const accounts = [owner, other];
    const userInfo: UserInfoEndpoint = (input) => {
      const sub = accounts.find((id) => input.headers.get("authorization") === `Bearer ${id}`);
      return Effect.succeed(sub === undefined ? undefined : { sub });
    };
    const session: SessionEndpoint = (input) =>
      Effect.succeed(
        Option.fromNullishOr(
          accounts.find((id) => input.headers.get("cookie") === sessionCookieOf(id)),
        ),
      );
    const app = accountApp({
      resolveUserId: (incoming) => requestUserId(incoming, userInfo, session),
      eveOrigin: () => ORIGIN,
      ...(eve === undefined ? undefined : { eve: eve.eve, eveAs: eve.eveAs }),
      standingSessions: (userId) => standingSessionsOf(userId),
      deleteUser: deleteAccount,
      readPreferences: readAccountPreferences,
      anthropicFastAccess,
      writePreferences: writeAccountPreferences,
      readPlanTemplate,
      writePlanTemplate,
      listPlanTemplateRevisions: listTemplateRevisions,
      readPlanTemplateRevision: readTemplateRevision,
      restorePlanTemplate,
    });
    const stands = (userId: string) =>
      Effect.map(
        db.select({ id: user.id }).from(user).where(eq(user.id, userId)),
        (rows) => rows.length === 1,
      );
    return { owner, other, stands, ask: (request: Request) => answer(app, request) };
  });

const answer = (app: ReturnType<typeof accountApp>, request: Request) =>
  Effect.gen(function* () {
    // The handler runs on the router's own fiber, so it is handed the test's clock and services.
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(HostedEnvironment, NO_ENVIRONMENT),
      noNetwork,
      modelCatalogOf([]),
      // A delete revokes each provider's first grant whatever the account holds, which Connect takes; nothing else is asked.
      integrationConnectOf(() => ({ ...CONNECTOR_ASKED_NOTHING, revoke: () => Effect.void })),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      app.pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() => handler(request));
    const text = yield* Effect.promise(() => response.text());
    yield* Effect.promise(() => dispose());
    // SAFETY: the group answers JSON; the test compares it as the wire value it is.
    const body = JSON.parse(text) as WireBoundaryInput;
    return { status: response.status, body } satisfies Answer;
  });

function sent(path: string, method: string, headers: Record<string, string>): Request {
  return new Request(new URL(path, ORIGIN), { method, headers });
}

/** Each retire as eve heard it, in an order of its own, since the deletion retires a few at a time. */
const inOrder = (retired: readonly (readonly [string, string])[]) =>
  retired.map(([caller, sessionId]) => `${caller} ${sessionId}`).toSorted();

it.layer(getTestDB())("an account's deletion", (it) => {
  it.effect(
    "over a browser's session cookie erases the account the cookie names alone, retiring every session of that account's standing conversations as the deployment acting for it and none of another account's",
    () =>
      Effect.gen(function* () {
        const eve = retiringEve();
        const { owner, other, stands, ask } = yield* openAccounts(eve);
        const taskSession = yield* sessionOf(owner, CONVERSATION_KIND.TASK);
        const agentSession = yield* sessionOf(owner, CONVERSATION_KIND.CODING_AGENT);
        yield* sessionOf(other, CONVERSATION_KIND.TASK);
        const cookie = sessionCookieOf(owner);

        const read = yield* ask(
          sent(HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES, HTTP_METHOD.GET, { cookie }),
        );
        assert.equal(read.status, HOSTED_HTTP_STATUS.OK, "the cookie names the account on a read");
        assert.deepEqual(
          yield* ask(sent(HOSTED_SERVICE_PATH.ACCOUNT_DELETE, HTTP_METHOD.POST, { cookie })),
          { status: HOSTED_HTTP_STATUS.OK, body: { deleted: true } },
        );

        assert.deepEqual(
          inOrder(eve.retired),
          inOrder([
            [deploymentFor(owner), taskSession],
            [deploymentFor(owner), agentSession],
          ]),
        );
        assert.equal(yield* stands(owner), false, "the cookie erased its account");
        assert.equal(yield* stands(other), true, "and no other");
      }),
  );

  it.effect(
    "over the bearer retires the account's sessions over that bearer as it came, whatever cookie rides beside it, and erases the bearer's account",
    () =>
      Effect.gen(function* () {
        const eve = retiringEve();
        const { owner, other, stands, ask } = yield* openAccounts(eve);
        const taskSession = yield* sessionOf(owner, CONVERSATION_KIND.TASK);
        yield* sessionOf(other, CONVERSATION_KIND.TASK);

        assert.deepEqual(
          yield* ask(
            sent(HOSTED_SERVICE_PATH.ACCOUNT_DELETE, HTTP_METHOD.POST, {
              authorization: `Bearer ${owner}`,
              cookie: sessionCookieOf(other),
            }),
          ),
          { status: HOSTED_HTTP_STATUS.OK, body: { deleted: true } },
        );

        assert.deepEqual(eve.retired, [[`Bearer ${owner}`, taskSession]]);
        assert.equal(yield* stands(owner), false);
        assert.equal(yield* stands(other), true);
      }),
  );

  it.effect(
    "over a browser's session cookie is refused as unavailable, erasing nothing, on a deployment that cannot reach eve as itself, while the bearer's deletion goes on with its retires a courtesy",
    () =>
      Effect.gen(function* () {
        const { owner, other, stands, ask } = yield* openAccounts(undefined);
        yield* sessionOf(owner, CONVERSATION_KIND.TASK);
        yield* sessionOf(other, CONVERSATION_KIND.TASK);

        assert.deepEqual(
          yield* ask(
            sent(HOSTED_SERVICE_PATH.ACCOUNT_DELETE, HTTP_METHOD.POST, {
              cookie: sessionCookieOf(owner),
            }),
          ),
          {
            status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
            body: { error: HOSTED_API_ERROR.UNAVAILABLE },
          },
        );
        assert.equal(yield* stands(owner), true, "the cookie's deletion erased nothing");
        assert.deepEqual(
          yield* ask(
            sent(HOSTED_SERVICE_PATH.ACCOUNT_DELETE, HTTP_METHOD.POST, {
              authorization: `Bearer ${other}`,
            }),
          ),
          { status: HOSTED_HTTP_STATUS.OK, body: { deleted: true } },
        );
        assert.equal(
          yield* stands(other),
          false,
          "the bearer's went on though eve was out of reach",
        );
      }),
  );
});
