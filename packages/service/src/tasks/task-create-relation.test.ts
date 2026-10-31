import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { readTaskBlocks } from "@luke/database/models/task-block-store";
import { createTask, listTasks, readTaskHeader } from "@luke/database/models/task-store";
import { fakeWorkspaceSeams, getTestDB, openWorkspace } from "@luke/database/testing";
import { HOSTED_API_ERROR } from "@luke/features";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import {
  TASK_CREATE_RELATION_KIND,
  type TaskCreateRelation,
  type TaskCreateRequest,
} from "@luke/features/task-wire";
import { Clock, type Context, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { sessionSandboxesLayer } from "../agents/session-sandboxes.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import {
  fakeGitHub,
  GITHUB_APP_WITH_TOKENS,
  memberRepositoryJson,
  openTokenMember,
  type SentToGitHub,
} from "../testing/github-app-fake.js";
import { keepAwakeDetached } from "../testing/session-sandboxes-fake.js";
import { tasksProcedures } from "./tasks-procedures.js";

/**
 * A member starting a plan related to another through the hosted oRPC
 * router, as the web route answers it, over a real dialect: the plan starts
 * as a sub-task of the other, as its parent, or blocking or blocked by it,
 * and the relation is written with it. A start as a plan's parent is
 * refused where that plan has a parent already, a start naming another
 * repository than the tree's is refused as a sub-task and as a parent
 * alike, and a member who does not reach the other plan is refused, each
 * making nothing. Synthetic accounts, plans, and tokens throughout.
 */

const ORIGIN = "https://luke.test";
const SIDE = { owner: "octo-member", name: "side" } as const;
const SIDE_REPOSITORY = `${SIDE.owner}/${SIDE.name}`;

/** GitHub's `GET /repos/{owner}/{repo}` on any member's token: the repository, pushable; nothing else is reached. */
function answer(sent: SentToGitHub): Response {
  return new URL(sent.url).pathname === `/repos/${SIDE.owner}/${SIDE.name}`
    ? Response.json(memberRepositoryJson(SIDE, true))
    : Response.json({ message: "Not Found" }, { status: 404 });
}

/** The plans procedures over the test's store and GitHub, each bearer answering for the account it maps to. */
const starting = (bearers: ReadonlyMap<string, string>) =>
  Effect.gen(function* () {
    const github = fakeGitHub(answer, GITHUB_APP_WITH_TOKENS);
    const services = yield* Effect.context<never>().pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
          Layer.succeed(Database, yield* Database),
          Layer.succeed(Clock.Clock, yield* Clock.Clock),
          github.layer,
        ),
      ),
    );
    const handle = hostedFetch({
      plans: tasksProcedures({
        resolveUserId: (incoming: Request) =>
          Effect.succeed(
            Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
          ),
        eveOrigin: () => undefined,
        sessionSandboxes: sessionSandboxesLayer,
        keepAwake: keepAwakeDetached,
        workspaces: yield* fakeWorkspaceSeams,
      }),
    });
    // SAFETY: a start yields the store, the clock, and GitHub alone, which is all a test provides of the web runtime's services.
    const webServices = services as Context.Context<WebServices>;
    return (bearer: string, body: TaskCreateRequest) =>
      Effect.promise(async () => {
        const response = await handle(
          new Request(new URL("/api/plans", ORIGIN), {
            method: "POST",
            headers: { authorization: bearer, "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
          webServices,
        );
        // SAFETY: the router answers JSON; the test compares it as the wire value it is.
        return { status: response.status, body: JSON.parse(await response.text()) };
      });
  });

/** The task's parent as the account reads it, which the test expects it to reach. */
const parentOf = (userId: string, taskId: string) =>
  Effect.map(
    readTaskHeader(userId, taskId),
    (header) =>
      Option.getOrElse(header, () => assert.fail("the task was not reached")).parentTaskId,
  );

/** The ids of every task the account reaches, sorted, since two started in one instant list in no fixed order. */
const listedIds = (userId: string) =>
  Effect.map(listTasks(userId), (tasks) => tasks.map((each) => each.id).sort());

it.layer(getTestDB())("a plan started in a relation to another", (it) => {
  it.effect(
    "a plan starts as a sub-task of the other, as its parent in its repository, or blocking or blocked by it, the relation written with it",
    () =>
      Effect.gen(function* () {
        const owner = yield* openTokenMember();
        const workspace = yield* openWorkspace(owner);
        const { id: above } = yield* createTask(owner, { organizationId: workspace, name: "A" });
        const { id: below } = yield* createTask(owner, {
          organizationId: workspace,
          name: "B",
          repository: SIDE_REPOSITORY,
          githubAccess: GITHUB_ACCESS.TOKEN,
        });
        const { id: waiting } = yield* createTask(owner, { organizationId: workspace, name: "W" });
        const { id: holding } = yield* createTask(owner, { organizationId: workspace, name: "H" });
        const send = yield* starting(new Map([["Bearer owner", owner]]));
        const start = (name: string, kind: TaskCreateRelation) =>
          send("Bearer owner", { name, workspaceId: workspace, relation: kind });

        const subTask = yield* start("Sub", {
          kind: TASK_CREATE_RELATION_KIND.SUB_TASK_OF,
          taskId: above,
        });
        const parent = yield* start("Parent", {
          kind: TASK_CREATE_RELATION_KIND.PARENT_OF,
          taskId: below,
        });
        const blocker = yield* start("Blocker", {
          kind: TASK_CREATE_RELATION_KIND.BLOCKS,
          taskId: waiting,
        });
        const blocked = yield* start("Blocked", {
          kind: TASK_CREATE_RELATION_KIND.BLOCKED_BY,
          taskId: holding,
        });

        for (const started of [subTask, parent, blocker, blocked]) {
          assert.equal(started.status, 201, JSON.stringify(started.body));
          assert.match(started.body.txid, /^\d+$/u);
        }
        assert.equal(subTask.body.plan.parentTaskId, above);
        assert.deepEqual(
          [parent.body.plan.parentTaskId, parent.body.plan.repository],
          [undefined, SIDE_REPOSITORY],
        );
        assert.equal(yield* parentOf(owner, below), parent.body.plan.id);
        assert.deepEqual(
          yield* readTaskBlocks(owner, blocker.body.plan.id),
          Option.some({ blockedBy: [], blocks: [waiting] }),
        );
        assert.deepEqual(
          yield* readTaskBlocks(owner, blocked.body.plan.id),
          Option.some({ blockedBy: [holding], blocks: [] }),
        );
      }).pipe(Effect.provide(GITHUB_APP_WITH_TOKENS)),
  );

  it.effect(
    "a start as the parent of a plan that has a parent already is refused by name, and nothing is made",
    () =>
      Effect.gen(function* () {
        const owner = yield* openTokenMember();
        const workspace = yield* openWorkspace(owner);
        const { id: top } = yield* createTask(owner, { organizationId: workspace, name: "T" });
        const { id: leaf } = yield* createTask(owner, {
          organizationId: workspace,
          name: "L",
          parentTaskId: top,
        });
        const send = yield* starting(new Map([["Bearer owner", owner]]));

        const held = yield* send("Bearer owner", {
          name: "Between",
          workspaceId: workspace,
          relation: { kind: TASK_CREATE_RELATION_KIND.PARENT_OF, taskId: leaf },
        });

        assert.deepEqual(held, {
          status: 409,
          body: { error: HOSTED_API_ERROR.TASK_PARENT_HELD },
        });
        assert.deepEqual(yield* listedIds(owner), [leaf, top].sort());
        assert.equal(yield* parentOf(owner, leaf), top);
      }).pipe(Effect.provide(GITHUB_APP_WITH_TOKENS)),
  );

  it.effect(
    "a start naming another repository than the plan it joins a tree with is refused as a sub-task and as a parent alike, and nothing is made",
    () =>
      Effect.gen(function* () {
        const owner = yield* openTokenMember();
        const workspace = yield* openWorkspace(owner);
        const { id: side } = yield* createTask(owner, {
          organizationId: workspace,
          name: "Side",
          repository: SIDE_REPOSITORY,
          githubAccess: GITHUB_ACCESS.TOKEN,
        });
        const send = yield* starting(new Map([["Bearer owner", owner]]));
        const elsewhere = (kind: TaskCreateRelation) =>
          send("Bearer owner", {
            name: "Elsewhere",
            workspaceId: workspace,
            repository: "octo-member/other",
            relation: kind,
          });

        const asSubTask = yield* elsewhere({
          kind: TASK_CREATE_RELATION_KIND.SUB_TASK_OF,
          taskId: side,
        });
        const asParent = yield* elsewhere({
          kind: TASK_CREATE_RELATION_KIND.PARENT_OF,
          taskId: side,
        });

        const locked = { status: 409, body: { error: HOSTED_API_ERROR.CHILD_REPOSITORY_LOCKED } };
        assert.deepEqual([asSubTask, asParent], [locked, locked]);
        assert.deepEqual(yield* listedIds(owner), [side]);
      }).pipe(Effect.provide(GITHUB_APP_WITH_TOKENS)),
  );

  it.effect(
    "a start related to a plan its member does not reach, or of another workspace, is not found, and nothing is made",
    () =>
      Effect.gen(function* () {
        const owner = yield* openTokenMember();
        const stranger = yield* openTokenMember({ token: "fixture-stranger-token" });
        const workspace = yield* openWorkspace(owner);
        const elsewhere = yield* openWorkspace(owner);
        const { id: side } = yield* createTask(owner, { organizationId: workspace, name: "S" });
        const send = yield* starting(
          new Map([
            ["Bearer owner", owner],
            ["Bearer stranger", stranger],
          ]),
        );

        const byStranger = yield* send("Bearer stranger", {
          name: "Blocked",
          relation: { kind: TASK_CREATE_RELATION_KIND.BLOCKED_BY, taskId: side },
        });
        const acrossWorkspaces = yield* send("Bearer owner", {
          name: "Parent",
          workspaceId: elsewhere,
          relation: { kind: TASK_CREATE_RELATION_KIND.PARENT_OF, taskId: side },
        });

        const notFound = { status: 404, body: { error: HOSTED_API_ERROR.NOT_FOUND } };
        assert.deepEqual([byStranger, acrossWorkspaces], [notFound, notFound]);
        assert.deepEqual(yield* listedIds(owner), [side]);
        assert.deepEqual(yield* listedIds(stranger), []);
        assert.deepEqual(
          yield* readTaskBlocks(owner, side),
          Option.some({ blockedBy: [], blocks: [] }),
        );
      }).pipe(Effect.provide(GITHUB_APP_WITH_TOKENS)),
  );
});
