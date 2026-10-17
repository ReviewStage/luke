// account-delete.test.ts -- an account's deletion takes the bearer alone: a session cookie erases nothing.
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
import { getTestDB } from "@luke/database/testing";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import { HTTP_METHOD, type WireBoundaryInput } from "@luke/wire";
import { eq } from "drizzle-orm";
import { Clock, Effect, Layer, Option } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { anthropicFastAccess } from "../agents/coder-host/account-keys.js";
import { requestUserId, type SessionEndpoint, type UserInfoEndpoint } from "../auth/bearer.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { modelCatalogOf } from "../providers/model-catalog.js";
import { CONNECTOR_ASKED_NOTHING, integrationConnectOf } from "../testing/integration-connect.js";
import { noNetwork } from "../testing/no-network.js";
import { accountApp } from "./account-app.js";

/**
 * An account's deletion, answered by the account group the way its function
 * answers it, over a real dialect, with the request's account resolved as
 * `resolveHostedUserId` resolves it and the auth service faked: the bearer
 * erases the account, and a request that only a browser's session cookie
 * names is refused before anything is retired or erased, because the
 * retires reach eve over the bearer and a cookie carries none eve takes,
 * while the same cookie still names the account on a read.
 *
 * Synthetic accounts, bearers, and sessions throughout.
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

/** One account, behind its bearer and its browser's session cookie, and the group answering on the test's database and clock. */
const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const owner = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: owner, name: "Test User", email: `${owner}@luke.test` });
  const userInfo: UserInfoEndpoint = (input) =>
    Effect.succeed(
      input.headers.get("authorization") === `Bearer ${owner}` ? { sub: owner } : undefined,
    );
  const session: SessionEndpoint = (input) =>
    Effect.succeed(
      input.headers.get("cookie") === sessionCookieOf(owner) ? Option.some(owner) : Option.none(),
    );
  const app = accountApp({
    resolveUserId: (incoming) => requestUserId(incoming, userInfo, session),
    // An account with no standing conversation retires no session, so no eve is reached.
    eveOrigin: () => undefined,
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
  const stands = Effect.map(
    db.select({ id: user.id }).from(user).where(eq(user.id, owner)),
    (rows) => rows.length === 1,
  );
  return { owner, stands, ask: (request: Request) => answer(app, request) };
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

it.layer(getTestDB())("an account's deletion", (it) => {
  it.effect(
    "takes the bearer alone: a session cookie that reads the account's preferences erases nothing, and the bearer erases it",
    () =>
      Effect.gen(function* () {
        const { owner, stands, ask } = yield* openAccount;
        const cookie = sessionCookieOf(owner);

        const read = yield* ask(
          sent(HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES, HTTP_METHOD.GET, { cookie }),
        );
        assert.equal(read.status, HOSTED_HTTP_STATUS.OK, "the cookie names the account on a read");
        assert.deepEqual(
          yield* ask(sent(HOSTED_SERVICE_PATH.ACCOUNT_DELETE, HTTP_METHOD.POST, { cookie })),
          {
            status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
            body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
          },
        );
        assert.equal(yield* stands, true, "the account stands");

        assert.deepEqual(
          yield* ask(
            sent(HOSTED_SERVICE_PATH.ACCOUNT_DELETE, HTTP_METHOD.POST, {
              authorization: `Bearer ${owner}`,
              cookie,
            }),
          ),
          { status: HOSTED_HTTP_STATUS.OK, body: { deleted: true } },
        );
        assert.equal(yield* stands, false, "the bearer erased it");
      }),
  );
});
