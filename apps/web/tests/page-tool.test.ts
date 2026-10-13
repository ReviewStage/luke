import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import { listPages, readPageVersion } from "@sidecar/database/models/plan-pages";
import { user } from "@sidecar/database/schemas/auth";
import { getTestDB } from "@sidecar/database/testing";
import { unparsedWire, type WireBoundaryInput, type WireRecord } from "@sidecar/wire";
import { Effect, Option, Schema } from "effect";
import { ACTION_RESULT_STATUS } from "../server/core";
import { type PageToolBinding, runShowPage, SHOW_PAGE_REFUSAL } from "../server/hosted/page-tool";
import { startPlan } from "./support/workspaces";

/**
 * `show_page`, every agent's one tool for a page, through its public
 * function against a real dialect: inline HTML makes a page the plan lists,
 * a page named again takes its next version, a secret file is never read,
 * and another account's plan takes no page. Synthetic accounts, plans, and
 * pages throughout.
 */

const CHECKOUT = "/vercel/sandbox/repository";

const FUNNEL = "<!doctype html><h1>Invite funnel</h1><script>document.title = 'é'</script>";

const openPlan = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const plan = yield* startPlan(userId, { name: "Teammate invitations" });
  return { userId, planId: plan.id };
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
        const plan = yield* openPlan;
        const first = yield* show(plan, { title: "Invite funnel", html: FUNNEL });
        const page = shownPage(first);
        const second = shownPage(
          yield* show(plan, {
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
          (yield* listPages(plan.userId, plan.planId)).map(({ id, title, version }) => ({
            id,
            title,
            version,
          })),
          [{ id: page.id, title: "Invite funnel, by week", version: 2 }],
        );
        const stored = yield* readPageVersion(plan.userId, plan.planId, page.id, 1);
        assert.equal(Option.getOrThrow(stored).html, FUNNEL);
      }),
  );

  it.effect("a secret file in the sandbox is never read into a page", () =>
    Effect.gen(function* () {
      const plan = yield* openPlan;
      const { sandbox, reads } = sandboxWith({ [`${CHECKOUT}/.env`]: "TOKEN=secret" });
      const agent = { ...plan, sandbox };

      assert.deepEqual(
        yield* show(agent, { title: "Funnel", path: ".env" }),
        refused(SHOW_PAGE_REFUSAL.SECRET),
      );
      assert.deepEqual(
        yield* show(agent, { title: "Funnel", path: "nested/../.env/." }),
        refused(SHOW_PAGE_REFUSAL.SECRET),
      );
      assert.ok(!reads.includes(`${CHECKOUT}/.env`), "a secret file is never read");
      assert.deepEqual(yield* listPages(plan.userId, plan.planId), []);
    }),
  );

  it.effect("a plan another account owns takes no page", () =>
    Effect.gen(function* () {
      const plan = yield* openPlan;
      const other = yield* openPlan;

      assert.deepEqual(
        yield* show(
          { userId: other.userId, planId: plan.planId },
          { title: "Funnel", html: FUNNEL },
        ),
        refused(SHOW_PAGE_REFUSAL.NO_PLAN),
      );
      assert.deepEqual(yield* listPages(plan.userId, plan.planId), []);
    }),
  );
});
