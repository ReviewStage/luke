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
import { CHAPTERS_MODEL } from "@repo/features/chapters-model-choice";
import { LINK_OPEN } from "@repo/features/link-open";
import { type CatalogModel, MODEL_PROVIDER } from "@repo/features/models-wire";
import { PROVIDER_KEY_PROVIDER } from "@repo/features/provider-key-wire";
import { EXPERIMENT } from "@repo/settings";
import {
  HTTP_METHOD,
  isRecord,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@repo/wire";
import { noNetwork } from "@repo/wire/testing";
import { Clock, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { accountFastOffer } from "../agents/coder-host/agent-runtime-choice.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { modelCatalogOf } from "../providers/model-catalog.js";
import { connectAgentApiKeys } from "../testing/agent-credentials.js";
import { hostedAnswer } from "../testing/hosted-route.js";
import { CONNECTOR_ASKED_NOTHING, integrationConnectOf } from "../testing/integration-connect.js";
import { accountProcedures } from "./account-procedures.js";

const ORIGIN = "https://app.test";
const PREFERENCES_PATH = "/api/account/preferences";

const OPUS: CatalogModel = {
  id: "anthropic/claude-opus-5.5",
  name: "Claude Opus 5.5",
  provider: MODEL_PROVIDER.ANTHROPIC,
  efforts: ["low", "medium", "high", "xhigh", "max"],
};

const OPUS_FAST: CatalogModel = { ...OPUS, id: "anthropic/claude-opus-5.5-fast" };

const SOL: CatalogModel = {
  id: "openai/gpt-6.1-sol",
  name: "GPT-6.1 Sol",
  provider: MODEL_PROVIDER.OPENAI,
  efforts: ["low", "high"],
};

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
  readonly body: WireBoundaryInput;
}

const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
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
    standingSessions: () => Effect.die(new Error("this suite deletes no account")),
    deleteUser: deleteAccount,
    readPreferences: readAccountPreferences,
    readAccess: readAccountAccess,
    accountFastOffer,
    writePreferences: writeAccountPreferences,
  });
  return { owner, other, ask: (request: Request) => answer(procedures, request) };
});

const answer = (procedures: ReturnType<typeof accountProcedures>, request: Request) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(HostedEnvironment, NO_ENVIRONMENT),
      noNetwork,
      modelCatalogOf([OPUS, OPUS_FAST, SOL]),
      integrationConnectOf(() => CONNECTOR_ASKED_NOTHING),
    );
    const response = yield* hostedAnswer({ account: procedures }, services, request);
    const text = yield* Effect.promise(() => response.text());
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

      const turnedOn = yield* ask(request(owner, { experiments: { [EXPERIMENT.MEMORY]: true } }));
      assert.deepEqual(partOf(turnedOn, "experiments"), { [EXPERIMENT.MEMORY]: true });

      const shared = yield* ask(request(owner, { preferences: {} }));
      assert.deepEqual(partOf(shared, "experiments"), { [EXPERIMENT.MEMORY]: true });
      const turnedOff = yield* ask(request(owner, { experiments: { [EXPERIMENT.MEMORY]: false } }));
      assert.deepEqual(partOf(turnedOff, "experiments"), { [EXPERIMENT.MEMORY]: false });
    }),
  );

  it.effect("passes over a key this deployment does not list, and refuses what is no record", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      const newer = yield* ask(
        request(owner, { experiments: { [EXPERIMENT.MEMORY]: true, newer: true } }),
      );
      assert.deepEqual(partOf(newer, "experiments"), { [EXPERIMENT.MEMORY]: true });

      const refused = yield* ask(request(owner, { experiments: [EXPERIMENT.MEMORY] }));
      assert.deepEqual(refused, {
        status: HOSTED_HTTP_STATUS.BAD_REQUEST,
        body: { error: HOSTED_API_ERROR.INVALID_REQUEST },
      });
      assert.deepEqual(partOf(yield* ask(request(owner)), "experiments"), {
        [EXPERIMENT.MEMORY]: true,
      });
    }),
  );

  it.effect("answers the bearer's own account's choices and no other's", () =>
    Effect.gen(function* () {
      const { owner, other, ask } = yield* openAccounts;
      yield* ask(request(owner, { experiments: { [EXPERIMENT.MEMORY]: true } }));
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
      assert.equal(partOf(chosen, "updatedAt"), undefined);
      assert.equal(partOf(yield* ask(request(other)), "linkOpen"), undefined);
    }),
  );

  it.effect("stands through the shared part a build that predates it writes back whole", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      yield* ask(request(owner, { preferences: {}, linkOpen: LINK_OPEN.MAC_APP }));

      const olderBuild = yield* ask(request(owner, { preferences: { voice: "marin" } }));
      assert.deepEqual(partOf(olderBuild, "preferences"), {});
      assert.equal(partOf(olderBuild, "linkOpen"), LINK_OPEN.MAC_APP);

      const backToBrowser = yield* ask(request(owner, { linkOpen: LINK_OPEN.BROWSER }));
      assert.equal(partOf(backToBrowser, "linkOpen"), LINK_OPEN.BROWSER);
    }),
  );

  it.effect("the shared part passes over a preference this deployment does not know", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      const newer = yield* ask(request(owner, { preferences: { newer: true } }));
      assert.deepEqual(partOf(newer, "preferences"), {});
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

it.layer(getTestDB())("the preferences snapshot's agent part", (it) => {
  it.effect(
    "keeps an Effort on a model nothing pays for, and refuses moving to another such model",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts;
        yield* connectAgentApiKeys(owner, { providers: [PROVIDER_KEY_PROVIDER.OPENAI] });
        yield* writeAccountPreferences(owner, { agent: { model: OPUS.id, effort: "high" } });
        const lowEffort = { model: OPUS.id, effort: "low" };
        assert.deepEqual(
          partOf(yield* ask(request(owner, { agent: lowEffort })), "agent"),
          lowEffort,
        );

        const opusFast = yield* ask(
          request(owner, { agent: { model: OPUS_FAST.id, effort: "high" } }),
        );
        assert.deepEqual(opusFast, {
          status: HOSTED_HTTP_STATUS.BAD_REQUEST,
          body: { error: HOSTED_API_ERROR.INVALID_REQUEST },
        });
        assert.deepEqual(partOf(yield* ask(request(owner)), "agent"), lowEffort);
      }),
  );

  it.effect("is GPT-6.1 Sol for an account only an OpenAI key pays for, until it stores one", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      yield* connectAgentApiKeys(owner, { providers: [PROVIDER_KEY_PROVIDER.OPENAI] });
      assert.deepEqual(partOf(yield* ask(request(owner)), "agent"), {
        model: "openai/gpt-6.1-sol",
        effort: "high",
      });
    }),
  );
});
