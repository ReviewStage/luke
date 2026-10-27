import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { writeAccountPreferences } from "@luke/database/models/account-store";
import { registerDevice } from "@luke/database/models/device-store";
import { readRunsOnPick } from "@luke/database/models/runs-on-pick";
import { createTask, readTask } from "@luke/database/models/task-store";
import {
  DEVICE_LAYOUT,
  fakeWorkspaceSeams,
  getTestDB,
  openWorkspace,
} from "@luke/database/testing";
import { HOSTED_API_ERROR } from "@luke/features";
import { CODING_AGENT_MACHINE } from "@luke/features/coding-agent-wire";
import type { TaskRunsOnRequest } from "@luke/features/task-wire";
import { EXPERIMENT } from "@luke/settings";
import { Clock, type Context, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { sessionSandboxesLayer } from "../agents/session-sandboxes.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { fakeGitHub, GITHUB_APP_WITH_TOKENS, openTokenMember } from "../testing/github-app-fake.js";
import { keepAwakeDetached } from "../testing/session-sandboxes-fake.js";
import { tasksProcedures } from "./tasks-procedures.js";

/**
 * Where a task runs its agents is set when the task is created and kept,
 * changed through the hosted oRPC router as the web route answers it, over
 * a real dialect: a change that names the place the task already holds is
 * taken as no change, and any other is refused by name and leaves the task
 * as it stood; an account outside the workspace reaches no such task.
 * Synthetic accounts and devices throughout.
 */

const ORIGIN = "https://luke.test";

/** The plans procedures over the test's store, each bearer answering for the account it maps to; GitHub is never asked. */
const standing = (bearers: ReadonlyMap<string, string>) =>
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
        eveOrigin: () => undefined,
        sessionSandboxes: sessionSandboxesLayer,
        keepAwake: keepAwakeDetached,
        workspaces: yield* fakeWorkspaceSeams,
      }),
    });
    // SAFETY: setting where a task runs yields the store and the clock alone, which is all a test provides of the web runtime's services.
    const webServices = services as Context.Context<WebServices>;
    return (method: string, path: string, bearer: string, body: object) =>
      Effect.promise(async () => {
        const response = await handle(
          new Request(new URL(path, ORIGIN), {
            method,
            headers: { authorization: bearer, "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
          webServices,
        );
        // SAFETY: the router answers JSON; the test compares it as the wire value it is.
        return { status: response.status, body: JSON.parse(await response.text()) };
      });
  });

/** A device of the account's, registered now by the name given, signed in to Claude Code, so it runs some model. */
const deviceOf = (userId: string, name: string) =>
  Effect.gen(function* () {
    const id = randomUUID();
    yield* registerDevice(userId, { id, name, ...DEVICE_LAYOUT, signedIn: { claudeCode: true } });
    return id;
  });

it.layer(getTestDB())("where a task runs its agents", (it) => {
  it.effect(
    "a change naming the place a task holds is no change, any other is refused by name leaving it as it stood, and a task outside their workspace is not found",
    () =>
      Effect.gen(function* () {
        const owner = yield* openTokenMember();
        const stranger = yield* openTokenMember({ token: "fixture-stranger-token" });
        const workspace = yield* openWorkspace(owner);
        yield* writeAccountPreferences(owner, { experiments: { [EXPERIMENT.LOCAL_AGENTS]: true } });
        const studio = yield* deviceOf(owner, "Studio");
        const laptop = yield* deviceOf(owner, "Laptop");
        const onStudio = { machine: CODING_AGENT_MACHINE.DEVICE, deviceId: studio } as const;
        const task = yield* createTask(owner, {
          organizationId: workspace,
          name: "Relay",
          runsOn: onStudio,
        });
        const inCloud = yield* createTask(owner, { organizationId: workspace, name: "Kept" });
        const send = yield* standing(
          new Map([
            ["Bearer owner", owner],
            ["Bearer stranger", stranger],
          ]),
        );
        const patch = (taskId: string, bearer: string, runsOn: TaskRunsOnRequest) =>
          send("PATCH", `/api/plans/${taskId}`, bearer, { runsOn });
        const runsOnNow = (taskId: string) =>
          Effect.map(
            readTask(owner, taskId),
            (read) => Option.getOrThrow(read).task.runsOn?.deviceId,
          );
        const locked = { status: 409, body: { error: HOSTED_API_ERROR.RUNS_ON_LOCKED } };

        // The place it holds, named again, is taken and changes nothing.
        const same = yield* patch(task.id, "Bearer owner", onStudio);
        assert.equal(same.status, 200);
        assert.equal(same.body.plan.runsOn.deviceId, studio);
        const stays = yield* patch(inCloud.id, "Bearer owner", {
          machine: CODING_AGENT_MACHINE.VERCEL,
        });
        assert.equal(stays.status, 200);
        assert.equal(stays.body.plan.runsOn, undefined);

        // Another device, or the cloud, is refused, even a device of the member's own.
        const another = yield* patch(task.id, "Bearer owner", {
          machine: CODING_AGENT_MACHINE.DEVICE,
          deviceId: laptop,
        });
        assert.deepEqual(another, locked);
        const toCloud = yield* patch(task.id, "Bearer owner", {
          machine: CODING_AGENT_MACHINE.VERCEL,
        });
        assert.deepEqual(toCloud, locked);
        const toDevice = yield* patch(inCloud.id, "Bearer owner", onStudio);
        assert.deepEqual(toDevice, locked);
        assert.equal(yield* runsOnNow(task.id), studio);
        assert.equal(yield* runsOnNow(inCloud.id), undefined);

        // An account outside the workspace reaches no such task.
        const byStranger = yield* patch(task.id, "Bearer stranger", {
          machine: CODING_AGENT_MACHINE.VERCEL,
        });
        assert.deepEqual(byStranger, { status: 404, body: { error: HOSTED_API_ERROR.NOT_FOUND } });
      }),
  );

  it.effect("a task made to run somewhere keeps that place as its member's last pick", () =>
    Effect.gen(function* () {
      const owner = yield* openTokenMember();
      const workspace = yield* openWorkspace(owner);
      yield* writeAccountPreferences(owner, { experiments: { [EXPERIMENT.LOCAL_AGENTS]: true } });
      const studio = yield* deviceOf(owner, "Studio");
      const onStudio = { machine: CODING_AGENT_MACHINE.DEVICE, deviceId: studio } as const;
      const send = yield* standing(new Map([["Bearer owner", owner]]));

      const made = yield* send("POST", "/api/plans", "Bearer owner", {
        name: "Relay",
        workspaceId: workspace,
        planning: false,
        runsOn: onStudio,
      });

      assert.equal(made.status, 201, JSON.stringify(made.body));
      assert.deepEqual(yield* readRunsOnPick(owner), Option.some(onStudio));
    }),
  );
});
