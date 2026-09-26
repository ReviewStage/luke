import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  GITHUB_FAILURE,
  GITHUB_UNAVAILABLE_ERROR,
  planAnswerSchema,
  planListAnswerSchema,
} from "@sidecar/hosted";
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
import { type FakeGitHub, type FakeRepository, fakeGitHub } from "./support/github-fake";
import { testSqlClient } from "./support/sql-client";

/**
 * The planning window's plan routes, answered by the group the way a
 * function answers them, over a real dialect: the bearer names the account
 * and nothing else does, a plan another account owns answers exactly as one
 * that does not exist, and what `update_plan` saved is what the window opens.
 * The path is the one the rewrite hands the group, the plan id moved from
 * the path into the `id` query. Starting a plan names a repository, and the
 * commit it reads is the one GitHub answers the account's connection for its
 * default branch, from a fake of GitHub at the process boundary.
 *
 * Synthetic accounts, bearers, tokens, and repositories throughout.
 */

const ORIGIN = "https://luke.test";
const PLANS = "/api/plans";
const ONE_PLAN = "/api/plans/plan";

const RELAY_COMMIT = "4f2c9e1a7b3d5f60718293a4b5c6d7e8f9012345";

const RELAY = {
  name: "Teammate invitations",
  repository: { owner: "acme", name: "relay" },
} as const;

/** What a started plan on `acme/relay` reads: its default branch at the commit GitHub answered. */
const RELAY_RESOLVED = { owner: "acme", name: "relay", branch: "main", commit: RELAY_COMMIT };

function relay(): FakeRepository {
  return {
    owner: "acme",
    name: "relay",
    private: true,
    defaultBranch: "main",
    branches: new Map([["main", RELAY_COMMIT]]),
    commits: new Map([[RELAY_COMMIT, new Map([["README.md", { text: "# Relay\n" }]])]]),
  };
}

/** A repository created with nothing in it: GitHub names a default branch that holds no commit. */
function blank(): FakeRepository {
  return {
    owner: "acme",
    name: "blank",
    private: false,
    defaultBranch: "main",
    branches: new Map(),
    commits: new Map(),
  };
}

const INVITATIONS = {
  body: "# Teammate invitations\n",
  assumptions: [{ text: "Members and admins can both invite.", confirmed: true }],
} as const;

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** Two accounts, each behind its own bearer, and unless told otherwise each connected to GitHub reading `acme/relay` and `acme/blank`. */
const openAccounts = (github: FakeGitHub, connected = true) =>
  Effect.gen(function* () {
    const owner = `user-${randomUUID()}`;
    const other = `user-${randomUUID()}`;
    for (const id of [owner, other]) {
      yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
      if (connected) github.connect(id, `fixture-token-${id}`, [relay(), blank()]);
    }
    const bearers = new Map([
      [`Bearer ${owner}`, owner],
      [`Bearer ${other}`, other],
    ]);
    const ask = (request: Request) => answer(github, bearers, request);
    return { owner, other, ask };
  });

/** The group over the test's own database, answering one request. */
const answer = (github: FakeGitHub, bearers: ReadonlyMap<string, string>, request: Request) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    const services = Layer.mergeAll(Layer.succeed(SqlClient.SqlClient, client), github.layer);
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
      const { owner, ask } = yield* openAccounts(fakeGitHub());
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));
      yield* runUpdatePlan({ userId: owner, planId }, unparsedWire(INVITATIONS));

      const listed = yield* ask(request(PLANS, owner));
      const opened = yield* ask(request(ONE_PLAN, owner, { id: planId }));

      assert.deepEqual(
        readAnswer(planListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans.map((plan) => [
          plan.id,
          plan.name,
          plan.repository,
        ]),
        [[planId, RELAY.name, RELAY_RESOLVED]],
      );
      assert.deepEqual(
        readAnswer(planAnswerSchema, HOSTED_HTTP_STATUS.OK, opened).plan.document,
        INVITATIONS,
      );
    }),
  );

  it.effect("another account's plan answers as none on every route", () =>
    Effect.gen(function* () {
      const { owner, other, ask } = yield* openAccounts(fakeGitHub());
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
      const { owner, ask } = yield* openAccounts(fakeGitHub());
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

  it.effect("a start that names an account, a branch, or a commit is refused", () =>
    Effect.gen(function* () {
      const { owner, other, ask } = yield* openAccounts(fakeGitHub());
      const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
      const start = (body: WireBoundaryInput) =>
        ask(request(PLANS, owner, { method: "POST", body }));

      const naming = yield* start({ ...RELAY, userId: other });
      const committed = yield* start({ name: RELAY.name, repository: RELAY_RESOLVED });
      const branched = yield* start({
        name: RELAY.name,
        repository: { ...RELAY.repository, branch: "main" },
      });

      assert.deepEqual([naming, committed, branched], [invalid, invalid, invalid]);
      assert.deepEqual(yield* ask(request(PLANS, owner)), {
        status: HOSTED_HTTP_STATUS.OK,
        body: { plans: [] },
      });
    }),
  );

  it.effect("a repository the connection cannot read starts no plan, and says why", () =>
    Effect.gen(function* () {
      const github = fakeGitHub();
      const { owner, other, ask } = yield* openAccounts(github);
      const start = (userId: string, repository: WireBoundaryInput) =>
        ask(request(PLANS, userId, { method: "POST", body: { name: RELAY.name, repository } }));
      const unavailable = (reason: string) => ({
        status: HOSTED_HTTP_STATUS.CONFLICT,
        body: { error: GITHUB_UNAVAILABLE_ERROR, reason },
      });

      const unknown = yield* start(owner, { owner: "rival", name: "vault" });
      const empty = yield* start(owner, { owner: "acme", name: "blank" });
      github.revoke(`fixture-token-${other}`);
      const revoked = yield* start(other, RELAY.repository);
      const stranger = yield* openAccounts(fakeGitHub(), false);
      const unconnected = yield* stranger.ask(
        request(PLANS, stranger.owner, { method: "POST", body: RELAY }),
      );

      assert.deepEqual(unknown, unavailable(GITHUB_FAILURE.NOT_FOUND));
      assert.deepEqual(empty, unavailable(GITHUB_FAILURE.EMPTY_REPOSITORY));
      assert.deepEqual(revoked, unavailable(GITHUB_FAILURE.ACCESS_DENIED));
      assert.deepEqual(unconnected, unavailable(GITHUB_FAILURE.NOT_CONNECTED));
      for (const userId of [owner, other]) {
        assert.deepEqual(yield* ask(request(PLANS, userId)), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { plans: [] },
        });
      }
    }),
  );

  it.effect("no bearer, a wrong method, and an id that is no UUID are refused", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts(fakeGitHub());

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
