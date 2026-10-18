import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { DEFAULT_PLAN_TEMPLATE } from "@luke/features/plan-document-template";
import type { TaskSummary } from "@luke/features/task-wire";
import { eq } from "drizzle-orm";
import { Clock, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { organization, user } from "../../schemas/auth.js";
import { issue } from "../../schemas/issue.js";
import { taskPin } from "../../schemas/task-pin.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import { createIssue } from "../issue-store.js";
import {
  createTask,
  deleteTask,
  listTasks,
  nameUntitledTask,
  readTask,
  updateTask,
} from "../task-store.js";

/**
 * A plan's pin is its reader's own: two members of one workspace read the
 * plan they share, and each reads only the pin they made, through the
 * store's public reads, over a real dialect. A pin made again keeps its first
 * instant, an archive leaves it standing, and it goes with its plan and its
 * account.
 *
 * Synthetic accounts, workspaces, and plans throughout.
 */

const SHARED_TASK = { name: "Teammate invitations" };

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** Dean's workspace with Charles a member of it, and a plan Dean started there. */
const openSharedTask = Effect.gen(function* () {
  const dean = yield* openAccount;
  const charles = yield* openAccount;
  const workspace = yield* openWorkspace(dean);
  yield* joinWorkspace(workspace, charles);
  const { id: taskId } = yield* createTask(dean, { ...SHARED_TASK, organizationId: workspace });
  return { dean, charles, taskId };
});

/** The plan's line in the account's list, archived ones among the rest, failing the test where it has none. */
const listedTask = (userId: string, taskId: string) =>
  Effect.map(
    listTasks(userId, { includeArchived: true }),
    (tasks): TaskSummary =>
      tasks.find(({ id }) => id === taskId) ?? assert.fail("the plan is not in the list"),
  );

/** The plan's pin as the account reads it, in the list and opened alike, which must agree. */
const pinReadBy = (userId: string, taskId: string) =>
  Effect.gen(function* () {
    const listed = (yield* listedTask(userId, taskId)).pinnedAt;
    const opened = yield* readTask(userId, taskId);
    assert.equal(Option.isSome(opened), true);
    assert.equal(Option.getOrUndefined(opened)?.task.pinnedAt, listed);
    return listed;
  });

const pinnedOnes = (taskId: string) =>
  Database.use((db) =>
    db.select({ userId: taskPin.userId }).from(taskPin).where(eq(taskPin.taskId, taskId)),
  );

it.layer(getTestDB())("a plan's pin", (it) => {
  it.effect("a member's pin of a shared plan reads pinned for them alone", () =>
    Effect.gen(function* () {
      const { dean, charles, taskId } = yield* openSharedTask;
      const pinnedAt = yield* Clock.currentTimeMillis;

      const answered = yield* updateTask(dean, taskId, { pinned: true });

      assert.equal(Option.getOrUndefined(answered)?.pinnedAt, pinnedAt);
      assert.equal(yield* pinReadBy(dean, taskId), pinnedAt);
      assert.equal(yield* pinReadBy(charles, taskId), undefined);
      const renamed = yield* updateTask(charles, taskId, { name: "Invitations" });
      assert.equal(Option.getOrUndefined(renamed)?.pinnedAt, undefined);
    }),
  );

  it.effect("unpinning takes away only the account's own pin", () =>
    Effect.gen(function* () {
      const { dean, charles, taskId } = yield* openSharedTask;
      yield* updateTask(dean, taskId, { pinned: true });
      yield* TestClock.adjust("1 minute");
      const charlesPinnedAt = yield* Clock.currentTimeMillis;
      yield* updateTask(charles, taskId, { pinned: true });

      const answered = yield* updateTask(dean, taskId, { pinned: false });

      assert.equal(Option.getOrUndefined(answered)?.pinnedAt, undefined);
      assert.equal(yield* pinReadBy(dean, taskId), undefined);
      assert.equal(yield* pinReadBy(charles, taskId), charlesPinnedAt);
    }),
  );

  it.effect(
    "a plan pinned again keeps its first instant, and an archive and its return leave the pin standing",
    () =>
      Effect.gen(function* () {
        const { dean, taskId } = yield* openSharedTask;
        const pinnedAt = yield* Clock.currentTimeMillis;
        yield* updateTask(dean, taskId, { pinned: true });
        yield* TestClock.adjust("1 minute");

        yield* updateTask(dean, taskId, { pinned: true });
        assert.equal(yield* pinReadBy(dean, taskId), pinnedAt);
        yield* updateTask(dean, taskId, { archived: true });
        assert.equal(yield* pinReadBy(dean, taskId), pinnedAt);
        yield* updateTask(dean, taskId, { archived: false });
        assert.equal(yield* pinReadBy(dean, taskId), pinnedAt);
      }),
  );

  it.effect(
    "a pin dragged to a position keeps its first instant, moves again, and is the dragging member's alone",
    () =>
      Effect.gen(function* () {
        const { dean, charles, taskId } = yield* openSharedTask;
        const pinnedAt = yield* Clock.currentTimeMillis;
        yield* updateTask(dean, taskId, { pinned: true });
        yield* updateTask(charles, taskId, { pinned: true });
        assert.equal((yield* listedTask(dean, taskId)).pinPosition, undefined);
        yield* TestClock.adjust("1 minute");

        const placed = yield* updateTask(dean, taskId, { pinned: true, pinPosition: "a1" });
        assert.equal(Option.getOrUndefined(placed)?.pinPosition, "a1");
        yield* updateTask(dean, taskId, { pinned: true, pinPosition: "a0V" });
        yield* updateTask(dean, taskId, { pinned: true });

        const listed = yield* listedTask(dean, taskId);
        assert.equal(listed.pinPosition, "a0V");
        assert.equal(listed.pinnedAt, pinnedAt);
        const opened = yield* readTask(dean, taskId);
        assert.equal(Option.getOrUndefined(opened)?.task.pinPosition, "a0V");
        assert.equal((yield* listedTask(charles, taskId)).pinPosition, undefined);
      }),
  );

  it.effect(
    "a plan dragged into place before it was pinned is pinned there, and unpinning lets the place go",
    () =>
      Effect.gen(function* () {
        const { dean, taskId } = yield* openSharedTask;
        const pinnedAt = yield* Clock.currentTimeMillis;

        yield* updateTask(dean, taskId, { pinned: true, pinPosition: "a3" });
        assert.equal(yield* pinReadBy(dean, taskId), pinnedAt);
        assert.equal((yield* listedTask(dean, taskId)).pinPosition, "a3");

        yield* updateTask(dean, taskId, { pinned: false });
        yield* updateTask(dean, taskId, { pinned: true });
        assert.equal((yield* listedTask(dean, taskId)).pinPosition, undefined);
      }),
  );

  it.effect("an account outside the workspace can neither pin the plan nor read a pin of it", () =>
    Effect.gen(function* () {
      const { dean, charles, taskId } = yield* openSharedTask;
      const outsider = yield* openAccount;
      yield* updateTask(dean, taskId, { pinned: true });

      assert.equal(Option.isNone(yield* updateTask(outsider, taskId, { pinned: true })), true);
      assert.equal(Option.isNone(yield* updateTask(outsider, taskId, { pinned: false })), true);
      assert.equal(Option.isNone(yield* readTask(outsider, taskId)), true);
      assert.deepEqual(yield* listTasks(outsider, { includeArchived: true }), []);
      assert.notEqual(yield* pinReadBy(dean, taskId), undefined);
      assert.equal(yield* pinReadBy(charles, taskId), undefined);
    }),
  );

  it.effect("a plan's pins go with the plan, and an account's with the account", () =>
    Effect.gen(function* () {
      const { dean, charles, taskId } = yield* openSharedTask;
      yield* updateTask(dean, taskId, { pinned: true });
      yield* updateTask(charles, taskId, { pinned: true });

      yield* Database.use((db) => db.delete(user).where(eq(user.id, charles)));
      assert.deepEqual(yield* pinnedOnes(taskId), [{ userId: dean }]);
      assert.equal(yield* deleteTask(dean, taskId), true);
      assert.deepEqual(yield* pinnedOnes(taskId), []);
    }),
  );
});

it.layer(getTestDB())("a plan's starting name", (it) => {
  it.effect("a plan started with no name, or a blank one, stands as Untitled", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const organizationId = yield* openWorkspace(owner);
      const unnamed = yield* createTask(owner, { organizationId });
      const blank = yield* createTask(owner, { organizationId, name: "   " });
      const named = yield* createTask(owner, { organizationId, name: "  Rate limits  " });

      assert.deepEqual(
        [unnamed.name, blank.name, named.name],
        ["Untitled", "Untitled", "Rate limits"],
      );
      assert.equal(
        Option.getOrUndefined(yield* readTask(owner, unnamed.id))?.task.name,
        "Untitled",
      );
    }),
  );
});

it.layer(getTestDB())("an untitled plan's name", (it) => {
  it.effect("names an untitled plan once, and never one named or renamed meanwhile", () =>
    Effect.gen(function* () {
      const { dean, charles, taskId: named } = yield* openSharedTask;
      const workspace = (yield* listedTask(dean, named)).workspaceId;
      const untitled = yield* createTask(dean, { organizationId: workspace });
      const renamed = yield* createTask(dean, { organizationId: workspace });
      yield* updateTask(charles, renamed.id, { name: "Rate limits" });

      assert.equal(yield* nameUntitledTask(charles, untitled.id, "Expire invitations"), true);
      assert.equal(yield* nameUntitledTask(dean, untitled.id, "Send reminders"), false);
      assert.equal(yield* nameUntitledTask(dean, named, "Send reminders"), false);
      assert.equal(yield* nameUntitledTask(dean, renamed.id, "Send reminders"), false);

      assert.equal((yield* listedTask(dean, untitled.id)).name, "Expire invitations");
      assert.equal((yield* listedTask(dean, named)).name, SHARED_TASK.name);
      assert.equal((yield* listedTask(dean, renamed.id)).name, "Rate limits");
    }),
  );

  it.effect("leaves an archived plan, and one of a workspace the account is not in, untitled", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const outsider = yield* openAccount;
      const organizationId = yield* openWorkspace(owner);
      const theirs = yield* createTask(owner, { organizationId });
      const archived = yield* createTask(owner, { organizationId });
      yield* updateTask(owner, archived.id, { archived: true });

      assert.equal(yield* nameUntitledTask(outsider, theirs.id, "Expire invitations"), false);
      assert.equal(yield* nameUntitledTask(owner, archived.id, "Expire invitations"), false);

      assert.equal((yield* listedTask(owner, theirs.id)).name, "Untitled");
      assert.equal((yield* listedTask(owner, archived.id)).name, "Untitled");
    }),
  );
});

it.layer(getTestDB())("a plan's starting text", (it) => {
  it.effect("a plan starts as the template, and one started without planning starts empty", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const organizationId = yield* openWorkspace(owner);
      const planned = yield* createTask(owner, { organizationId });
      const unplanned = yield* createTask(owner, { organizationId, planning: false });

      const opened = (taskId: string) =>
        Effect.map(readTask(owner, taskId), (read) => Option.getOrUndefined(read)?.task.document);
      assert.equal((yield* opened(planned.id))?.body, DEFAULT_PLAN_TEMPLATE);
      assert.deepEqual(yield* opened(unplanned.id), { body: "", assumptions: [] });
    }),
  );
});

it.layer(getTestDB())("a plan's brief", (it) => {
  it.effect(
    "is read back as written, and a plan started with none, or a blank one, reads none",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const organizationId = yield* openWorkspace(owner);
        const briefed = yield* createTask(owner, {
          organizationId,
          brief: "  Let any member invite a teammate, not only admins.\n",
        });
        const unbriefed = yield* createTask(owner, { organizationId });
        const blank = yield* createTask(owner, { organizationId, brief: "   " });
        const unplanned = yield* createTask(owner, {
          organizationId,
          planning: false,
          brief: "Fix the typo in the invite email.",
        });

        const briefOf = (taskId: string) =>
          Effect.map(readTask(owner, taskId), (read) => Option.getOrUndefined(read)?.brief);
        assert.equal(
          yield* briefOf(briefed.id),
          "Let any member invite a teammate, not only admins.",
        );
        assert.equal(yield* briefOf(unbriefed.id), undefined);
        assert.equal(yield* briefOf(blank.id), undefined);
        assert.equal(yield* briefOf(unplanned.id), "Fix the typo in the invite email.");
      }),
  );
});

/** An issue Dean files in the workspace, failing the test where it is not filed. */
const fileIssue = (userId: string, organizationId: string, title: string) =>
  Effect.map(
    createIssue(userId, { organizationId, title, description: "Steps to reproduce." }),
    (made) => Option.getOrElse(made, () => assert.fail("the issue was not filed")),
  );

it.layer(getTestDB())("a plan started from an issue", (it) => {
  it.effect("names its issue to every member of the workspace, and to no account outside it", () =>
    Effect.gen(function* () {
      const dean = yield* openAccount;
      const charles = yield* openAccount;
      const outsider = yield* openAccount;
      const organizationId = yield* openWorkspace(dean);
      yield* joinWorkspace(organizationId, charles);
      const filed = yield* fileIssue(dean, organizationId, "Invites expire too soon");
      const [workspace] = yield* Database.use((db) =>
        db.select().from(organization).where(eq(organization.id, organizationId)),
      );

      const started = yield* createTask(dean, { organizationId, issueId: filed.id });

      assert.equal(started.issueId, filed.id);
      assert.equal((yield* listedTask(charles, started.id)).issueId, filed.id);
      assert.deepEqual(Option.getOrUndefined(yield* readTask(charles, started.id))?.issue, {
        id: filed.id,
        number: filed.number,
        title: "Invites expire too soon",
        description: "Steps to reproduce.",
        workspaceName: workspace?.name,
        workspaceSlug: workspace?.slug,
      });
      const outside = yield* listTasks(outsider, { includeArchived: true });
      assert.equal(
        outside.some(({ id }) => id === started.id),
        false,
      );
      assert.equal(Option.isNone(yield* readTask(outsider, started.id)), true);
    }),
  );

  it.effect("lets its issue go once it moves to another workspace", () =>
    Effect.gen(function* () {
      const dean = yield* openAccount;
      const organizationId = yield* openWorkspace(dean);
      const elsewhere = yield* openWorkspace(dean);
      const filed = yield* fileIssue(dean, organizationId, "Invites expire too soon");
      const started = yield* createTask(dean, { organizationId, issueId: filed.id });

      const renamed = yield* updateTask(dean, started.id, { name: "Invites", organizationId });
      assert.equal(Option.getOrUndefined(renamed)?.issueId, filed.id);
      const moved = yield* updateTask(dean, started.id, { organizationId: elsewhere });

      assert.equal(Option.getOrUndefined(moved)?.issueId, undefined);
      assert.equal(Option.getOrUndefined(yield* readTask(dean, started.id))?.issue, undefined);
    }),
  );

  it.effect("lets its issue go once the issue is deleted, and stands", () =>
    Effect.gen(function* () {
      const dean = yield* openAccount;
      const organizationId = yield* openWorkspace(dean);
      const filed = yield* fileIssue(dean, organizationId, "Invites expire too soon");
      const started = yield* createTask(dean, { organizationId, issueId: filed.id });

      yield* Database.use((db) => db.delete(issue).where(eq(issue.id, filed.id)));

      const listed = yield* listedTask(dean, started.id);
      assert.equal(listed.issueId, undefined);
      assert.equal(Option.getOrUndefined(yield* readTask(dean, started.id))?.issue, undefined);
    }),
  );
});
