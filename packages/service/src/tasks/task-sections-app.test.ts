import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, openWorkspace } from "@luke/database/testing";
import {
  TASK_SECTION_WRITE,
  type TaskSections,
  taskSectionsAnswerSchema,
} from "@luke/features/task-section-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Clock, Effect, Layer, Option, Result } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { taskSectionsApp } from "./task-sections-app.js";

/**
 * The sidebar's task sections, answered by the group the way a function
 * answers them, over a real dialect: the bearer names the account and
 * nothing else does, every write answers the sections as they then stand,
 * and a write that is not one, or that names what the account does not
 * hold, is refused with nothing written.
 *
 * Synthetic accounts, bearers, workspaces, and sections throughout.
 */

const ORIGIN = "https://luke.test";
const SECTIONS = "/api/task-sections";

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** Two accounts, each behind its own bearer, and the group answering one request. */
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
    const client = yield* SqlClient.SqlClient;
    // The handler runs on the router's own fiber, so it is handed the test's clock: a section's instant is read from it.
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      taskSectionsApp({
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
  return new Request(new URL(SECTIONS, ORIGIN), {
    method: init.method ?? "GET",
    headers: userId === undefined ? {} : { authorization: `Bearer ${userId}` },
    ...(init.body === undefined ? undefined : { body: JSON.stringify(init.body) }),
  });
}

/** The sections an answer carries, failing the test where it is not the wire's. */
function sectionsOf(answered: Answer): TaskSections {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
  const read = readEither(taskSectionsAnswerSchema)(unparsedWire(answered.body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's: ${read.failure.refusal}`);
  return read.success;
}

const refusal = (status: number, error: string): Answer => ({ status, body: { error } });

it.layer(getTestDB())("the task sections route", (it) => {
  it.effect("a section made answers every section, for the bearer's account alone", () =>
    Effect.gen(function* () {
      const { owner, other, ask } = yield* openAccounts;
      const workspaceId = yield* openWorkspace(owner);
      const id = randomUUID();
      const madeAt = yield* Clock.currentTimeMillis;
      yield* TestClock.adjust("1 minute");
      const made = sectionsOf(
        yield* ask(
          request(owner, {
            method: "PUT",
            body: {
              kind: TASK_SECTION_WRITE.CREATE,
              id,
              workspaceId,
              title: "  Launch ",
              icon: { kind: "emoji", emoji: "🚀" },
            },
          }),
        ),
      );

      assert.deepEqual(made, {
        sections: [
          {
            id,
            workspaceId,
            title: "Launch",
            icon: { kind: "emoji", emoji: "🚀" },
            createdAt: madeAt + 60_000,
          },
        ],
        entries: [],
      });
      assert.deepEqual(sectionsOf(yield* ask(request(owner))), made);
      assert.deepEqual(sectionsOf(yield* ask(request(other))), { sections: [], entries: [] });
    }),
  );

  it.effect(
    "a body that is not a write, a write the account cannot make, a bearer that names no account, and a method the path does not answer are refused",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts;
        const workspaceId = yield* openWorkspace(other);
        const write = (body: WireBoundaryInput) => ask(request(owner, { method: "PUT", body }));
        const create = { kind: TASK_SECTION_WRITE.CREATE, id: randomUUID(), title: "Launch" };

        const twoEmoji = yield* write({
          ...create,
          workspaceId,
          icon: { kind: "emoji", emoji: "🚀🚀" },
        });
        const notAGlyph = yield* write({
          ...create,
          workspaceId,
          icon: { kind: "glyph", glyph: "unicorn" },
        });
        const blank = yield* write({ ...create, workspaceId, title: "   " });
        const extraKey = yield* write({ ...create, workspaceId, userId: other });
        const notTheirs = yield* write({ ...create, workspaceId });
        const unsigned = yield* ask(request(undefined));
        const deleted = yield* ask(request(owner, { method: "DELETE" }));

        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        for (const answered of [twoEmoji, notAGlyph, blank, extraKey, notTheirs]) {
          assert.deepEqual(answered, invalid);
        }
        assert.deepEqual(
          unsigned,
          refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
        );
        assert.deepEqual(
          deleted,
          refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
        );
        assert.deepEqual(sectionsOf(yield* ask(request(owner))), { sections: [], entries: [] });
      }),
  );
});
