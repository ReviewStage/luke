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
import { getTestDB, joinWorkspace, openWorkspace } from "@luke/database/testing";
import { type MemoriesAnswer, memoriesAnswerSchema } from "@luke/features/memory-wire";
import { HTTP_METHOD, unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { eq } from "drizzle-orm";
import { Clock, Duration, Effect, Layer, Option, Result } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { anthropicFastAccess } from "../agents/coder-host/account-keys.js";
import { runRecall, runRemember } from "../agents/memory-tools.js";
import { ACTION_RESULT_STATUS } from "../core.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { modelCatalogOf } from "../providers/model-catalog.js";
import { CONNECTOR_ASKED_NOTHING, integrationConnectOf } from "../testing/integration-connect.js";
import { noNetwork } from "../testing/no-network.js";
import { accountApp } from "./account-app.js";
import { forgetWorkspaceMemory, readWorkspaceMemories } from "./workspace-memories.js";

/**
 * A workspace's shared memories as Settings reads and forgets them through
 * the account group, over a real dialect: every member reads what Luke kept
 * on any member's call, most recently kept first, each named by the member
 * whose words it holds; a member forgets their own memories, and owners and
 * admins any, while a member's forget of a teammate's is refused; a
 * forgotten memory leaves the list and is never recalled by a later call;
 * an account outside the workspace reads and forgets nothing; and the
 * bearer names the account and nothing else does.
 *
 * Synthetic accounts, workspaces, bearers, and words throughout.
 */

const ORIGIN = "https://luke.test";
const MEMORIES_PATH = "/api/account/memories";

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

const TESTS_RUN = "The web server's store tests run on PGlite through test:store.";
const DEPLOYS = "Deployments go out from the release branch through Vercel.";

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** A workspace's owner and one more member, an account outside it, each behind a bearer, and the group answering on the test's database and clock. */
const openTeam = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, teammate, outsider] = [
    `user-${randomUUID()}`,
    `user-${randomUUID()}`,
    `user-${randomUUID()}`,
  ];
  for (const [id, name] of [
    [owner, "Olive Owner"],
    [teammate, "Tom Teammate"],
    [outsider, "Ola Outsider"],
  ] as const) {
    yield* db.insert(user).values({ id, name, email: `${id}@luke.test` });
  }
  const workspaceId = yield* openWorkspace(owner);
  yield* joinWorkspace(workspaceId, teammate);
  yield* openWorkspace(outsider);
  const bearers = new Map([owner, teammate, outsider].map((id) => [`Bearer ${id}`, id]));
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
    readMemories: readWorkspaceMemories,
    forgetMemory: forgetWorkspaceMemory,
  });
  const ask = (request: Request) => answer(app, request);
  const keep = (userId: string, text: string) => runRemember({ workspaceId, userId }, { text });
  return { owner, teammate, outsider, workspaceId, ask, keep };
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

function request(path: string, userId: string | undefined, method: string = HTTP_METHOD.GET) {
  return new Request(new URL(path, ORIGIN), {
    method,
    headers: userId === undefined ? {} : { authorization: `Bearer ${userId}` },
  });
}

const readMemories = (userId: string | undefined, workspaceId: string) =>
  request(`${MEMORIES_PATH}?workspaceId=${encodeURIComponent(workspaceId)}`, userId);

const forget = (userId: string | undefined, workspaceId: string, id: string) =>
  request(
    `${MEMORIES_PATH}?workspaceId=${encodeURIComponent(workspaceId)}&id=${encodeURIComponent(id)}`,
    userId,
    HTTP_METHOD.DELETE,
  );

/** The answer as the wire reads it, failing the test where it is not the wire's. */
function memoriesOf(answered: Answer): MemoriesAnswer {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK, JSON.stringify(answered.body));
  const read = readEither(memoriesAnswerSchema)(unparsedWire(answered.body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's: ${read.failure.refusal}`);
  return read.success;
}

const wordsOf = (answered: Answer) => memoriesOf(answered).memories.map((memory) => memory.text);

const refusal = (status: number, error: string): Answer => ({ status, body: { error } });

it.layer(getTestDB())("the memories route", (it) => {
  it.effect(
    "every member reads what Luke kept on any member's call, most recently kept first, named by whose words it holds and forgettable where the reader may",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, workspaceId, ask, keep } = yield* openTeam;
        assert.deepEqual(wordsOf(yield* ask(readMemories(teammate, workspaceId))), []);

        yield* keep(owner, TESTS_RUN);
        yield* TestClock.adjust(Duration.minutes(1));
        yield* keep(teammate, DEPLOYS);

        const asTeammate = memoriesOf(yield* ask(readMemories(teammate, workspaceId))).memories;
        const asOwner = memoriesOf(yield* ask(readMemories(owner, workspaceId))).memories;
        assert.deepEqual(
          asTeammate.map((memory) => [memory.text, memory.keptBy?.name, memory.forgettable]),
          [
            [DEPLOYS, "Tom Teammate", true],
            [TESTS_RUN, "Olive Owner", false],
          ],
        );
        assert.deepEqual(
          asOwner.map((memory) => memory.forgettable),
          [true, true],
        );
      }),
  );

  it.effect(
    "a member forgets their own memory and an owner any, a member's forget of a teammate's memory is refused and keeps it, and a forgotten memory is never recalled",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, workspaceId, ask, keep } = yield* openTeam;
        yield* keep(owner, TESTS_RUN);
        yield* TestClock.adjust(Duration.minutes(1));
        yield* keep(teammate, DEPLOYS);
        const [deploys, testsRun] = memoriesOf(
          yield* ask(readMemories(owner, workspaceId)),
        ).memories;
        assert.ok(deploys !== undefined && testsRun !== undefined);

        const refused = yield* ask(forget(teammate, workspaceId, testsRun.id));
        const ownForgotten = yield* ask(forget(teammate, workspaceId, deploys.id));
        const again = yield* ask(forget(teammate, workspaceId, deploys.id));
        const recalled = yield* runRecall(
          { workspaceId, userId: owner },
          { query: "deployments release" },
        );
        const byOwner = yield* ask(forget(owner, workspaceId, testsRun.id));

        assert.deepEqual(
          refused,
          refusal(HOSTED_HTTP_STATUS.FORBIDDEN, HOSTED_API_ERROR.NOT_PERMITTED),
        );
        assert.deepEqual(wordsOf(ownForgotten), [TESTS_RUN]);
        assert.deepEqual(again, ownForgotten);
        assert.equal(recalled.status, ACTION_RESULT_STATUS.ACCEPTED);
        assert.deepEqual(recalled.memories, []);
        assert.deepEqual(wordsOf(byOwner), []);
      }),
  );

  it.effect(
    "a deleted member's memory stays the workspace's, named by nobody, and only an owner may forget it",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const { owner, teammate, workspaceId, ask, keep } = yield* openTeam;
        const third = `user-${randomUUID()}`;
        yield* db
          .insert(user)
          .values({ id: third, name: "Thea Third", email: `${third}@luke.test` });
        yield* joinWorkspace(workspaceId, third);
        yield* keep(third, DEPLOYS);
        yield* db.delete(user).where(eq(user.id, third));

        const asTeammate = memoriesOf(yield* ask(readMemories(teammate, workspaceId))).memories;
        const [orphan] = asTeammate;
        assert.ok(orphan !== undefined);

        assert.deepEqual(
          asTeammate.map((memory) => [memory.text, memory.keptBy, memory.forgettable]),
          [[DEPLOYS, null, false]],
        );
        assert.deepEqual(
          yield* ask(forget(teammate, workspaceId, orphan.id)),
          refusal(HOSTED_HTTP_STATUS.FORBIDDEN, HOSTED_API_ERROR.NOT_PERMITTED),
        );
        assert.deepEqual(wordsOf(yield* ask(forget(owner, workspaceId, orphan.id))), []);
      }),
  );

  it.effect(
    "an account outside the workspace reads and forgets none of its memories, answered as a workspace that names nothing",
    () =>
      Effect.gen(function* () {
        const { owner, outsider, workspaceId, ask, keep } = yield* openTeam;
        yield* keep(owner, DEPLOYS);
        const [kept] = memoriesOf(yield* ask(readMemories(owner, workspaceId))).memories;
        assert.ok(kept !== undefined);
        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);

        assert.deepEqual(yield* ask(readMemories(outsider, workspaceId)), notFound);
        assert.deepEqual(yield* ask(forget(outsider, workspaceId, kept.id)), notFound);
        assert.deepEqual(yield* ask(readMemories(owner, randomUUID())), notFound);

        assert.deepEqual(wordsOf(yield* ask(readMemories(owner, workspaceId))), [DEPLOYS]);
      }),
  );

  it.effect(
    "a request naming no workspace, or a forget naming no memory id, is refused, a bad id forgets nothing, and a bearer the store does not know is refused",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId, ask, keep } = yield* openTeam;
        yield* keep(owner, DEPLOYS);
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);

        assert.deepEqual(yield* ask(request(MEMORIES_PATH, owner)), invalid);
        assert.deepEqual(
          yield* ask(
            request(`${MEMORIES_PATH}?workspaceId=${workspaceId}`, owner, HTTP_METHOD.DELETE),
          ),
          invalid,
        );
        assert.deepEqual(wordsOf(yield* ask(forget(owner, workspaceId, "not-a-memory"))), [
          DEPLOYS,
        ]);
        const unknown = refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
        assert.deepEqual(yield* ask(readMemories(undefined, workspaceId)), unknown);
        assert.deepEqual(
          yield* ask(forget(`user-${randomUUID()}`, workspaceId, randomUUID())),
          unknown,
        );
        assert.deepEqual(
          yield* ask(request(MEMORIES_PATH, owner, HTTP_METHOD.PUT)),
          refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
        );

        assert.deepEqual(wordsOf(yield* ask(readMemories(owner, workspaceId))), [DEPLOYS]);
      }),
  );
});
