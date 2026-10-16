import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { listPages, readPageVersion } from "@luke/database/models/plan-pages";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, startTask } from "@luke/database/testing";
import { unparsedWire, type WireBoundaryInput, type WireRecord } from "@luke/wire";
import { Effect, Option, Schema } from "effect";
import { ACTION_RESULT_STATUS } from "../core.js";
import { type PageToolBinding, runShowPage, SHOW_PAGE_REFUSAL } from "./page-tool.js";

/**
 * `show_page`, every agent's one tool for a page, through its public
 * function against a real dialect: inline HTML makes a page the plan lists,
 * a page named again takes its next version, a secret file is never read,
 * and another account's plan takes no page. Synthetic accounts, plans, and
 * pages throughout.
 */

const CHECKOUT = "/vercel/sandbox/repository";

const FUNNEL = "<!doctype html><h1>Invite funnel</h1><script>document.title = 'é'</script>";

const openTask = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const task = yield* startTask(userId, { name: "Teammate invitations" });
  return { userId, taskId: task.id };
});

/** A sandbox holding the files given by absolute path, each read as one stream, recording every path asked for. */
function sandboxWith(files: Readonly<Record<string, string>>) {
  const reads: string[] = [];
  const sandbox: NonNullable<PageToolBinding["sandbox"]> = {
    checkout: CHECKOUT,
    door: () =>
      Promise.resolve({
        readFile: ({ path }: { path: string }) => {
          reads.push(path);
          const text = files[path];
          if (text === undefined) return Promise.resolve(null);
          return Promise.resolve(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(text));
                controller.close();
              },
            }),
          );
        },
      }),
  };
  return { sandbox, reads };
}

const show = (binding: PageToolBinding, input: WireBoundaryInput) =>
  runShowPage(binding, unparsedWire(input));

const readAccepted = Schema.decodeUnknownSync(
  Schema.Struct({
    status: Schema.Literal(ACTION_RESULT_STATUS.ACCEPTED),
    page: Schema.Struct({ id: Schema.String, version: Schema.Number }),
  }),
);

/** The page an accepted call answered, failing the test where it was refused. */
const shownPage = (answer: WireRecord) => readAccepted(answer).page;

const refused = (reason: string) => ({ status: ACTION_RESULT_STATUS.REJECTED, reason });

it.layer(getTestDB())("show_page", (it) => {
  it.effect(
    "inline HTML makes a page, named again it takes the next version, and the answer never carries the HTML",
    () =>
      Effect.gen(function* () {
        const task = yield* openTask;
        const first = yield* show(task, { title: "Invite funnel", html: FUNNEL });
        const page = shownPage(first);
        const second = shownPage(
          yield* show(task, {
            title: "Invite funnel, by week",
            html: `${FUNNEL}<p>v2</p>`,
            page: page.id,
          }),
        );

        assert.deepEqual(first, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          page: { id: page.id, version: 1 },
        });
        assert.deepEqual(second, { id: page.id, version: 2 });
        assert.deepEqual(
          (yield* listPages(task.userId, task.taskId)).map(({ id, title, version }) => ({
            id,
            title,
            version,
          })),
          [{ id: page.id, title: "Invite funnel, by week", version: 2 }],
        );
        const stored = yield* readPageVersion(task.userId, task.taskId, page.id, 1);
        assert.equal(Option.getOrThrow(stored).html, FUNNEL);
      }),
  );

  it.effect("a secret file in the sandbox is never read into a page", () =>
    Effect.gen(function* () {
      const task = yield* openTask;
      const { sandbox, reads } = sandboxWith({ [`${CHECKOUT}/.env`]: "TOKEN=secret" });
      const agent = { ...task, sandbox };

      assert.deepEqual(
        yield* show(agent, { title: "Funnel", path: ".env" }),
        refused(SHOW_PAGE_REFUSAL.SECRET),
      );
      assert.deepEqual(
        yield* show(agent, { title: "Funnel", path: "nested/../.env/." }),
        refused(SHOW_PAGE_REFUSAL.SECRET),
      );
      assert.ok(!reads.includes(`${CHECKOUT}/.env`), "a secret file is never read");
      assert.deepEqual(yield* listPages(task.userId, task.taskId), []);
    }),
  );

  it.effect("a plan another account owns takes no page", () =>
    Effect.gen(function* () {
      const task = yield* openTask;
      const other = yield* openTask;

      assert.deepEqual(
        yield* show(
          { userId: other.userId, taskId: task.taskId },
          { title: "Funnel", html: FUNNEL },
        ),
        refused(SHOW_PAGE_REFUSAL.NO_TASK),
      );
      assert.deepEqual(yield* listPages(task.userId, task.taskId), []);
    }),
  );
});
