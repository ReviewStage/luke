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
import { CHAPTERS_MODEL } from "@luke/features/chapters-model-choice";
import { LINK_OPEN } from "@luke/features/link-open";
import { EXPERIMENT } from "@luke/settings";
import {
  HTTP_METHOD,
  isRecord,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@luke/wire";
import { noNetwork } from "@luke/wire/testing";
import { Clock, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { anthropicFastAccess } from "../agents/coder-host/account-keys.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { modelCatalogOf } from "../providers/model-catalog.js";
import { hostedAnswer } from "../testing/hosted-route.js";
import { CONNECTOR_ASKED_NOTHING, integrationConnectOf } from "../testing/integration-connect.js";
import { accountProcedures } from "./account-procedures.js";

/**
 * The parts of the account's preferences snapshot that stand beside the
 * shared one, answered by the account procedures the way the hosted oRPC route answers
 * it, over a real dialect. The experiments: none until the account chooses,
 * a write that merges its keys over what stood and leaves the other parts as
 * they were, a key this deployment does not list passed over rather than
 * refused, and only a value that is not a record of choices refused. The
 * link choice: none until the account chooses, written on its own without
 * moving the instant a Mac reads as a snapshot to take, left standing by the
 * shared part a build that predates it writes back whole, and refused where
 * it names no choice. The chapters model: Haiku until the account chooses,
 * written on its own and read back, and refused where it names no model the
 * set offers. The bearer names the account and nothing else does.
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
  eveDeploymentSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
};

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** Two accounts behind their own bearers, and the procedures answering on the test's database and clock. */
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
  return { owner, other, ask: (request: Request) => answer(procedures, request) };
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
    return { status: response.status, body } satisfies Answer;
  });

function request(userId: string, body?: WireBoundaryInput) {
  return new Request(new URL(PREFERENCES_PATH, ORIGIN), {
    method: body === undefined ? HTTP_METHOD.GET : HTTP_METHOD.PUT,
    headers: {
      authorization: `Bearer ${userId}`,
      ...(body === undefined ? undefined : { "content-type": "application/json" }),
    },
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

it.layer(getTestDB())("the preferences snapshot's link part", (it) => {
  it.effect("is absent until the account chooses, and a write of it alone moves no instant", () =>
    Effect.gen(function* () {
      const { owner, other, ask } = yield* openAccounts;
      assert.equal(partOf(yield* ask(request(owner)), "linkOpen"), undefined);

      const chosen = yield* ask(request(owner, { linkOpen: LINK_OPEN.MAC_APP }));
      assert.equal(partOf(chosen, "linkOpen"), LINK_OPEN.MAC_APP);
      assert.deepEqual(partOf(chosen, "preferences"), {});
      // Note that a Mac reads the instant as a snapshot to take over its own voice, which this write carried none of.
      assert.equal(partOf(chosen, "updatedAt"), undefined);
      assert.equal(partOf(yield* ask(request(other)), "linkOpen"), undefined);
    }),
  );

  it.effect("stands through the shared part a build that predates it writes back whole", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      yield* ask(request(owner, { preferences: { voice: "cedar" }, linkOpen: LINK_OPEN.MAC_APP }));

      const olderBuild = yield* ask(request(owner, { preferences: { voice: "marin" } }));
      assert.deepEqual(partOf(olderBuild, "preferences"), { voice: "marin" });
      assert.equal(partOf(olderBuild, "linkOpen"), LINK_OPEN.MAC_APP);

      const backToBrowser = yield* ask(request(owner, { linkOpen: LINK_OPEN.BROWSER }));
      assert.equal(partOf(backToBrowser, "linkOpen"), LINK_OPEN.BROWSER);
    }),
  );

  it.effect("the shared part passes over a preference this deployment does not know", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      const newer = yield* ask(request(owner, { preferences: { voice: "cedar", newer: true } }));
      assert.deepEqual(partOf(newer, "preferences"), { voice: "cedar" });
    }),
  );

  it.effect("refuses a link part naming no choice, and keeps what stood", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      yield* ask(request(owner, { linkOpen: LINK_OPEN.MAC_APP }));

      const refused = yield* ask(request(owner, { linkOpen: "elsewhere" }));
      assert.deepEqual(refused, {
        status: HOSTED_HTTP_STATUS.BAD_REQUEST,
        body: { error: HOSTED_API_ERROR.INVALID_REQUEST },
      });
      assert.equal(partOf(yield* ask(request(owner)), "linkOpen"), LINK_OPEN.MAC_APP);
    }),
  );
});

it.layer(getTestDB())("the preferences snapshot's chapters model part", (it) => {
  it.effect("is Haiku until the account chooses, and a choice written is the one read back", () =>
    Effect.gen(function* () {
      const { owner, other, ask } = yield* openAccounts;
      assert.equal(partOf(yield* ask(request(owner)), "chaptersModel"), CHAPTERS_MODEL.HAIKU);

      const chosen = yield* ask(request(owner, { chaptersModel: CHAPTERS_MODEL.SONNET }));
      assert.equal(partOf(chosen, "chaptersModel"), CHAPTERS_MODEL.SONNET);
      assert.equal(partOf(chosen, "updatedAt"), undefined);
      assert.equal(partOf(yield* ask(request(owner)), "chaptersModel"), CHAPTERS_MODEL.SONNET);
      assert.equal(partOf(yield* ask(request(other)), "chaptersModel"), CHAPTERS_MODEL.HAIKU);
    }),
  );

  it.effect("refuses a model the set does not offer, and keeps what stood", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      yield* ask(request(owner, { chaptersModel: CHAPTERS_MODEL.OPUS }));
      for (const offered of ["gpt-5.5", "anthropic/claude-opus-5.5", 3]) {
        assert.deepEqual(yield* ask(request(owner, { chaptersModel: offered })), {
          status: HOSTED_HTTP_STATUS.BAD_REQUEST,
          body: { error: HOSTED_API_ERROR.INVALID_REQUEST },
        });
      }
      assert.equal(partOf(yield* ask(request(owner)), "chaptersModel"), CHAPTERS_MODEL.OPUS);
    }),
  );
});
