import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, joinWorkspace, openWorkspace } from "@luke/database/testing";
import { type MemoriesAnswer, memoriesAnswerSchema } from "@luke/features/memory-wire";
import { HTTP_METHOD, unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { eq } from "drizzle-orm";
import { Clock, Duration, Effect, Layer, Option, Result } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { runRecall, runRemember } from "../agents/memory-tools.js";
import { ACTION_RESULT_STATUS } from "../core.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedAnswer } from "../testing/hosted-route.js";
import { memoriesProcedures } from "./memories-procedures.js";

/**
 * A workspace's shared memories as Settings › Memory reads and forgets them
 * through the account's procedures, over a real dialect: every member reads
 * what the workspace's agents kept, most recently kept first, each named by
 * the member whose words it holds; a member forgets their own memories, and
 * owners and admins any, while a member's forget of a teammate's is refused;
 * a private memory is read, marked private, and forgotten by its member
 * alone, and an owner neither reads nor forgets it;
 * a deleted member's memory stays the workspace's, named by nobody; a
 * forgotten memory leaves the list and is never recalled again; an account
 * outside the workspace reads and forgets nothing; and the bearer names the
 * account and nothing else does.
 *
 * Synthetic accounts, workspaces, bearers, and words throughout.
 */

const ORIGIN = "https://luke.test";
const MEMORIES_PATH = "/api/account/memories";

const TESTS_RUN = "The web server's store tests run on PGlite through test:store.";
const DEPLOYS = "Deployments go out from the release branch through Vercel.";

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** A workspace's owner and one more member, an account outside it, each behind a bearer. */
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
  const procedures = memoriesProcedures({
    resolveUserId: (incoming) =>
      Effect.succeed(
        Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
      ),
  });
  const ask = (request: Request) => answer(procedures, request);
  const keep = (userId: string, text: string) => runRemember({ workspaceId, userId }, { text });
  return { owner, teammate, outsider, workspaceId, ask, keep };
});

const answer = (procedures: ReturnType<typeof memoriesProcedures>, request: Request) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    // The procedures run on oRPC's own fiber, so they are handed the test's clock and services.
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
    );
    const response = yield* hostedAnswer({ account: procedures }, services, request);
    const text = yield* Effect.promise(() => response.text());
    // SAFETY: the route answers JSON; the test compares it as the wire value it is.
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

it.layer(getTestDB())("the memories procedures", (it) => {
  it.effect(
    "every member reads what the workspace's agents kept, most recently kept first, named by whose words it holds and forgettable where the reader may",
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
    "a private memory is its member's alone: marked private and forgettable to them, and an owner neither reads nor forgets it",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, workspaceId, ask, keep } = yield* openTeam;
        yield* keep(owner, TESTS_RUN);
        yield* runRemember({ workspaceId, userId: teammate }, { text: DEPLOYS, private: true });

        const asTeammate = memoriesOf(yield* ask(readMemories(teammate, workspaceId))).memories;
        const privateOne = asTeammate.find((memory) => memory.private);
        assert.ok(privateOne !== undefined);
        const byOwner = yield* ask(forget(owner, workspaceId, privateOne.id));

        assert.deepEqual(
          asTeammate.map((memory) => [memory.text, memory.private, memory.forgettable]).toSorted(),
          [
            [DEPLOYS, true, true],
            [TESTS_RUN, false, false],
          ].toSorted(),
        );
        assert.deepEqual(wordsOf(yield* ask(readMemories(owner, workspaceId))), [TESTS_RUN]);
        assert.deepEqual(wordsOf(byOwner), [TESTS_RUN]);
        assert.deepEqual(
          wordsOf(yield* ask(readMemories(teammate, workspaceId))).toSorted(),
          [DEPLOYS, TESTS_RUN].toSorted(),
        );
        assert.deepEqual(wordsOf(yield* ask(forget(teammate, workspaceId, privateOne.id))), [
          TESTS_RUN,
        ]);
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
    "a request naming no workspace, or a forget naming no memory id or one that is no id, is refused, and a bearer the store does not know is refused",
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
        assert.deepEqual(yield* ask(forget(owner, workspaceId, "not-a-memory")), invalid);
        const unknown = refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
        assert.deepEqual(yield* ask(readMemories(undefined, workspaceId)), unknown);
        assert.deepEqual(
          yield* ask(forget(`user-${randomUUID()}`, workspaceId, randomUUID())),
          unknown,
        );

        assert.deepEqual(wordsOf(yield* ask(readMemories(owner, workspaceId))), [DEPLOYS]);
      }),
  );
});
