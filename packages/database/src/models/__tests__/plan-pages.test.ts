import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { GITHUB_ACCESS, type GitHubAccess } from "@luke/features/github-repositories-wire";
import { PAGE_OWNER, PAGE_SHOWER, type PageOwner, type PageShower } from "@luke/features/page-wire";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { organization, user } from "../../schemas/auth.js";
import { codingAgent } from "../../schemas/coding-agent.js";
import { planPageVersion } from "../../schemas/plan-page.js";
import { conversations } from "../../schemas/storage.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import { listPages, readPageById, readPageVersion, writePage } from "../plan-pages.js";
import { createTask, deleteTask } from "../task-store.js";

/**
 * A task's pages read by the page's id alone, over a real dialect: any
 * member of the task's workspace reads the newest version or one named,
 * beside the task it stands on and its newest version, and an account
 * outside the workspace, or a version the page never had, reads nothing.
 * Each version keeps who showed it, Luke or a coding agent by its id, which
 * a member reads on the plan's list and on the version, and a version shown
 * before that was kept reads as shown by no one named.
 *
 * A coding agent on no task shows its pages on itself, and they are read by
 * the agent's rule of who may read it rather than any task's: a member of
 * its workspace who sees the agent reads them, an account of another
 * workspace or one the agent's GitHub access hides it from reads nothing,
 * and a task's pages and an agent's never read as each other's.
 *
 * Synthetic accounts and pages throughout.
 */

const LUKE: PageShower = { kind: PAGE_SHOWER.LUKE };

const onTask = (taskId: string): PageOwner => ({ kind: PAGE_OWNER.TASK, taskId });

const onAgent = (agentId: string): PageOwner => ({ kind: PAGE_OWNER.AGENT, agentId });

const shownByAgent = (agentId: string): PageShower => ({ kind: PAGE_SHOWER.AGENT, agentId });

/** A coding agent of the workspace, on the task named or on none, reached as its GitHub access says. */
const openAgent = (
  userId: string,
  organizationId: string,
  taskId: string | null,
  githubAccess: GitHubAccess = GITHUB_ACCESS.APP,
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    const conversationId = randomUUID();
    yield* db
      .insert(conversations)
      .values({ id: conversationId, userId, kind: CONVERSATION_KIND.CODING_AGENT });
    yield* db.insert(codingAgent).values({
      id,
      organizationId,
      userId,
      taskId,
      conversationId,
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/api",
      repositories: ["acme/api"],
      githubAccess,
      idempotencyKey: randomUUID(),
    });
    return id;
  });

/** Each version's owner columns as the row holds them. */
const ownerColumnsOf = (pageId: string) =>
  Effect.flatMap(Database, (db) =>
    db
      .select({
        version: planPageVersion.version,
        taskId: planPageVersion.taskId,
        agentId: planPageVersion.agentId,
      })
      .from(planPageVersion)
      .where(eq(planPageVersion.pageId, pageId))
      .orderBy(planPageVersion.version),
  );

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

it.layer(getTestDB())("a page read by its id", (it) => {
  it.effect(
    "a member reads a teammate's page by its id, its newest version or one named, with its task and newest version, and an outsider or a version never written reads nothing",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const teammate = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate);
        yield* openWorkspace(outsider);
        const task = yield* createTask(owner, { organizationId: workspace, name: "Invitations" });
        const first = Option.getOrThrow(
          yield* writePage(
            owner,
            onTask(task.id),
            { title: "Invites", html: "<h1>One</h1>" },
            LUKE,
          ),
        );
        yield* writePage(
          owner,
          onTask(task.id),
          { pageId: first.id, title: "Invites by week", html: "<h1>Two</h1>" },
          LUKE,
        );

        const newest = Option.getOrThrow(yield* readPageById(teammate, first.id, undefined));
        const earlier = Option.getOrThrow(yield* readPageById(teammate, first.id, 1));

        assert.deepEqual(
          [
            newest.owner,
            newest.page.version,
            newest.page.title,
            newest.page.html,
            newest.newestVersion,
          ],
          [onTask(task.id), 2, "Invites by week", "<h1>Two</h1>", 2],
        );
        assert.deepEqual(
          [earlier.page.version, earlier.page.html, earlier.newestVersion],
          [1, "<h1>One</h1>", 2],
        );
        assert.ok(Option.isNone(yield* readPageById(outsider, first.id, undefined)));
        assert.ok(Option.isNone(yield* readPageById(teammate, first.id, 3)));
        assert.ok(Option.isNone(yield* readPageById(teammate, randomUUID(), undefined)));
      }),
  );

  it.effect(
    "each version keeps who showed it, which a member reads on the plan's list and on the version, an outsider reads nothing of, and one shown before it was kept names no one",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const teammate = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate);
        yield* openWorkspace(outsider);
        const task = yield* createTask(owner, { organizationId: workspace, name: "Invitations" });
        const agent = shownByAgent(yield* openAgent(owner, workspace, task.id));
        const shown = Option.getOrThrow(
          yield* writePage(
            owner,
            onTask(task.id),
            { title: "Invites", html: "<h1>One</h1>" },
            agent,
          ),
        );
        yield* writePage(
          owner,
          onTask(task.id),
          { pageId: shown.id, title: "Invites", html: "<h1>Two</h1>" },
          LUKE,
        );
        const older = Option.getOrThrow(
          yield* writePage(owner, onTask(task.id), { title: "Old", html: "<h1>Old</h1>" }, LUKE),
        );
        // A version shown before who showed it was kept, as the column's migration leaves it.
        const db = yield* Database;
        yield* db
          .update(planPageVersion)
          .set({ shownBy: null })
          .where(eq(planPageVersion.pageId, older.id));

        const listed = yield* listPages(teammate, onTask(task.id));
        const first = yield* readPageVersion(teammate, onTask(task.id), shown.id, 1);

        assert.deepEqual(
          // Pages written in the same millisecond list in no particular order, so they are read by title.
          listed
            .map((page) => [page.title, page.shownBy] as const)
            .toSorted(([one], [other]) => one.localeCompare(other)),
          [
            ["Invites", LUKE],
            ["Old", undefined],
          ],
        );
        assert.deepEqual(
          Option.map(first, (page) => page.shownBy),
          Option.some(agent),
        );
        assert.deepEqual(yield* listPages(outsider, onTask(task.id)), []);
        assert.ok(Option.isNone(yield* readPageVersion(outsider, onTask(task.id), shown.id, 1)));
      }),
  );

  it.effect(
    "an agent on no task shows pages on itself, which a teammate reads by its list, its versions, and its id, and an account of another workspace, one the agent is hidden from, or a task reads nothing of",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const teammate = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate);
        yield* openWorkspace(outsider);
        const agentId = yield* openAgent(owner, workspace, null);
        // An agent on the owner's own GitHub token, which the teammate's token never read the repository of.
        const hidden = yield* openAgent(owner, workspace, null, GITHUB_ACCESS.TOKEN);
        const task = yield* createTask(owner, { organizationId: workspace, name: "Invitations" });
        const shower = shownByAgent(agentId);
        const first = Option.getOrThrow(
          yield* writePage(
            owner,
            onAgent(agentId),
            { title: "Funnel", html: "<h1>One</h1>" },
            shower,
          ),
        );
        yield* writePage(
          teammate,
          onAgent(agentId),
          { pageId: first.id, title: "Funnel by week", html: "<h1>Two</h1>" },
          shower,
        );
        const secret = Option.getOrThrow(
          yield* writePage(
            owner,
            onAgent(hidden),
            { title: "Hidden", html: "<p>x</p>" },
            shownByAgent(hidden),
          ),
        );

        const listed = yield* listPages(teammate, onAgent(agentId));
        const byId = Option.getOrThrow(yield* readPageById(teammate, first.id, undefined));

        assert.deepEqual(
          listed.map(({ id, title, version, shownBy }) => ({ id, title, version, shownBy })),
          [{ id: first.id, title: "Funnel by week", version: 2, shownBy: shower }],
        );
        assert.equal(
          Option.getOrThrow(yield* readPageVersion(teammate, onAgent(agentId), first.id, 1)).html,
          "<h1>One</h1>",
        );
        assert.deepEqual(
          [byId.owner, byId.page.version, byId.newestVersion],
          [onAgent(agentId), 2, 2],
        );
        assert.deepEqual(yield* ownerColumnsOf(first.id), [
          { version: 1, taskId: null, agentId },
          { version: 2, taskId: null, agentId },
        ]);
        // Another workspace's member reads and writes nothing of the agent's pages.
        assert.deepEqual(yield* listPages(outsider, onAgent(agentId)), []);
        assert.ok(Option.isNone(yield* readPageById(outsider, first.id, undefined)));
        assert.ok(Option.isNone(yield* readPageVersion(outsider, onAgent(agentId), first.id, 1)));
        assert.ok(
          Option.isNone(
            yield* writePage(outsider, onAgent(agentId), { title: "Mine", html: "<p>x</p>" }, LUKE),
          ),
        );
        // A teammate the agent's GitHub access hides it from reads nothing of its pages; its owner does.
        assert.deepEqual(yield* listPages(teammate, onAgent(hidden)), []);
        assert.ok(Option.isNone(yield* readPageById(teammate, secret.id, undefined)));
        assert.equal((yield* listPages(owner, onAgent(hidden))).length, 1);
        // An agent's page is no task's, and a task's page no agent's own.
        assert.ok(Option.isNone(yield* readPageVersion(owner, onTask(task.id), first.id, 1)));
        assert.ok(
          Option.isNone(
            yield* writePage(
              owner,
              onTask(task.id),
              { pageId: first.id, title: "Taken", html: "<p>x</p>" },
              LUKE,
            ),
          ),
        );
      }),
  );

  it.effect(
    "an agent on a task shows its pages on the task and is named on each version, and the task's deletion takes them while an agent on no task keeps its own",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        const task = yield* createTask(owner, { organizationId: workspace, name: "Invitations" });
        const onIt = yield* openAgent(owner, workspace, task.id);
        const apart = yield* openAgent(owner, workspace, null);
        const shown = Option.getOrThrow(
          yield* writePage(
            owner,
            onTask(task.id),
            { title: "Plan", html: "<p>1</p>" },
            shownByAgent(onIt),
          ),
        );
        yield* writePage(
          owner,
          onTask(task.id),
          { pageId: shown.id, title: "Plan", html: "<p>2</p>" },
          LUKE,
        );
        const own = Option.getOrThrow(
          yield* writePage(
            owner,
            onAgent(apart),
            { title: "Own", html: "<p>x</p>" },
            shownByAgent(apart),
          ),
        );

        assert.deepEqual(yield* ownerColumnsOf(shown.id), [
          { version: 1, taskId: task.id, agentId: onIt },
          { version: 2, taskId: task.id, agentId: null },
        ]);
        // The agent's own list holds the pages it showed on no task, never the task's.
        assert.deepEqual(yield* listPages(owner, onAgent(onIt)), []);

        yield* deleteTask(owner, task.id);

        assert.deepEqual(yield* ownerColumnsOf(shown.id), []);
        assert.deepEqual(
          (yield* listPages(owner, onAgent(apart))).map(({ id }) => id),
          [own.id],
        );
      }),
  );

  it.effect(
    "an agent's deletion clears its name from a task's versions and keeps them whole, and takes its own pages on no task with it",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        const task = yield* createTask(owner, { organizationId: workspace, name: "Invitations" });
        const onIt = yield* openAgent(owner, workspace, task.id);
        const apart = yield* openAgent(owner, workspace, null);
        const shown = Option.getOrThrow(
          yield* writePage(
            owner,
            onTask(task.id),
            { title: "Plan", html: "<p>1</p>" },
            shownByAgent(onIt),
          ),
        );
        const own = Option.getOrThrow(
          yield* writePage(
            owner,
            onAgent(apart),
            { title: "Own", html: "<p>x</p>" },
            shownByAgent(apart),
          ),
        );
        const db = yield* Database;

        yield* db.delete(codingAgent).where(eq(codingAgent.id, onIt));
        yield* db.delete(codingAgent).where(eq(codingAgent.id, apart));

        assert.deepEqual(yield* ownerColumnsOf(shown.id), [
          { version: 1, taskId: task.id, agentId: null },
        ]);
        assert.equal(
          Option.getOrThrow(yield* readPageVersion(owner, onTask(task.id), shown.id, 1)).html,
          "<p>1</p>",
        );
        assert.deepEqual(yield* ownerColumnsOf(own.id), []);
      }),
  );

  it.effect(
    "an account's deletion and a workspace's, cascading into an agent on no task, succeed and take its pages",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const leaving = yield* openAccount;
        const staying = yield* openAccount;
        const closing = yield* openWorkspace(staying);
        const ownWorkspace = yield* openWorkspace(leaving);
        const byAccount = yield* openAgent(leaving, ownWorkspace, null);
        const byWorkspace = yield* openAgent(staying, closing, null);
        const accountPage = Option.getOrThrow(
          yield* writePage(
            leaving,
            onAgent(byAccount),
            { title: "Mine", html: "<p>x</p>" },
            shownByAgent(byAccount),
          ),
        );
        const workspacePage = Option.getOrThrow(
          yield* writePage(
            staying,
            onAgent(byWorkspace),
            { title: "Ours", html: "<p>y</p>" },
            shownByAgent(byWorkspace),
          ),
        );

        yield* db.delete(user).where(eq(user.id, leaving));
        yield* db.delete(organization).where(eq(organization.id, closing));

        assert.deepEqual(yield* ownerColumnsOf(accountPage.id), []);
        assert.deepEqual(yield* ownerColumnsOf(workspacePage.id), []);
      }),
  );
});
