import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import { IDEMPOTENCY_KEY } from "@repo/features";
import {
  TASK_SECTION_WRITE,
  type TaskSections,
  taskSectionsWrittenSchema,
} from "@repo/features/task-section-wire";
import { unparsedWire, type WireBoundaryInput } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Clock, type Context, Effect, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { taskSectionsProcedures } from "./task-sections-procedures.js";

const ORIGIN = "https://app.test";
const SECTIONS = "/api/task-sections";

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
    const services = (yield* Effect.context<never>()) as Context.Context<WebServices>;
    const handle = hostedFetch({
      taskSections: taskSectionsProcedures({
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
  init: { method?: string; body?: WireBoundaryInput; idempotencyKey?: string } = {},
) {
  return new Request(new URL(SECTIONS, ORIGIN), {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(userId === undefined ? undefined : { authorization: `Bearer ${userId}` }),
      ...(init.idempotencyKey === undefined
        ? undefined
        : { [IDEMPOTENCY_KEY.HEADER]: init.idempotencyKey }),
    },
    ...(init.body === undefined ? undefined : { body: JSON.stringify(init.body) }),
  });
}

function readAnswer(answered: Answer) {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
  const read = readEither(taskSectionsWrittenSchema)(unparsedWire(answered.body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's: ${read.failure.refusal}`);
  return read.success;
}

function sectionsOf(answered: Answer): TaskSections {
  const { txid: _txid, ...sections } = readAnswer(answered);
  return sections;
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
      const createIt = () =>
        ask(
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
        );
      const answered = yield* createIt();
      const made = sectionsOf(answered);
      assert.match(readAnswer(answered).txid ?? "", /^\d+$/u);
      assert.equal(readAnswer(yield* createIt()).txid, undefined);

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
        agentEntries: [],
      });
      assert.deepEqual(sectionsOf(yield* ask(request(owner))), made);
      assert.deepEqual(sectionsOf(yield* ask(request(other))), {
        sections: [],
        entries: [],
        agentEntries: [],
      });
    }),
  );

  it.effect(
    "an edit sent again under the key it was taken under is answered as written, and a later edit stands",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts;
        const workspaceId = yield* openWorkspace(owner);
        const id = randomUUID();
        const key = randomUUID();
        const write = (body: WireBoundaryInput, idempotencyKey?: string) =>
          ask(
            request(owner, {
              method: "PUT",
              body,
              ...(idempotencyKey === undefined ? undefined : { idempotencyKey }),
            }),
          );
        const edit = (title: string) => ({ kind: TASK_SECTION_WRITE.EDIT, id, title, icon: null });
        readAnswer(
          yield* write({ kind: TASK_SECTION_WRITE.CREATE, id, workspaceId, title: "Draft" }),
        );

        readAnswer(yield* write(edit("Offline"), key));
        readAnswer(yield* write(edit("Later")));
        const replayed = yield* write(edit("Offline"), key);

        assert.deepEqual(
          replayed,
          refusal(HOSTED_HTTP_STATUS.CONFLICT, HOSTED_API_ERROR.ALREADY_WRITTEN),
        );
        assert.deepEqual(
          sectionsOf(yield* ask(request(owner))).sections.map((section) => section.title),
          ["Later"],
        );
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
        assert.deepEqual(sectionsOf(yield* ask(request(owner))), {
          sections: [],
          entries: [],
          agentEntries: [],
        });
      }),
  );
});
