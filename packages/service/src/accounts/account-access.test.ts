import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  deleteAccount,
  readAccountAccess,
  readAccountPreferences,
  writeAccountPreferences,
} from "@repo/database/models/account-store";
import { user } from "@repo/database/schemas/auth";
import { getTestDB } from "@repo/database/testing";
import { HTTP_METHOD, type WireBoundaryInput } from "@repo/wire";
import { noNetwork } from "@repo/wire/testing";
import { eq } from "drizzle-orm";
import { Clock, Duration, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { USER_ROLE } from "../admin/admin-access.js";
import { accountFastOffer } from "../agents/coder-host/agent-runtime-choice.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { modelCatalogOf } from "../providers/model-catalog.js";
import { hostedAnswer } from "../testing/hosted-route.js";
import { CONNECTOR_ASKED_NOTHING, integrationConnectOf } from "../testing/integration-connect.js";
import { accountProcedures } from "./account-procedures.js";

const ORIGIN = "https://app.test";
const ACCESS_PATH = "/api/account/access";

const NO_ENVIRONMENT: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
  titleAnthropicApiKey: undefined,
};

interface Answer {
  readonly status: number;
  readonly cacheControl: string | null;
  readonly body: WireBoundaryInput;
}

const openAccounts = () =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [admin, member] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
    for (const id of [admin, member]) {
      yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
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
      standingSessions: () => Effect.die(new Error("this suite deletes no account")),
      deleteUser: deleteAccount,
      readPreferences: readAccountPreferences,
      readAccess: readAccountAccess,
      accountFastOffer,
      writePreferences: writeAccountPreferences,
    });
    return {
      admin,
      member,
      ask: (request: Request, environment: HostedEnvironmentValues = NO_ENVIRONMENT) =>
        answer(procedures, request, environment),
    };
  });

const answer = (
  procedures: ReturnType<typeof accountProcedures>,
  request: Request,
  environment: HostedEnvironmentValues,
) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(HostedEnvironment, environment),
      noNetwork,
      modelCatalogOf([]),
      integrationConnectOf(() => CONNECTOR_ASKED_NOTHING),
    );
    const response = yield* hostedAnswer({ account: procedures }, services, request);
    const text = yield* Effect.promise(() => response.text());
    const body = JSON.parse(text) as WireBoundaryInput;
    return {
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      body,
    } satisfies Answer;
  });

function request(bearer: string | undefined, query = "") {
  return new Request(new URL(`${ACCESS_PATH}${query}`, ORIGIN), {
    method: HTTP_METHOD.GET,
    headers: bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
  });
}

const granted = (admin: boolean, supportAccessUntil: number | null = null): Answer => ({
  status: HOSTED_HTTP_STATUS.OK,
  cacheControl: "private, no-store",
  body: { admin, supportAccessUntil },
});

it.layer(getTestDB())("the account's access", (it) => {
  it.effect("an admin reads that it is one, and a member that it is not", () =>
    Effect.gen(function* () {
      const { admin, member, ask } = yield* openAccounts();
      assert.deepEqual(yield* ask(request(admin)), granted(true));
      assert.deepEqual(yield* ask(request(member)), granted(false));
    }),
  );

  it.effect("names the bearer's own account, whatever the query names", () =>
    Effect.gen(function* () {
      const { admin, member, ask } = yield* openAccounts();
      assert.deepEqual(yield* ask(request(member, `?userId=${admin}`)), granted(false));
    }),
  );

  it.effect("a role that is not the admin role is no admin, nor is a role left empty", () =>
    Effect.gen(function* () {
      const { member, ask } = yield* openAccounts();
      const db = yield* Database;
      yield* db.update(user).set({ role: "Admin" }).where(eq(user.id, member));
      assert.deepEqual(yield* ask(request(member)), granted(false));
      yield* db.update(user).set({ role: null }).where(eq(user.id, member));
      assert.deepEqual(yield* ask(request(member)), granted(false));
    }),
  );

  it.effect(
    "a member's grant of support access is answered while it stands, and not once it has run out",
    () =>
      Effect.gen(function* () {
        const { member, ask } = yield* openAccounts();
        const db = yield* Database;
        const until = (yield* Clock.currentTimeMillis) + Duration.toMillis(Duration.days(7));
        yield* db
          .update(user)
          .set({ supportAccessUntil: new Date(until) })
          .where(eq(user.id, member));
        assert.deepEqual(yield* ask(request(member)), granted(false, until));

        yield* TestClock.adjust(Duration.days(8));
        assert.deepEqual(yield* ask(request(member)), granted(false));
      }),
  );

  it.effect("a caller no bearer names is refused, and learns nothing", () =>
    Effect.gen(function* () {
      const { admin, ask } = yield* openAccounts();
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
