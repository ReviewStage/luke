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
import { user } from "@luke/database/schemas/auth";
import { getTestDB } from "@luke/database/testing";
import { EXPERIMENT } from "@luke/settings";
import {
  HTTP_METHOD,
  isRecord,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@luke/wire";
import { Clock, Effect, Layer, Option } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { anthropicFastAccess } from "../agents/coder-host/account-keys.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { modelCatalogOf } from "../providers/model-catalog.js";
import { CONNECTOR_ASKED_NOTHING, integrationConnectOf } from "../testing/integration-connect.js";
import { noNetwork } from "../testing/no-network.js";
import { accountApp } from "./account-app.js";

/**
 * The experiments part of the account's preferences snapshot, answered by
 * the account group the way its function answers it, over a real dialect:
 * none until the account chooses, a write that merges its keys over what
 * stood and leaves the other parts as they were, a key this deployment does
 * not list passed over rather than refused, and only a value that is not a
 * record of choices refused. The bearer names the account and nothing else
 * does.
 *
 * Synthetic accounts and bearers throughout.
 */

const ORIGIN = "https://luke.test";
const PREFERENCES_PATH = "/api/account/preferences";

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

/** Two accounts behind their own bearers, and the group answering on the test's database and clock. */
const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  }
  const bearers = new Map([
    [`Bearer ${owner}`, owner],
    [`Bearer ${other}`, other],
  ]);
  const app = accountApp({
    resolveUserId: (incoming) =>
      Effect.succeed(
        Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
      ),
    // This suite deletes nothing, so it retires no session and reaches no eve.
    eveOrigin: () => undefined,
    standingSessions: () => Effect.die(new Error("this suite deletes no account")),
    deleteUser: deleteAccount,
    readPreferences: readAccountPreferences,
    anthropicFastAccess,
    writePreferences: writeAccountPreferences,
    readPlanTemplate,
    writePlanTemplate,
    listPlanTemplateRevisions: listTemplateRevisions,
    readPlanTemplateRevision: readTemplateRevision,
    restorePlanTemplate,
    // The memories' path is answered over a real dialect in `account-memories.test.ts`.
    readMemories: () => Effect.die(new Error("this suite reads no memory")),
    forgetMemory: () => Effect.die(new Error("this suite forgets no memory")),
  });
  return { owner, other, ask: (request: Request) => answer(app, request) };
});

const answer = (app: ReturnType<typeof accountApp>, request: Request) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    // The handler runs on the router's own fiber, so it is handed the test's clock and services.
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

function request(userId: string, body?: WireBoundaryInput) {
  return new Request(new URL(PREFERENCES_PATH, ORIGIN), {
    method: body === undefined ? HTTP_METHOD.GET : HTTP_METHOD.PUT,
    headers: { authorization: `Bearer ${userId}` },
    ...(body === undefined ? undefined : { body: JSON.stringify(body) }),
  });
}

/** One part of an answered snapshot, failing the test where the answer is not one. */
function partOf(answered: Answer, part: string): UnparsedWireValue {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK, JSON.stringify(answered.body));
  const body = unparsedWire(answered.body);
  if (!isRecord(body)) return assert.fail("the snapshot is not a record");
  return body[part];
}

it.layer(getTestDB())("the preferences snapshot's experiments part", (it) => {
  it.effect("is empty until the account chooses, and merges each write over what stood", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      assert.deepEqual(partOf(yield* ask(request(owner)), "experiments"), {});

      const turnedOn = yield* ask(request(owner, { experiments: { [EXPERIMENT.FACTORY]: true } }));
      assert.deepEqual(partOf(turnedOn, "experiments"), { [EXPERIMENT.FACTORY]: true });

      // The voice's own write leaves the experiments standing, and the experiments' leaves the voice.
      yield* ask(request(owner, { preferences: { voice: "cedar" } }));
      const turnedOff = yield* ask(
        request(owner, { experiments: { [EXPERIMENT.FACTORY]: false } }),
      );
      assert.deepEqual(partOf(turnedOff, "experiments"), { [EXPERIMENT.FACTORY]: false });
      assert.deepEqual(partOf(turnedOff, "preferences"), { voice: "cedar" });
    }),
  );

  it.effect("passes over a key this deployment does not list, and refuses what is no record", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      const newer = yield* ask(
        request(owner, { experiments: { [EXPERIMENT.FACTORY]: true, newer: true } }),
      );
      assert.deepEqual(partOf(newer, "experiments"), { [EXPERIMENT.FACTORY]: true });

      const refused = yield* ask(request(owner, { experiments: [EXPERIMENT.FACTORY] }));
      assert.deepEqual(refused, {
        status: HOSTED_HTTP_STATUS.BAD_REQUEST,
        body: { error: HOSTED_API_ERROR.INVALID_REQUEST },
      });
      assert.deepEqual(partOf(yield* ask(request(owner)), "experiments"), {
        [EXPERIMENT.FACTORY]: true,
      });
    }),
  );

  it.effect("answers the bearer's own account's choices and no other's", () =>
    Effect.gen(function* () {
      const { owner, other, ask } = yield* openAccounts;
      yield* ask(request(owner, { experiments: { [EXPERIMENT.FACTORY]: true } }));
      assert.deepEqual(partOf(yield* ask(request(other)), "experiments"), {});
    }),
  );
});
