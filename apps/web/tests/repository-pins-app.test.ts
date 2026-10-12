import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { REPOSITORY_PIN_BOUNDS, repositoryPinsAnswerSchema } from "@sidecar/hosted/plan-wire";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { eq } from "drizzle-orm";
import { Clock, Effect, Layer, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import { HttpRouter } from "effect/unstable/http";
import { SqlClient } from "effect/unstable/sql";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { repositoryPin } from "../server/db/repository-pin-schema";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../server/hosted/http";
import { repositoryPinsApp } from "../server/repository-pins-app";
import { testSqlClient } from "./support/sql-client";

/**
 * The sidebar's repository pins, answered by the group the way a function
 * answers them, over a real dialect: the bearer names the account and
 * nothing else does, a pin keeps the instant it was first made, and every
 * write answers the pins as they then stand.
 *
 * Synthetic accounts, bearers, and repositories throughout.
 */

const ORIGIN = "https://luke.test";
const PINS = "/api/repository-pins";

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** Two accounts, each behind its own bearer, and the group answering one request. */
const openAccounts = Effect.gen(function* () {
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
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

const answer = (bearers: ReadonlyMap<string, string>, request: Request) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    // The handler runs on the router's own fiber, so it is handed the test's clock: a pin's instant is read from it.
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      repositoryPinsApp({
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
  userId: string | undefined,
  init: { method?: string; body?: WireBoundaryInput } = {},
) {
  return new Request(new URL(PINS, ORIGIN), {
    method: init.method ?? "GET",
    headers: userId === undefined ? {} : { authorization: `Bearer ${userId}` },
    ...(init.body === undefined ? undefined : { body: JSON.stringify(init.body) }),
  });
}

/** The pins an answer carries, as `[repository, pinnedAt]`, failing the test where it is not the wire's. */
function pinsOf(answered: Answer): [string, number][] {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
  const read = readEither(repositoryPinsAnswerSchema)(unparsedWire(answered.body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's: ${read.failure.refusal}`);
  return read.success.pins.map(({ repository, pinnedAt }) => [repository, pinnedAt]);
}

const refusal = (status: number, error: string): Answer => ({ status, body: { error } });

it.layer(testSqlClient)("the repository pins route", (it) => {
  it.effect(
    "a pin answers every pin newest pinned first, a second pin keeps its instant, and an unpin takes it out, for the bearer's account alone",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts;
        const pin = (repository: string, pinned: boolean, userId = owner) =>
          ask(request(userId, { method: "PUT", body: { repository, pinned } }));

        const first = yield* Clock.currentTimeMillis;
        pinsOf(yield* pin("acme/relay", true));
        yield* TestClock.adjust("1 minute");
        const second = yield* Clock.currentTimeMillis;
        const both = pinsOf(yield* pin("acme/ledger", true));
        yield* TestClock.adjust("1 minute");
        const again = pinsOf(yield* pin("acme/relay", true));
        const unpinned = pinsOf(yield* pin("acme/ledger", false));
        const unpinnedTwice = pinsOf(yield* pin("acme/ledger", false));

        assert.deepEqual(both, [
          ["acme/ledger", second],
          ["acme/relay", first],
        ]);
        assert.deepEqual(again, both, "a second pin moves nothing");
        assert.deepEqual(unpinned, [["acme/relay", first]]);
        assert.deepEqual(unpinnedTwice, unpinned);
        assert.deepEqual(pinsOf(yield* ask(request(owner))), unpinned);
        assert.deepEqual(pinsOf(yield* ask(request(other))), [], "another account holds none");
      }),
  );

  it.effect(
    "a pin past the bound is refused with nothing written, and a repository already pinned still answers",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts;
        const pin = (repository: string) =>
          ask(request(owner, { method: "PUT", body: { repository, pinned: true } }));
        for (let index = 0; index < REPOSITORY_PIN_BOUNDS.MAX_PINS; index += 1) {
          yield* pin(`acme/repo-${index}`);
        }

        const past = yield* pin("acme/one-too-many");
        const standing = yield* pin("acme/repo-0");

        assert.deepEqual(
          past,
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.equal(pinsOf(standing).length, REPOSITORY_PIN_BOUNDS.MAX_PINS);
        assert.equal(
          pinsOf(standing).some(([repository]) => repository === "acme/one-too-many"),
          false,
        );
      }),
  );

  it.effect(
    "a body that is not a pin, a bearer that names no account, and a method the path does not answer are refused",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts;

        const notARepository = yield* ask(
          request(owner, { method: "PUT", body: { repository: "not a repository", pinned: true } }),
        );
        const extraKey = yield* ask(
          request(owner, {
            method: "PUT",
            body: { repository: "acme/relay", pinned: true, userId: "someone-else" },
          }),
        );
        const unsigned = yield* ask(request(undefined));
        const deleted = yield* ask(request(owner, { method: "DELETE" }));

        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        assert.deepEqual(notARepository, invalid);
        assert.deepEqual(extraKey, invalid);
        assert.deepEqual(
          unsigned,
          refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
        );
        assert.deepEqual(
          deleted,
          refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
        );
        assert.deepEqual(pinsOf(yield* ask(request(owner))), []);
      }),
  );

  it.effect("deleting the account deletes its pins", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      yield* ask(
        request(owner, { method: "PUT", body: { repository: "acme/relay", pinned: true } }),
      );

      yield* db.delete(user).where(eq(user.id, owner));

      const left = yield* db.select().from(repositoryPin).where(eq(repositoryPin.userId, owner));
      assert.deepEqual(left, []);
    }),
  );
});
