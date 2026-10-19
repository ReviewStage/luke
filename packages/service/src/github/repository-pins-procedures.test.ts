import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { user } from "@luke/database/schemas/auth";
import { getTestDB } from "@luke/database/testing";
import { repositoryPinsAnswerSchema } from "@luke/features/task-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Clock, type Context, Effect, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { repositoryPinsProcedures } from "./repository-pins-procedures.js";

/**
 * The sidebar's repository pins, answered by the hosted oRPC router the way the web route
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

/** Two accounts, each behind its own bearer, and the resource answering one request. */
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
  const ask = (request: Request) => answer(bearers, request);
  return { owner, other, ask };
});

const answer = (bearers: ReadonlyMap<string, string>, request: Request) =>
  Effect.gen(function* () {
    // The procedure runs on the services handed to it, the test's clock among them: a pin's instant is read from it.
    // SAFETY: the procedures yield the database and the clock alone, which the test's own context holds.
    const services = (yield* Effect.context<never>()) as Context.Context<WebServices>;
    const handle = hostedFetch({
      repositoryPins: repositoryPinsProcedures({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
          ),
      }),
    });
    const response = yield* Effect.promise(() => handle(request, services));
    // SAFETY: the route answers JSON; the test compares it as the wire value it is.
    const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
    return { status: response.status, body } satisfies Answer;
  });

function request(
  userId: string | undefined,
  init: { method?: string; body?: WireBoundaryInput } = {},
) {
  return new Request(new URL(PINS, ORIGIN), {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(userId === undefined ? undefined : { authorization: `Bearer ${userId}` }),
    },
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

it.layer(getTestDB())("the repository pins route", (it) => {
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
});
