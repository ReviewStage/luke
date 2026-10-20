import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createTask, readTask } from "@luke/database/models/task-store";
import {
  fakeWorkspaceSeams,
  getTestDB,
  joinWorkspace,
  openWorkspace,
} from "@luke/database/testing";
import { HOSTED_API_ERROR } from "@luke/features";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { Clock, type Context, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import {
  fakeGitHub,
  GITHUB_APP_WITH_TOKENS,
  memberRepositoryJson,
  openTokenMember,
  type SentToGitHub,
} from "../testing/github-app-fake.js";
import { tasksProcedures } from "./tasks-procedures.js";

/**
 * A plan's repository named on a member's own GitHub token, through the
 * hosted oRPC router as the web route answers it, over a real dialect and a
 * GitHub that answers from the test's script: the plan's owner names one
 * their token reaches where no installation does, and a teammate's own
 * token never puts another member's plan on it, since a plan on a token is
 * seen by its owner whatever the repository. Synthetic accounts, plans,
 * and tokens throughout.
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
        workspaces: yield* fakeWorkspaceSeams,
      }),
    });
    // SAFETY: a repository change yields the store, the clock, and GitHub alone, which is all a test provides of the web runtime's services.
    const webServices = services as Context.Context<WebServices>;
    return (taskId: string, bearer: string, body: object) =>
      Effect.promise(async () => {
        const response = await handle(
          new Request(new URL(`/api/plans/${taskId}`, ORIGIN), {
            method: "PATCH",
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
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate);
        const task = yield* createTask(owner, { organizationId: workspace, name: "Side" });
        const patch = yield* standing(
          new Map([
            ["Bearer owner", owner],
            ["Bearer teammate", teammate],
          ]),
        );
        const accessOf = Effect.map(readTask(owner, task.id), (read) => {
          const { githubAccess, task: summary } = Option.getOrThrow(read);
          return { githubAccess, repository: summary.repository };
        });

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
});
