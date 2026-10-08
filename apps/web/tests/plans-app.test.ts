import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { planAnswerSchema, planListAnswerSchema } from "@sidecar/hosted/plan-wire";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { eq } from "drizzle-orm";
import { Effect, Layer, Option, Result, type Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { SqlClient } from "effect/unstable/sql";
import { user } from "../server/db/auth-schema";
import { planCommand } from "../server/db/plan-schema";
import { db } from "../server/db/query";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../server/hosted/http";
import { PLAN_SAVE_STATUS, saveNotes } from "../server/hosted/plan-notes";
import { plansApp } from "../server/plans-app";
import { INVITATIONS_DRAFT, notesFor } from "./support/plan-contents";
import { testSqlClient } from "./support/sql-client";

/**
 * The Plans tab's plan routes, answered by the group the way a
 * function answers them, over a real dialect: the bearer names the account
 * and nothing else does, a plan another account owns answers exactly as one
 * that does not exist, and what the notetaker's notes saved is what the window opens.
 * The path is the one the rewrite hands the group, the plan id moved from
 * the path into the `id` query. Starting a plan names the folder on the Mac
 * it reads, and the Mac claims and settles the planning model's commands
 * through the two command paths.
 *
 * Synthetic accounts, bearers, and folders throughout.
 */

const ORIGIN = "https://luke.test";
const PLANS = "/api/plans";
const ONE_PLAN = "/api/plans/plan";
const COMMAND_CLAIM = "/api/plans/commands/claim";
const COMMAND = "/api/plans/commands/command";

const RELAY = {
  name: "Teammate invitations",
} as const;

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** Two accounts, each behind its own bearer. */
const openAccounts = () =>
  Effect.gen(function* () {
    const owner = `user-${randomUUID()}`;
    const other = `user-${randomUUID()}`;
    for (const id of [owner, other]) {
      yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
    }
    const bearers = new Map([
      [`Bearer ${owner}`, owner],
      [`Bearer ${other}`, other],
    ]);
    const ask = (request: Request) => answer(bearers, request);
    return { owner, other, ask };
  });

/** The group over the test's own database, answering one request. */
const answer = (bearers: ReadonlyMap<string, string>, request: Request) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    const services = Layer.succeed(SqlClient.SqlClient, client);
    const { handler, dispose } = HttpRouter.toWebHandler(
      plansApp({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
          ),
      }).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() => handler(request));
    // SAFETY: the group answers JSON; the test compares it as the wire value it is.
    const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
    yield* Effect.promise(() => dispose());
    return { status: response.status, body } satisfies Answer;
  });

function request(
  path: string,
  userId: string | undefined,
  init: { method?: string; body?: WireBoundaryInput; id?: string; command?: string } = {},
): Request {
  const url = new URL(path, ORIGIN);
  if (init.id !== undefined) url.searchParams.set("id", init.id);
  if (init.command !== undefined) url.searchParams.set("command", init.command);
  return new Request(url, {
    method: init.method ?? "GET",
    headers: userId === undefined ? {} : { authorization: `Bearer ${userId}` },
    ...(init.body === undefined ? undefined : { body: JSON.stringify(init.body) }),
  });
}

/** An answer read as the wire declares it, failing the test where it is not one. */
function readAnswer<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  status: number,
  answered: Answer,
): S["Type"] {
  assert.equal(answered.status, status);
  const read = readEither(schema)(unparsedWire(answered.body));
  if (Result.isFailure(read))
    return assert.fail(`the answer is not the wire's: ${read.failure.refusal}`);
  return read.success;
}

/** The started plan's id, failing the test where the answer is not a started plan. */
function startedId(started: Answer): string {
  return readAnswer(planAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started).plan.id;
}

const refusal = (status: number, error: string): Answer => ({ status, body: { error } });

it.layer(testSqlClient)("the plan routes", (it) => {
  it.effect("a started plan lists, and opens with what its notes saved", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));
      const saved = yield* saveNotes(
        { userId: owner, planId, header: { name: RELAY.name } },
        notesFor(INVITATIONS_DRAFT),
      );
      assert.equal(saved.status, PLAN_SAVE_STATUS.SAVED);

      const listed = yield* ask(request(PLANS, owner));
      const opened = yield* ask(request(ONE_PLAN, owner, { id: planId }));

      assert.deepEqual(
        readAnswer(planListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans.map((plan) => [
          plan.id,
          plan.name,
        ]),
        [[planId, RELAY.name]],
      );
      assert.deepEqual(
        readAnswer(planAnswerSchema, HOSTED_HTTP_STATUS.OK, opened).plan.document,
        saved.status === PLAN_SAVE_STATUS.SAVED ? saved.document : undefined,
      );
    }),
  );

  it.effect("another account's plan answers as none on every route", () =>
    Effect.gen(function* () {
      const { owner, other, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));
      const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);

      assert.deepEqual(yield* ask(request(ONE_PLAN, other, { id: planId })), notFound);
      assert.deepEqual(
        yield* ask(request(ONE_PLAN, other, { id: planId, method: "DELETE" })),
        notFound,
      );
      assert.deepEqual(yield* ask(request(PLANS, other)), {
        status: HOSTED_HTTP_STATUS.OK,
        body: { plans: [] },
      });
      assert.equal(
        (yield* ask(request(ONE_PLAN, owner, { id: planId }))).status,
        HOSTED_HTTP_STATUS.OK,
      );
    }),
  );

  it.effect("a deleted plan no longer opens or lists", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));

      const deleted = yield* ask(request(ONE_PLAN, owner, { id: planId, method: "DELETE" }));

      assert.deepEqual(deleted, { status: HOSTED_HTTP_STATUS.OK, body: { deleted: true } });
      assert.deepEqual(
        yield* ask(request(ONE_PLAN, owner, { id: planId })),
        refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
      );
      assert.deepEqual(yield* ask(request(PLANS, owner)), {
        status: HOSTED_HTTP_STATUS.OK,
        body: { plans: [] },
      });
    }),
  );

  it.effect("a start that names an account or a repository is refused", () =>
    Effect.gen(function* () {
      const { owner, other, ask } = yield* openAccounts();
      const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
      const start = (body: WireBoundaryInput) =>
        ask(request(PLANS, owner, { method: "POST", body }));

      const naming = yield* start({ ...RELAY, userId: other });
      const repository = yield* start({
        name: RELAY.name,
        repository: { owner: "acme", name: "relay" },
      });

      assert.deepEqual([naming, repository], [invalid, invalid]);
      assert.deepEqual(yield* ask(request(PLANS, owner)), {
        status: HOSTED_HTTP_STATUS.OK,
        body: { plans: [] },
      });
    }),
  );

  it.effect("the Mac claims the plan's waiting command and settles it with what it answered", () =>
    Effect.gen(function* () {
      const { owner, other, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));
      const [queued] = yield* db
        .insert(planCommand)
        .values({ planId, command: "ls" })
        .returning({ id: planCommand.id });
      assert.ok(queued);
      const result = { exitCode: 0, stdout: "README.md\n", stderr: "" };
      const settle = (userId: string) =>
        ask(
          request(COMMAND, userId, {
            method: "POST",
            id: planId,
            command: queued.id,
            body: result,
          }),
        );

      const strangerSettle = yield* settle(other);
      const claimed = yield* ask(request(COMMAND_CLAIM, owner, { method: "POST", id: planId }));
      const settled = yield* settle(owner);
      const again = yield* settle(owner);

      assert.deepEqual(strangerSettle, { status: HOSTED_HTTP_STATUS.OK, body: { settled: false } });
      assert.deepEqual(claimed, {
        status: HOSTED_HTTP_STATUS.OK,
        body: { command: { id: queued.id, command: "ls" } },
      });
      assert.deepEqual(settled, { status: HOSTED_HTTP_STATUS.OK, body: { settled: true } });
      assert.deepEqual(again, { status: HOSTED_HTTP_STATUS.OK, body: { settled: false } });
      const [stored] = yield* db
        .select({ result: planCommand.result })
        .from(planCommand)
        .where(eq(planCommand.id, queued.id));
      assert.deepEqual(stored?.result, result);
    }),
  );

  it.effect("no bearer, a wrong method, and an id that is no UUID are refused", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();

      assert.deepEqual(
        yield* ask(request(PLANS, undefined)),
        refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
      );
      assert.deepEqual(
        yield* ask(request(PLANS, owner, { method: "DELETE" })),
        refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
      );
      assert.deepEqual(
        yield* ask(request(ONE_PLAN, owner, { id: "not-a-plan" })),
        refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
      );
    }),
  );
});
