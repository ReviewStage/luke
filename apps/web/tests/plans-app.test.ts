import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { planAnswerSchema, planListAnswerSchema } from "@sidecar/hosted";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Layer, Option, Result, type Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { SqlClient } from "effect/unstable/sql";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../server/hosted/http";
import { runUpdatePlan } from "../server/hosted/update-plan-tool";
import { plansApp } from "../server/plans-app";
import { testSqlClient } from "./support/sql-client";

/**
 * The planning window's plan routes, answered by the group the way a
 * function answers them, over a real dialect: the bearer names the account
 * and nothing else does, a plan another account owns answers exactly as one
 * that does not exist, and what `update_plan` saved is what the window opens.
 * The path is the one the rewrite hands the group, the plan id moved from
 * the path into the `id` query.
 *
 * Synthetic accounts, bearers, and repositories throughout.
 */

const ORIGIN = "https://luke.test";
const PLANS = "/api/plans";
const ONE_PLAN = "/api/plans/plan";

const RELAY = {
  name: "Teammate invitations",
  repository: {
    owner: "acme",
    name: "relay",
    branch: "main",
    commit: "4f2c9e1a7b3d5f60718293a4b5c6d7e8f9012345",
  },
} as const;

const INVITATIONS = {
  body: "# Teammate invitations\n",
  assumptions: [{ text: "Members and admins can both invite.", confirmed: true }],
} as const;

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** Two accounts, each behind its own bearer. */
const openAccounts = Effect.gen(function* () {
  const owner = `user-${randomUUID()}`;
  const other = `user-${randomUUID()}`;
  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  }
  const bearers = new Map([
    [`Bearer ${owner}`, owner],
    [`Bearer ${other}`, other],
  ]);
  return { owner, other, bearers };
});

/** The group over the test's own database, answering one request. */
const answer = (bearers: ReadonlyMap<string, string>, request: Request) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    const { handler, dispose } = HttpRouter.toWebHandler(
      plansApp({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
          ),
      }).pipe(HttpRouter.provideRequest(Layer.succeed(SqlClient.SqlClient, client))),
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
  init: { method?: string; body?: WireBoundaryInput; id?: string } = {},
): Request {
  const url = new URL(path, ORIGIN);
  if (init.id !== undefined) url.searchParams.set("id", init.id);
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
  it.effect("a started plan lists, and opens with what update_plan saved", () =>
    Effect.gen(function* () {
      const { owner, bearers } = yield* openAccounts;
      const planId = startedId(
        yield* answer(bearers, request(PLANS, owner, { method: "POST", body: RELAY })),
      );
      yield* runUpdatePlan({ userId: owner, planId }, unparsedWire(INVITATIONS));

      const listed = yield* answer(bearers, request(PLANS, owner));
      const opened = yield* answer(bearers, request(ONE_PLAN, owner, { id: planId }));

      assert.deepEqual(
        readAnswer(planListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans.map((plan) => [
          plan.id,
          plan.name,
          plan.repository,
        ]),
        [[planId, RELAY.name, RELAY.repository]],
      );
      assert.deepEqual(
        readAnswer(planAnswerSchema, HOSTED_HTTP_STATUS.OK, opened).plan.document,
        INVITATIONS,
      );
    }),
  );

  it.effect("another account's plan answers as none on every route", () =>
    Effect.gen(function* () {
      const { owner, other, bearers } = yield* openAccounts;
      const planId = startedId(
        yield* answer(bearers, request(PLANS, owner, { method: "POST", body: RELAY })),
      );
      const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);

      assert.deepEqual(yield* answer(bearers, request(ONE_PLAN, other, { id: planId })), notFound);
      assert.deepEqual(
        yield* answer(bearers, request(ONE_PLAN, other, { id: planId, method: "DELETE" })),
        notFound,
      );
      assert.deepEqual(yield* answer(bearers, request(PLANS, other)), {
        status: HOSTED_HTTP_STATUS.OK,
        body: { plans: [] },
      });
      assert.equal(
        (yield* answer(bearers, request(ONE_PLAN, owner, { id: planId }))).status,
        HOSTED_HTTP_STATUS.OK,
      );
    }),
  );

  it.effect("a deleted plan no longer opens or lists", () =>
    Effect.gen(function* () {
      const { owner, bearers } = yield* openAccounts;
      const planId = startedId(
        yield* answer(bearers, request(PLANS, owner, { method: "POST", body: RELAY })),
      );

      const deleted = yield* answer(
        bearers,
        request(ONE_PLAN, owner, { id: planId, method: "DELETE" }),
      );

      assert.deepEqual(deleted, { status: HOSTED_HTTP_STATUS.OK, body: { deleted: true } });
      assert.deepEqual(
        yield* answer(bearers, request(ONE_PLAN, owner, { id: planId })),
        refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
      );
      assert.deepEqual(yield* answer(bearers, request(PLANS, owner)), {
        status: HOSTED_HTTP_STATUS.OK,
        body: { plans: [] },
      });
    }),
  );

  it.effect("a start that names an account, or no repository commit, is refused", () =>
    Effect.gen(function* () {
      const { owner, other, bearers } = yield* openAccounts;
      const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);

      const naming = yield* answer(
        bearers,
        request(PLANS, owner, { method: "POST", body: { ...RELAY, userId: other } }),
      );
      const uncommitted = yield* answer(
        bearers,
        request(PLANS, owner, {
          method: "POST",
          body: { name: RELAY.name, repository: { ...RELAY.repository, commit: "main" } },
        }),
      );

      assert.deepEqual(naming, invalid);
      assert.deepEqual(uncommitted, invalid);
      assert.deepEqual(yield* answer(bearers, request(PLANS, other)), {
        status: HOSTED_HTTP_STATUS.OK,
        body: { plans: [] },
      });
    }),
  );

  it.effect("no bearer, a wrong method, and an id that is no UUID are refused", () =>
    Effect.gen(function* () {
      const { owner, bearers } = yield* openAccounts;

      assert.deepEqual(
        yield* answer(bearers, request(PLANS, undefined)),
        refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
      );
      assert.deepEqual(
        yield* answer(bearers, request(PLANS, owner, { method: "DELETE" })),
        refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
      );
      assert.deepEqual(
        yield* answer(bearers, request(ONE_PLAN, owner, { id: "not-a-plan" })),
        refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
      );
    }),
  );
});
