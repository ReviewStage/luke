import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { registerDevice } from "@luke/database/models/device-store";
import { createTask, listTasks, readTask } from "@luke/database/models/task-store";
import {
  DEVICE_LAYOUT,
  fakeWorkspaceSeams,
  getTestDB,
  joinWorkspace,
  openWorkspace,
} from "@luke/database/testing";
import { HOSTED_API_ERROR } from "@luke/features";
import { AGENT_MACHINE } from "@luke/features/agent-wire";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
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
 * A plan's repository named on a member's own GitHub token, through the
 * hosted oRPC router as the web route answers it, over a real dialect and a
 * GitHub that answers from the test's script: the plan's owner names one
 * their token reaches where no installation does, and a teammate's own
 * token never puts another member's plan on it, since a plan on a token is
 * seen by its owner whatever the repository; an account outside the
 * workspace reaches no such plan. A child plan works where its parent
 * does, so it takes the parent's repository and machine, and its parent
 * must be one its maker reaches. Synthetic accounts, plans, devices, and
 * tokens throughout.
 */

const ORIGIN = "https://luke.test";
const SIDE = { owner: "octo-member", name: "side" } as const;

/** GitHub's `GET /repos/{owner}/{repo}` on any member's token: the repository, pushable; nothing else is reached. */
function answer(sent: SentToGitHub): Response {
  return new URL(sent.url).pathname === `/repos/${SIDE.owner}/${SIDE.name}`
    ? Response.json(memberRepositoryJson(SIDE, true))
    : Response.json({ message: "Not Found" }, { status: 404 });
}

/** The plans procedures over the test's store and GitHub, each bearer answering for the account it maps to. */
const standing = (bearers: ReadonlyMap<string, string>) =>
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
    // SAFETY: a repository change or a start yields the store, the clock, and GitHub alone, which is all a test provides of the web runtime's services.
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

it.layer(getTestDB())("a plan's repository on a member's own GitHub token", (it) => {
  it.effect(
    "the plan's owner names a repository only their token reaches, and a teammate's token is refused for it, leaving the plan as it stood",
    () =>
      Effect.gen(function* () {
        const owner = yield* openTokenMember();
        const teammate = yield* openTokenMember({ token: "fixture-teammate-token" });
        const stranger = yield* openTokenMember({ token: "fixture-stranger-token" });
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate);
        const task = yield* createTask(owner, { organizationId: workspace, name: "Side" });
        const send = yield* standing(
          new Map([
            ["Bearer owner", owner],
            ["Bearer teammate", teammate],
            ["Bearer stranger", stranger],
          ]),
        );
        const patch = (taskId: string, bearer: string, body: object) =>
          send("PATCH", `/api/plans/${taskId}`, bearer, body);
        const accessOf = Effect.map(readTask(owner, task.id), (read) => {
          const { githubAccess, task: summary } = Option.getOrThrow(read);
          return { githubAccess, repository: summary.repository };
        });

        // An account outside the workspace reaches no such plan, on its own token or any other.
        const byStranger = yield* patch(task.id, "Bearer stranger", {
          repository: "octo-member/side",
        });
        assert.deepEqual(byStranger, { status: 404, body: { error: HOSTED_API_ERROR.NOT_FOUND } });
        assert.ok(Option.isNone(yield* readTask(stranger, task.id)));

        const byTeammate = yield* patch(task.id, "Bearer teammate", {
          repository: "octo-member/side",
        });
        assert.equal(byTeammate.body.error, HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE);
        assert.deepEqual(yield* accessOf, { githubAccess: GITHUB_ACCESS.APP, repository: null });

        const byOwner = yield* patch(task.id, "Bearer owner", { repository: "octo-member/side" });
        assert.equal(byOwner.status, 200, JSON.stringify(byOwner.body));
        assert.deepEqual(yield* accessOf, {
          githubAccess: GITHUB_ACCESS.TOKEN,
          repository: "octo-member/side",
        });
      }).pipe(Effect.provide(GITHUB_APP_WITH_TOKENS)),
  );

  it.effect(
    "a child plan takes its parent's repository and machine, and one naming another repository is refused with nothing made",
    () =>
      Effect.gen(function* () {
        const owner = yield* openTokenMember();
        const workspace = yield* openWorkspace(owner);
        const studio = randomUUID();
        yield* registerDevice(owner, { id: studio, name: "Studio", ...DEVICE_LAYOUT });
        const parent = yield* createTask(owner, {
          organizationId: workspace,
          name: "Side",
          repository: "octo-member/side",
          githubAccess: GITHUB_ACCESS.TOKEN,
          runsOn: { machine: AGENT_MACHINE.DEVICE, deviceId: studio },
        });
        const send = yield* standing(new Map([["Bearer owner", owner]]));
        const start = (body: object) =>
          send("POST", "/api/plans", "Bearer owner", { workspaceId: workspace, ...body });

        const made = yield* start({ name: "Child", parentTaskId: parent.id });
        assert.equal(made.status, 201, JSON.stringify(made.body));
        const child = Option.getOrThrow(yield* readTask(owner, made.body.plan.id));
        assert.deepEqual(
          {
            parentTaskId: child.task.parentTaskId,
            repository: child.task.repository,
            githubAccess: child.githubAccess,
            runsOn: child.runsOn,
          },
          {
            parentTaskId: parent.id,
            repository: "octo-member/side",
            githubAccess: GITHUB_ACCESS.TOKEN,
            runsOn: { machine: AGENT_MACHINE.DEVICE, deviceId: studio },
          },
        );

        const elsewhere = yield* start({
          name: "Elsewhere",
          parentTaskId: parent.id,
          repository: "octo-member/other",
        });
        assert.deepEqual(elsewhere, {
          status: 409,
          body: { error: HOSTED_API_ERROR.CHILD_REPOSITORY_LOCKED },
        });
        assert.equal((yield* listTasks(owner)).length, 2);
      }).pipe(Effect.provide(GITHUB_APP_WITH_TOKENS)),
  );

  it.effect("a child plan's repository cannot be changed to another", () =>
    Effect.gen(function* () {
      const owner = yield* openTokenMember();
      const workspace = yield* openWorkspace(owner);
      const parent = yield* createTask(owner, {
        organizationId: workspace,
        name: "Other",
        repository: "octo-member/other",
      });
      const child = yield* createTask(owner, {
        organizationId: workspace,
        name: "Child",
        repository: "octo-member/other",
        parentTaskId: parent.id,
      });
      const send = yield* standing(new Map([["Bearer owner", owner]]));

      const moved = yield* send("PATCH", `/api/plans/${child.id}`, "Bearer owner", {
        repository: "octo-member/side",
      });

      assert.deepEqual(moved, {
        status: 409,
        body: { error: HOSTED_API_ERROR.CHILD_REPOSITORY_LOCKED },
      });
      const read = Option.getOrThrow(yield* readTask(owner, child.id));
      assert.equal(read.task.repository, "octo-member/other");
    }).pipe(Effect.provide(GITHUB_APP_WITH_TOKENS)),
  );

  it.effect("a member cannot make a child of a plan they do not reach, and nothing is made", () =>
    Effect.gen(function* () {
      const owner = yield* openTokenMember();
      const teammate = yield* openTokenMember({ token: "fixture-teammate-token" });
      const stranger = yield* openTokenMember({ token: "fixture-stranger-token" });
      const workspace = yield* openWorkspace(owner);
      yield* joinWorkspace(workspace, teammate);
      // A plan on its owner's own token, which a teammate whose token never read its repository does not see.
      const parent = yield* createTask(owner, {
        organizationId: workspace,
        name: "Side",
        repository: "octo-member/side",
        githubAccess: GITHUB_ACCESS.TOKEN,
      });
      const send = yield* standing(
        new Map([
          ["Bearer teammate", teammate],
          ["Bearer stranger", stranger],
        ]),
      );
      const notFound = { status: 404, body: { error: HOSTED_API_ERROR.NOT_FOUND } };

      const byTeammate = yield* send("POST", "/api/plans", "Bearer teammate", {
        name: "Child",
        workspaceId: workspace,
        parentTaskId: parent.id,
      });
      const byStranger = yield* send("POST", "/api/plans", "Bearer stranger", {
        name: "Child",
        parentTaskId: parent.id,
      });

      assert.deepEqual([byTeammate, byStranger], [notFound, notFound]);
      assert.deepEqual(
        (yield* listTasks(owner)).map((each) => each.id),
        [parent.id],
      );
      assert.deepEqual(yield* listTasks(stranger), []);
    }).pipe(Effect.provide(GITHUB_APP_WITH_TOKENS)),
  );
});
