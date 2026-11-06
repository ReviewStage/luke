import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { readTaskBlocks } from "@repo/database/models/task-block-store";
import { createTask, readTaskHeader } from "@repo/database/models/task-store";
import { fakeWorkspaceSeams, getTestDB, openWorkspace } from "@repo/database/testing";
import { HOSTED_API_ERROR } from "@repo/features";
import {
  TASK_BLOCK_CHANGE,
  TASK_BLOCK_RELATION,
  TASK_RELATION_KIND,
  type TaskBlockRequest,
  type TaskParentRequest,
  type TaskRelationChangeRequest,
} from "@repo/features/task-wire";
import { Clock, type Context, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { sessionSandboxesLayer } from "../agents/session-sandboxes.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { fakeGitHub, GITHUB_APP_WITH_TOKENS, openTokenMember } from "../testing/github-app-fake.js";
import { keepAwakeDetached } from "../testing/session-sandboxes-fake.js";
import { tasksProcedures } from "./tasks-procedures.js";

const PLAN_WRITE = {
  BLOCKS: "blocks",
  PARENT: "parent",
  RELATION: "relation",
} as const;

type PlanWrite = (typeof PLAN_WRITE)[keyof typeof PLAN_WRITE];

const ORIGIN = "https://app.test";

const blocking = (bearers: ReadonlyMap<string, string>) =>
  Effect.gen(function* () {
    const github = fakeGitHub(() => Response.json({}, { status: 404 }), GITHUB_APP_WITH_TOKENS);
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
        sessionSandboxes: sessionSandboxesLayer,
        keepAwake: keepAwakeDetached,
        workspaces: yield* fakeWorkspaceSeams,
      }),
    });
    const webServices = services as Context.Context<WebServices>;
    return (
      taskId: string,
      bearer: string,
      change: TaskBlockRequest | TaskParentRequest | TaskRelationChangeRequest,
      write: PlanWrite = PLAN_WRITE.BLOCKS,
    ) =>
      Effect.promise(async () => {
        const response = await handle(
          new Request(new URL(`/api/plans/${taskId}/${write}`, ORIGIN), {
            method: "POST",
            headers: { authorization: bearer, "content-type": "application/json" },
            body: JSON.stringify(change),
          }),
          webServices,
        );
        return { status: response.status, body: JSON.parse(await response.text()) };
      });
  });

const add = (relation: TaskBlockRequest["relation"], taskId: string): TaskBlockRequest => ({
  change: TASK_BLOCK_CHANGE.ADD,
  relation,
  taskId,
});

it.layer(getTestDB())("a member's blocks on a task", (it) => {
  it.effect(
    "a block is written on the side the change names and answered on the task the path names, and taken away the same way",
    () =>
      Effect.gen(function* () {
        const owner = yield* openTokenMember();
        const workspace = yield* openWorkspace(owner);
        const { id: schema } = yield* createTask(owner, { organizationId: workspace, name: "S" });
        const { id: panel } = yield* createTask(owner, { organizationId: workspace, name: "P" });
        const { id: mark } = yield* createTask(owner, { organizationId: workspace, name: "M" });
        const send = yield* blocking(new Map([["Bearer owner", owner]]));

        const blockedBy = yield* send(
          panel,
          "Bearer owner",
          add(TASK_BLOCK_RELATION.BLOCKED_BY, schema),
        );
        const blocks = yield* send(panel, "Bearer owner", add(TASK_BLOCK_RELATION.BLOCKS, mark));

        assert.equal(blockedBy.status, 200, JSON.stringify(blockedBy.body));
        assert.deepEqual(
          [blockedBy.body.plan.blockedBy, blockedBy.body.plan.blocks],
          [[schema], []],
        );
        assert.deepEqual([blocks.body.plan.blockedBy, blocks.body.plan.blocks], [[schema], [mark]]);
        assert.deepEqual(
          yield* readTaskBlocks(owner, mark),
          Option.some({ blockedBy: [panel], blocks: [] }),
        );

        const removed = yield* send(panel, "Bearer owner", {
          change: TASK_BLOCK_CHANGE.REMOVE,
          relation: TASK_BLOCK_RELATION.BLOCKED_BY,
          taskId: schema,
        });

        assert.deepEqual([removed.body.plan.blockedBy, removed.body.plan.blocks], [[], [mark]]);
      }),
  );

  it.effect(
    "a block onto a task out of reach or of another workspace, or closing a cycle, is refused and writes nothing",
    () =>
      Effect.gen(function* () {
        const owner = yield* openTokenMember();
        const stranger = yield* openTokenMember({ token: "fixture-stranger-token" });
        const workspace = yield* openWorkspace(owner);
        const elsewhere = yield* openWorkspace(owner);
        const theirs = yield* openWorkspace(stranger);
        const { id: schema } = yield* createTask(owner, { organizationId: workspace, name: "S" });
        const { id: panel } = yield* createTask(owner, { organizationId: workspace, name: "P" });
        const { id: other } = yield* createTask(owner, { organizationId: elsewhere, name: "O" });
        const { id: hidden } = yield* createTask(stranger, { organizationId: theirs, name: "H" });
        const send = yield* blocking(
          new Map([
            ["Bearer owner", owner],
            ["Bearer stranger", stranger],
          ]),
        );
        yield* send(panel, "Bearer owner", add(TASK_BLOCK_RELATION.BLOCKED_BY, schema));

        const ontoHidden = yield* send(
          panel,
          "Bearer owner",
          add(TASK_BLOCK_RELATION.BLOCKS, hidden),
        );
        const fromStranger = yield* send(
          schema,
          "Bearer stranger",
          add(TASK_BLOCK_RELATION.BLOCKS, hidden),
        );
        const across = yield* send(panel, "Bearer owner", add(TASK_BLOCK_RELATION.BLOCKS, other));
        const cycle = yield* send(
          schema,
          "Bearer owner",
          add(TASK_BLOCK_RELATION.BLOCKED_BY, panel),
        );

        const notFound = { status: 404, body: { error: HOSTED_API_ERROR.NOT_FOUND } };
        assert.deepEqual([ontoHidden, fromStranger], [notFound, notFound]);
        assert.deepEqual(across, {
          status: 400,
          body: { error: HOSTED_API_ERROR.INVALID_REQUEST },
        });
        assert.deepEqual(cycle, {
          status: 409,
          body: { error: HOSTED_API_ERROR.TASK_BLOCK_CYCLE },
        });
        assert.deepEqual(
          yield* readTaskBlocks(owner, panel),
          Option.some({ blockedBy: [schema], blocks: [] }),
        );
      }),
  );
});

const parentOf = (userId: string, taskId: string) =>
  Effect.map(
    readTaskHeader(userId, taskId),
    (header) =>
      Option.getOrElse(header, () => assert.fail("the task was not reached")).parentTaskId,
  );

it.layer(getTestDB())("a member's parent and relations on a task", (it) => {
  it.effect(
    "a parent is set and cleared on the task the path names, and refused by name under which the task would descend from itself, in another repository, or out of reach",
    () =>
      Effect.gen(function* () {
        const owner = yield* openTokenMember();
        const stranger = yield* openTokenMember({ token: "fixture-stranger-token" });
        const workspace = yield* openWorkspace(owner);
        const { id: top } = yield* createTask(owner, { organizationId: workspace, name: "T" });
        const { id: leaf } = yield* createTask(owner, { organizationId: workspace, name: "L" });
        const { id: apart } = yield* createTask(owner, {
          organizationId: workspace,
          name: "A",
          repository: "acme/app",
        });
        const send = yield* blocking(
          new Map([
            ["Bearer owner", owner],
            ["Bearer stranger", stranger],
          ]),
        );
        const parent = (taskId: string, bearer: string, parentTaskId: string | null) =>
          send(taskId, bearer, { parentTaskId }, PLAN_WRITE.PARENT);

        const set = yield* parent(leaf, "Bearer owner", top);
        const loop = yield* parent(top, "Bearer owner", leaf);
        const differs = yield* parent(leaf, "Bearer owner", apart);
        const byStranger = yield* parent(leaf, "Bearer stranger", top);

        assert.equal(set.status, 200, JSON.stringify(set.body));
        assert.equal(set.body.plan.parentTaskId, top);
        assert.notEqual(set.body.txid, undefined);
        assert.deepEqual(loop, {
          status: 409,
          body: { error: HOSTED_API_ERROR.TASK_PARENT_CYCLE },
        });
        assert.deepEqual(differs, {
          status: 409,
          body: { error: HOSTED_API_ERROR.CHILD_REPOSITORY_LOCKED },
        });
        assert.deepEqual(byStranger, { status: 404, body: { error: HOSTED_API_ERROR.NOT_FOUND } });
        assert.deepEqual([yield* parentOf(owner, leaf), yield* parentOf(owner, top)], [top, null]);

        const cleared = yield* parent(leaf, "Bearer owner", null);

        assert.equal(cleared.body.plan.parentTaskId, undefined);
        assert.equal(yield* parentOf(owner, leaf), null);
      }),
  );

  it.effect(
    "a relation moved to another kind takes the old away and adds the new in one transaction, so one refused leaves both as they stood",
    () =>
      Effect.gen(function* () {
        const owner = yield* openTokenMember();
        const workspace = yield* openWorkspace(owner);
        const { id: schema } = yield* createTask(owner, { organizationId: workspace, name: "S" });
        const { id: panel } = yield* createTask(owner, { organizationId: workspace, name: "P" });
        const { id: apart } = yield* createTask(owner, {
          organizationId: workspace,
          name: "A",
          repository: "acme/app",
        });
        const send = yield* blocking(new Map([["Bearer owner", owner]]));
        const move = (change: TaskRelationChangeRequest) =>
          send(panel, "Bearer owner", change, PLAN_WRITE.RELATION);
        yield* send(panel, "Bearer owner", add(TASK_BLOCK_RELATION.BLOCKED_BY, schema));
        yield* send(panel, "Bearer owner", add(TASK_BLOCK_RELATION.BLOCKS, apart));

        const toParent = yield* move({
          taskId: schema,
          from: TASK_RELATION_KIND.BLOCKED_BY,
          to: TASK_RELATION_KIND.PARENT,
        });
        const refused = yield* move({
          taskId: apart,
          from: TASK_RELATION_KIND.BLOCKS,
          to: TASK_RELATION_KIND.SUB_TASK,
        });

        assert.equal(toParent.status, 200, JSON.stringify(toParent.body));
        assert.deepEqual(
          [
            toParent.body.plan.blockedBy,
            toParent.body.plan.blocks,
            toParent.body.plan.parentTaskId,
          ],
          [[], [apart], schema],
        );
        assert.notEqual(toParent.body.txid, undefined);
        assert.deepEqual(refused, {
          status: 409,
          body: { error: HOSTED_API_ERROR.CHILD_REPOSITORY_LOCKED },
        });
        assert.deepEqual(
          yield* readTaskBlocks(owner, panel),
          Option.some({ blockedBy: [], blocks: [apart] }),
        );
        assert.deepEqual(
          [yield* parentOf(owner, panel), yield* parentOf(owner, apart)],
          [schema, null],
        );
      }),
  );
});
