import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { LINEAR_BOUNDS } from "@luke/features/linear-wire";
import { TASK_ISSUE_PROVIDER, TASK_ISSUE_RELATION } from "@luke/features/task-issue-wire";
import { TASK_BOUNDS } from "@luke/features/task-wire";
import { Effect, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, joinWorkspace, linearIssueLink, openWorkspace } from "../../testing/index.js";
import {
  linkTaskIssue,
  listTaskIssues,
  type NewTaskIssueLink,
  refreshTaskIssue,
  relateTaskIssue,
  type TaskIssueLink,
  unlinkTaskIssue,
} from "../task-issue-store.js";
import { createTask, readTask, updateTask } from "../task-store.js";

/**
 * A task's links are its workspace's: every member reads and changes them,
 * whoever made them, and an account outside the workspace reads none and
 * changes none, through the store's public reads and writes over a real
 * dialect. A task links an issue once and at most `TASK_BOUNDS.MAX_ISSUES`
 * issues, and several tasks may link one issue.
 *
 * Synthetic accounts, workspaces, tasks, and issues throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** Dean's workspace with Charles a member of it, a task Dean started there, and Priya in a workspace of her own. */
const openSharedTask = Effect.gen(function* () {
  const dean = yield* openAccount;
  const charles = yield* openAccount;
  const priya = yield* openAccount;
  const workspace = yield* openWorkspace(dean);
  yield* joinWorkspace(workspace, charles);
  yield* openWorkspace(priya);
  const { id: taskId } = yield* createTask(dean, { name: "Invites", organizationId: workspace });
  return { dean, charles, priya, workspace, taskId };
});

/** Linear's ENG-n, as the picker would link it. */
const linear = (n: number) =>
  linearIssueLink({
    identifier: `ENG-${n}`,
    title: `Issue ${n}`,
    url: `https://linear.app/acme/issue/ENG-${n}`,
    description: `What ENG-${n} asks.`,
  });

/** acme/relay#n, as GitHub would be linked. */
const github = (n: number): NewTaskIssueLink => ({
  provider: TASK_ISSUE_PROVIDER.GITHUB,
  externalId: `I_kwDO${n}`,
  repository: "acme/relay",
  number: n,
  key: `acme/relay#${n}`,
  url: `https://github.com/acme/relay/issues/${n}`,
  title: `Issue #${n}`,
  description: "",
});

/** A link the test expects made, answering it. */
const linked = (userId: string, taskId: string, link: NewTaskIssueLink) =>
  Effect.map(
    linkTaskIssue(userId, taskId, link),
    (made): TaskIssueLink => Option.getOrElse(made, () => assert.fail("the link was refused")),
  );

const keysOf = (links: readonly TaskIssueLink[]) => links.map((link) => link.key);

it.layer(getTestDB())("a task's issue links", (it) => {
  it.effect(
    "a member links an issue for the whole workspace, read oldest first, and an account outside it reads, links, relates, and unlinks nothing",
    () =>
      Effect.gen(function* () {
        const { dean, charles, priya, taskId } = yield* openSharedTask;

        const first = yield* linked(dean, taskId, linear(7));
        yield* TestClock.adjust("1 minute");
        yield* linked(charles, taskId, github(45));

        const read = yield* listTaskIssues(charles, taskId);
        assert.deepEqual(keysOf(read), ["ENG-7", "acme/relay#45"]);
        assert.deepEqual(
          read.map(({ provider, repository, number, relation, linkedBy }) => ({
            provider,
            repository,
            number,
            relation,
            linkedBy,
          })),
          [
            {
              provider: TASK_ISSUE_PROVIDER.LINEAR,
              repository: null,
              number: null,
              relation: TASK_ISSUE_RELATION.CLOSES,
              linkedBy: dean,
            },
            {
              provider: TASK_ISSUE_PROVIDER.GITHUB,
              repository: "acme/relay",
              number: 45,
              relation: TASK_ISSUE_RELATION.CLOSES,
              linkedBy: charles,
            },
          ],
        );
        assert.equal(read[0]?.description, "What ENG-7 asks.");

        assert.deepEqual(yield* listTaskIssues(priya, taskId), []);
        assert.ok(Option.isNone(yield* linkTaskIssue(priya, taskId, linear(8))));
        assert.ok(
          Option.isNone(
            yield* relateTaskIssue(priya, taskId, first.id, TASK_ISSUE_RELATION.PART_OF),
          ),
        );
        assert.equal(yield* unlinkTaskIssue(priya, taskId, first.id), false);
        assert.deepEqual(keysOf(yield* listTaskIssues(dean, taskId)), ["ENG-7", "acme/relay#45"]);
        assert.equal(
          (yield* listTaskIssues(dean, taskId))[0]?.relation,
          TASK_ISSUE_RELATION.CLOSES,
        );
      }),
  );

  it.effect(
    "a member sets which keyword a link asks for and unlinks it, and a link of another task is none of this one's",
    () =>
      Effect.gen(function* () {
        const { dean, charles, workspace, taskId } = yield* openSharedTask;
        const { id: otherTask } = yield* createTask(dean, {
          name: "Billing",
          organizationId: workspace,
        });
        const link = yield* linked(dean, taskId, linear(7));

        const related = yield* relateTaskIssue(
          charles,
          taskId,
          link.id,
          TASK_ISSUE_RELATION.PART_OF,
        );
        assert.equal(Option.getOrUndefined(related)?.relation, TASK_ISSUE_RELATION.PART_OF);
        assert.ok(
          Option.isNone(
            yield* relateTaskIssue(dean, otherTask, link.id, TASK_ISSUE_RELATION.CLOSES),
          ),
        );
        assert.equal(yield* unlinkTaskIssue(dean, otherTask, link.id), false);

        assert.equal(yield* unlinkTaskIssue(charles, taskId, link.id), true);
        assert.deepEqual(yield* listTaskIssues(dean, taskId), []);
        assert.equal(yield* unlinkTaskIssue(charles, taskId, link.id), false);
      }),
  );

  it.effect(
    "a task links an issue once and several tasks may link it, and a link past the bound is refused with nothing written",
    () =>
      Effect.gen(function* () {
        const { dean, workspace, taskId } = yield* openSharedTask;
        const { id: otherTask } = yield* createTask(dean, {
          name: "Billing",
          organizationId: workspace,
        });
        const issue = linear(7);
        yield* linked(dean, taskId, issue);

        const twice = yield* Effect.result(linkTaskIssue(dean, taskId, issue));
        assert.ok(Result.isFailure(twice) && twice.failure._tag === "TaskIssueLinked");
        yield* linked(dean, otherTask, issue);

        for (let n = 1; n < TASK_BOUNDS.MAX_ISSUES; n += 1) yield* linked(dean, taskId, github(n));
        const past = yield* Effect.result(linkTaskIssue(dean, taskId, linear(99)));
        assert.ok(Result.isFailure(past) && past.failure._tag === "TaskIssuesFull");
        assert.equal((yield* listTaskIssues(dean, taskId)).length, TASK_BOUNDS.MAX_ISSUES);
        assert.equal((yield* listTaskIssues(dean, otherTask)).length, 1);
      }),
  );

  it.effect(
    "a description is kept to the bound, and a GitHub issue without its repository and number is refused",
    () =>
      Effect.gen(function* () {
        const { dean, taskId } = yield* openSharedTask;
        const long = "x".repeat(LINEAR_BOUNDS.MAX_DESCRIPTION_CHARS + 10);

        const kept = yield* linked(dean, taskId, { ...linear(7), description: long });
        assert.equal(kept.description.length, LINEAR_BOUNDS.MAX_DESCRIPTION_CHARS);

        const { repository: _repository, number: _number, ...unnumbered } = github(45);
        const refused = yield* Effect.result(linkTaskIssue(dean, taskId, unnumbered));
        assert.ok(Result.isFailure(refused));
        assert.deepEqual(keysOf(yield* listTaskIssues(dean, taskId)), ["ENG-7"]);
      }),
  );

  it.effect(
    "a task started with its issues reads them linked by any member, in the order it was handed them though they were linked in one instant",
    () =>
      Effect.gen(function* () {
        const { dean, charles, workspace } = yield* openSharedTask;
        const issue = linear(7);
        const started = yield* createTask(dean, {
          name: "Expire invites",
          organizationId: workspace,
          issueLinks: [issue, github(45), linear(3), github(2)],
        });

        const read = Option.getOrElse(yield* readTask(charles, started.id), () =>
          assert.fail("the task was not read"),
        );
        assert.deepEqual(keysOf(read.issueLinks), [
          "ENG-7",
          "acme/relay#45",
          "ENG-3",
          "acme/relay#2",
        ]);
        assert.deepEqual(
          read.issueLinks.slice(0, 1).map(({ externalId, linkedBy }) => ({ externalId, linkedBy })),
          [{ externalId: issue.externalId, linkedBy: dean }],
        );
        yield* linked(charles, started.id, linear(1));
        assert.equal(keysOf(yield* listTaskIssues(dean, started.id)).at(-1), "ENG-1");
      }),
  );

  it.effect(
    "an archived task takes no link, relation, or unlink, and a read's refresh of what a chip draws lands on it all the same",
    () =>
      Effect.gen(function* () {
        const { dean, charles, priya, taskId } = yield* openSharedTask;
        const link = yield* linked(dean, taskId, linear(7));
        yield* updateTask(dean, taskId, { archived: true });

        const refusedLink = yield* Effect.result(linkTaskIssue(charles, taskId, linear(8)));
        assert.ok(Result.isFailure(refusedLink) && refusedLink.failure._tag === "TaskArchived");
        const refusedRelation = yield* Effect.result(
          relateTaskIssue(charles, taskId, link.id, TASK_ISSUE_RELATION.PART_OF),
        );
        assert.ok(
          Result.isFailure(refusedRelation) && refusedRelation.failure._tag === "TaskArchived",
        );
        const refusedUnlink = yield* Effect.result(unlinkTaskIssue(charles, taskId, link.id));
        assert.ok(Result.isFailure(refusedUnlink) && refusedUnlink.failure._tag === "TaskArchived");

        const refreshed = yield* refreshTaskIssue(charles, taskId, link.id, {
          key: "ENG-70",
          title: "Renamed in Linear",
        });
        assert.deepEqual(
          Option.map(refreshed, ({ key, title, description, relation }) => ({
            key,
            title,
            description,
            relation,
          })),
          Option.some({
            key: "ENG-70",
            title: "Renamed in Linear",
            description: "What ENG-7 asks.",
            relation: TASK_ISSUE_RELATION.CLOSES,
          }),
        );
        assert.ok(
          Option.isNone(
            yield* refreshTaskIssue(priya, taskId, link.id, { key: "X-1", title: "x" }),
          ),
        );
        assert.deepEqual(keysOf(yield* listTaskIssues(dean, taskId)), ["ENG-70"]);

        yield* updateTask(dean, taskId, { archived: false });
        assert.equal(yield* unlinkTaskIssue(charles, taskId, link.id), true);
      }),
  );
});
