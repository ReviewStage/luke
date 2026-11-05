import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import { registerDevice } from "@repo/database/models/device-store";
import { readRunsOnPick } from "@repo/database/models/runs-on-pick";
import { createTask } from "@repo/database/models/task-store";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import {
  DEVICE_LAYOUT,
  fakeWorkspaceSeams,
  getTestDB,
  openWorkspace,
} from "@repo/database/testing";
import { HOSTED_API_ERROR } from "@repo/features";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { PROVIDER_KEY_PROVIDER } from "@repo/features/provider-key-wire";
import type { TaskRunsOnRequest } from "@repo/features/task-wire";
import { Clock, type Context, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { sessionSandboxesLayer } from "../agents/session-sandboxes.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { connectAgentApiKeys } from "../testing/agent-credentials.js";
import { fakeGitHub, GITHUB_APP_WITH_TOKENS, openTokenMember } from "../testing/github-app-fake.js";
import { keepAwakeDetached } from "../testing/session-sandboxes-fake.js";
import { tasksProcedures } from "./tasks-procedures.js";

/**
 * A task holds no place to run, each agent its own, so the place a released
 * desktop still names on a task's create or change goes through the hosted
 * oRPC router as the web route answers it, over a real dialect: a change is
 * taken and changes nothing, the task answering where its newest agent runs
 * for those builds, and a create keeps it as the member's last pick; an
 * account outside the workspace reaches no such task. Synthetic accounts
 * and devices throughout.
 */

const ORIGIN = "https://app.test";

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

/** A device of the account's, registered now by the name given, the account's Anthropic key saved, so it runs some model. */
const deviceOf = (userId: string, name: string) =>
  Effect.gen(function* () {
    const id = randomUUID();
    yield* registerDevice(userId, { id, name, ...DEVICE_LAYOUT });
    yield* connectAgentApiKeys(userId, { providers: [PROVIDER_KEY_PROVIDER.ANTHROPIC] });
    return id;
  });

it.layer(getTestDB())("where a task runs its agents", (it) => {
  it.effect(
    "a released desktop's change naming any place is taken and changes nothing, the task answering where its newest agent runs, and a task outside their workspace is not found",
    () =>
      Effect.gen(function* () {
        const owner = yield* openTokenMember();
        const stranger = yield* openTokenMember({ token: "fixture-stranger-token" });
        const workspace = yield* openWorkspace(owner);
        const studio = yield* deviceOf(owner, "Studio");
        const laptop = yield* deviceOf(owner, "Laptop");
        const task = yield* createTask(owner, { organizationId: workspace, name: "Relay" });
        yield* createAgent(owner, {
          taskId: task.id,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          planSnapshot: "# Relay\n",
          prompt: null,
          repository: null,
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
          machine: AGENT_MACHINE.DEVICE,
          deviceId: studio,
        });
        const empty = yield* createTask(owner, { organizationId: workspace, name: "Kept" });
        const send = yield* standing(
          new Map([
            ["Bearer owner", owner],
            ["Bearer stranger", stranger],
          ]),
        );
        const patch = (taskId: string, bearer: string, runsOn: TaskRunsOnRequest) =>
          send("PATCH", `/api/plans/${taskId}`, bearer, { runsOn });

        const toLaptop = yield* patch(task.id, "Bearer owner", {
          machine: AGENT_MACHINE.DEVICE,
          deviceId: laptop,
        });
        assert.equal(toLaptop.status, 200, JSON.stringify(toLaptop.body));
        assert.equal(toLaptop.body.plan.runsOn?.deviceId, studio);
        const toDevice = yield* patch(empty.id, "Bearer owner", {
          machine: AGENT_MACHINE.DEVICE,
          deviceId: studio,
        });
        assert.equal(toDevice.status, 200, JSON.stringify(toDevice.body));
        assert.equal(toDevice.body.plan.runsOn, undefined);

        // An account outside the workspace reaches no such task.
        const byStranger = yield* patch(task.id, "Bearer stranger", {
          machine: AGENT_MACHINE.VERCEL,
        });
        assert.deepEqual(byStranger, { status: 404, body: { error: HOSTED_API_ERROR.NOT_FOUND } });
      }),
  );

  it.effect(
    "a released desktop's task made to run somewhere keeps that place as its member's last pick",
    () =>
      Effect.gen(function* () {
        const owner = yield* openTokenMember();
        const workspace = yield* openWorkspace(owner);
        const studio = yield* deviceOf(owner, "Studio");
        const onStudio = { machine: AGENT_MACHINE.DEVICE, deviceId: studio } as const;
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
