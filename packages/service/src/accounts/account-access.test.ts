import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  deleteAccount,
  readAccountPreferences,
  readAccountRole,
  readPlanTemplate,
  restorePlanTemplate,
  writeAccountPreferences,
  writePlanTemplate,
} from "@luke/database/models/account-store";
import {
  listTemplateRevisions,
  readTemplateRevision,
} from "@luke/database/models/plan-template-revisions";
import { user } from "@luke/database/schemas/auth";
import { getTestDB } from "@luke/database/testing";
import { HTTP_METHOD, type WireBoundaryInput } from "@luke/wire";
import { noNetwork } from "@luke/wire/testing";
import { eq } from "drizzle-orm";
import { Clock, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { USER_ROLE } from "../admin/admin-access.js";
import { anthropicFastAccess } from "../agents/coder-host/account-keys.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { modelCatalogOf } from "../providers/model-catalog.js";
import { hostedAnswer } from "../testing/hosted-route.js";
import { CONNECTOR_ASKED_NOTHING, integrationConnectOf } from "../testing/integration-connect.js";
import { accountProcedures } from "./account-procedures.js";

/**
 * The account's access, answered by the account procedures the way the
 * hosted oRPC route answers it, over a real dialect: an admin reads that it
 * is one, any other account reads that it is not, and a caller no bearer
 * names is refused. The bearer names the account and nothing else does, so
 * a query naming another account changes nothing of the answer, and the
 * answer is never kept by a cache.
 *
 * Synthetic accounts and bearers throughout.
 */

const ORIGIN = "https://luke.test";
const ACCESS_PATH = "/api/account/access";

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
  readonly cacheControl: string | null;
  readonly body: WireBoundaryInput;
}

/** An admin and a member behind their own bearers, and the procedures answering on the test's database and clock. */
const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [admin, member] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [admin, member]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  }
  yield* db.update(user).set({ role: USER_ROLE.ADMIN }).where(eq(user.id, admin));
  const bearers = new Map([
    [`Bearer ${admin}`, admin],
    [`Bearer ${member}`, member],
  ]);
  const procedures = accountProcedures({
    resolveUserId: (incoming) =>
      Effect.succeed(
        Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
      ),
    // This suite deletes nothing, so it retires no session and reaches no eve.
    eveOrigin: () => undefined,
    standingSessions: () => Effect.die(new Error("this suite deletes no account")),
    deleteUser: deleteAccount,
    readPreferences: readAccountPreferences,
    readRole: readAccountRole,
    anthropicFastAccess,
    writePreferences: writeAccountPreferences,
    readPlanTemplate,
    writePlanTemplate,
    listPlanTemplateRevisions: listTemplateRevisions,
    readPlanTemplateRevision: readTemplateRevision,
    restorePlanTemplate,
  });
  return { admin, member, ask: (request: Request) => answer(procedures, request) };
});

const answer = (procedures: ReturnType<typeof accountProcedures>, request: Request) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    // The procedures run on oRPC's own fiber, so they are handed the test's clock and services.
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(HostedEnvironment, NO_ENVIRONMENT),
      noNetwork,
      modelCatalogOf([]),
      // Only a delete asks Connect anything, and this suite deletes nothing.
      integrationConnectOf(() => CONNECTOR_ASKED_NOTHING),
    );
    const response = yield* hostedAnswer({ account: procedures }, services, request);
    const text = yield* Effect.promise(() => response.text());
    // SAFETY: the route answers JSON; the test compares it as the wire value it is.
    const body = JSON.parse(text) as WireBoundaryInput;
    return {
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      body,
    } satisfies Answer;
  });

/** A read of the access, under the bearer named or none, at the path with the query given. */
function request(bearer: string | undefined, query = "") {
  return new Request(new URL(`${ACCESS_PATH}${query}`, ORIGIN), {
    method: HTTP_METHOD.GET,
    headers: bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
  });
}

const granted = (admin: boolean): Answer => ({
  status: HOSTED_HTTP_STATUS.OK,
  cacheControl: "private, no-store",
  body: { admin },
});

it.layer(getTestDB())("the account's access", (it) => {
  it.effect("an admin reads that it is one, and a member that it is not", () =>
    Effect.gen(function* () {
      const { admin, member, ask } = yield* openAccounts;
      assert.deepEqual(yield* ask(request(admin)), granted(true));
      assert.deepEqual(yield* ask(request(member)), granted(false));
    }),
  );

  it.effect("names the bearer's own account, whatever the query names", () =>
    Effect.gen(function* () {
      const { admin, member, ask } = yield* openAccounts;
      assert.deepEqual(yield* ask(request(member, `?userId=${admin}`)), granted(false));
    }),
  );

  it.effect("a role that is not the admin role is no admin, nor is a role left empty", () =>
    Effect.gen(function* () {
      const { member, ask } = yield* openAccounts;
      const db = yield* Database;
      yield* db.update(user).set({ role: "Admin" }).where(eq(user.id, member));
      assert.deepEqual(yield* ask(request(member)), granted(false));
      yield* db.update(user).set({ role: null }).where(eq(user.id, member));
      assert.deepEqual(yield* ask(request(member)), granted(false));
    }),
  );

  it.effect("a caller no bearer names is refused, and learns nothing", () =>
    Effect.gen(function* () {
      const { admin, ask } = yield* openAccounts;
      const refused: Answer = {
        status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
        cacheControl: null,
        body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
      };
      assert.deepEqual(yield* ask(request(undefined)), refused);
      assert.deepEqual(yield* ask(request("stranger", `?userId=${admin}`)), refused);
    }),
  );
});
