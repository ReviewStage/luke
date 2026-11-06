import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { user } from "@repo/database/schemas/auth";
import { getTestDB } from "@repo/database/testing";
import { repositoryPinsWrittenSchema } from "@repo/features/task-wire";
import { unparsedWire, type WireBoundaryInput } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Clock, type Context, Effect, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import { recordingProductAnalytics, SERVER_EVENT } from "../events/server-events.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { repositoryPinsProcedures } from "./repository-pins-procedures.js";

const ORIGIN = "https://app.test";
const PINS = "/api/repository-pins";

const ANALYTICS = recordingProductAnalytics();

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
  const ask = (request: Request) => answer(bearers, request);
  return { owner, other, ask };
});

const answer = (bearers: ReadonlyMap<string, string>, request: Request) =>
  Effect.gen(function* () {
    const services = (yield* Effect.context<never>().pipe(
      Effect.provide(ANALYTICS.layer),
    )) as Context.Context<WebServices>;
    const handle = hostedFetch({
      repositoryPins: repositoryPinsProcedures({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
          ),
      }),
    });
    const response = yield* Effect.promise(() => handle(request, services));
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

function readAnswer(answered: Answer) {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
  const read = readEither(repositoryPinsWrittenSchema)(unparsedWire(answered.body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's: ${read.failure.refusal}`);
  return read.success;
}

function pinsOf(answered: Answer): [string, number][] {
  return readAnswer(answered).pins.map(({ repository, pinnedAt }) => [repository, pinnedAt]);
}

const wroteRow = (answered: Answer) => readAnswer(answered).txid !== undefined;

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
        const pinned = yield* pin("acme/relay", true);
        yield* TestClock.adjust("1 minute");
        const second = yield* Clock.currentTimeMillis;
        const both = pinsOf(yield* pin("acme/ledger", true));
        yield* TestClock.adjust("1 minute");
        const pinnedAgain = yield* pin("acme/relay", true);
        const again = pinsOf(pinnedAgain);
        const unpinnedAnswer = yield* pin("acme/ledger", false);
        const unpinned = pinsOf(unpinnedAnswer);
        const unpinnedTwiceAnswer = yield* pin("acme/ledger", false);
        const unpinnedTwice = pinsOf(unpinnedTwiceAnswer);

        assert.deepEqual([pinned, pinnedAgain, unpinnedAnswer, unpinnedTwiceAnswer].map(wroteRow), [
          true,
          false,
          true,
          false,
        ]);

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
    "a pin that changed a row is counted without its repository, and a pin that moved nothing is not",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts;
        const pin = (pinned: boolean) =>
          ask(request(owner, { method: "PUT", body: { repository: "acme/relay", pinned } }));

        yield* pin(true);
        yield* pin(true);
        yield* pin(false);
        yield* pin(false);

        assert.deepEqual(
          ANALYTICS.recorded.filter((event) => event.userId === owner),
          [
            { name: SERVER_EVENT.REPOSITORY_PIN, userId: owner, properties: { pinned: true } },
            { name: SERVER_EVENT.REPOSITORY_PIN, userId: owner, properties: { pinned: false } },
          ],
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
});
