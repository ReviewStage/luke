import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { writeAccountPreferences } from "@luke/database/models/account-store";
import { registerDevice } from "@luke/database/models/device-store";
import { createTask, readTask } from "@luke/database/models/task-store";
import {
  DEVICE_LAYOUT,
  fakeWorkspaceSeams,
  getTestDB,
  joinWorkspace,
  openWorkspace,
} from "@luke/database/testing";
import { HOSTED_API_ERROR } from "@luke/features";
import { CODING_AGENT_MACHINE, LOCAL_AGENT_REFUSAL } from "@luke/features/coding-agent-wire";
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
 * Where a task runs its agents, set through the hosted oRPC router as the
 * web route answers it, over a real dialect: a member sets it to one of
 * their own devices there now and the task names it, its owner, and its
 * name; one naming another member's device, or theirs with Local agents
 * off, is refused by name and leaves the task as it stood; and an account
 * outside the workspace reaches no such task. Synthetic accounts and devices
 * throughout.
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
    return (taskId: string, bearer: string, runsOn: TaskRunsOnRequest) =>
      Effect.promise(async () => {
        const response = await handle(
          new Request(new URL(`/api/plans/${taskId}`, ORIGIN), {
            method: "PATCH",
            headers: { authorization: bearer, "content-type": "application/json" },
            body: JSON.stringify({ runsOn }),
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
    "a member sets it to their own device, and another member's device, theirs with Local agents off, or a task outside their workspace is refused, leaving the task as it stood",
    () =>
      Effect.gen(function* () {
        const owner = yield* openTokenMember();
        const teammate = yield* openTokenMember({ token: "fixture-teammate-token" });
        const stranger = yield* openTokenMember({ token: "fixture-stranger-token" });
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate);
        yield* writeAccountPreferences(owner, { experiments: { [EXPERIMENT.LOCAL_AGENTS]: true } });
        const studio = yield* deviceOf(owner, "Studio");
        const laptop = yield* deviceOf(teammate, "Laptop");
        const task = yield* createTask(owner, { organizationId: workspace, name: "Relay" });
        const patch = yield* standing(
          new Map([
            ["Bearer owner", owner],
            ["Bearer teammate", teammate],
            ["Bearer stranger", stranger],
          ]),
        );
        const runsOnNow = Effect.map(
          readTask(owner, task.id),
          (read) => Option.getOrThrow(read).task.runsOn?.deviceId,
        );
        const refusal = (reason: string) => ({
          status: 409,
          body: { error: HOSTED_API_ERROR.LOCAL_AGENT_REFUSED, localAgentRefusal: reason },
        });

        // Its owner sets it to their own device, which the task then names, with whose it is.
        const set = yield* patch(task.id, "Bearer owner", {
          machine: CODING_AGENT_MACHINE.DEVICE,
          deviceId: studio,
        });
        assert.equal(set.status, 200);
        assert.equal(set.body.plan.runsOn.deviceId, studio);
        assert.equal(set.body.plan.runsOn.device.name, "Studio");
        assert.equal(set.body.plan.runsOn.owner.userId, owner);

        // A teammate cannot point it at their own device while Local agents is off for them.
        const off = yield* patch(task.id, "Bearer teammate", {
          machine: CODING_AGENT_MACHINE.DEVICE,
          deviceId: laptop,
        });
        assert.deepEqual(off, refusal(LOCAL_AGENT_REFUSAL.OFF));

        // Nor, with it on, at the owner's device, which is no device of theirs.
        yield* writeAccountPreferences(teammate, {
          experiments: { [EXPERIMENT.LOCAL_AGENTS]: true },
        });
        const theirs = yield* patch(task.id, "Bearer teammate", {
          machine: CODING_AGENT_MACHINE.DEVICE,
          deviceId: studio,
        });
        assert.deepEqual(theirs, refusal(LOCAL_AGENT_REFUSAL.MAC_AWAY));
        assert.equal(yield* runsOnNow, studio);

        // An account outside the workspace reaches no such task.
        const byStranger = yield* patch(task.id, "Bearer stranger", {
          machine: CODING_AGENT_MACHINE.VERCEL,
        });
        assert.deepEqual(byStranger, { status: 404, body: { error: HOSTED_API_ERROR.NOT_FOUND } });
        assert.equal(yield* runsOnNow, studio);

        // A teammate moves it back to the cloud, which any member may.
        const cloud = yield* patch(task.id, "Bearer teammate", {
          machine: CODING_AGENT_MACHINE.VERCEL,
        });
        assert.equal(cloud.status, 200);
        assert.equal(cloud.body.plan.runsOn, undefined);
      }),
  );
});
