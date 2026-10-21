import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { CODING_AGENT_ARCHIVER, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { INBOX_RESPONSE, INBOX_STATUS } from "@luke/features/inbox-wire";
import { DEFAULT_PLAN_TEMPLATE } from "@luke/features/plan-document-template";
import { TASK_PRIORITY, TASK_STATUS, type TaskSummary } from "@luke/features/task-wire";
import { eq } from "drizzle-orm";
import { Clock, Effect, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { codingAgent, type StoredPullRequest } from "../../schemas/coding-agent.js";
import { inboxItem } from "../../schemas/inbox.js";
import { conversations } from "../../schemas/storage.js";
import { task } from "../../schemas/task.js";
import { taskPin } from "../../schemas/task-pin.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB, joinWorkspace, leaveWorkspace, openWorkspace } from "../../testing/index.js";
import { VOICE_CLOSE_REASON } from "../../voice-vocabulary.js";
import {
  archiveCodingAgent,
  readCodingAgent,
  recordCodingAgentPublished,
} from "../coding-agent-store.js";
import {
  assignUnassignedTask,
  beginTaskWork,
  createTask,
  createTaskOnce,
  deleteTask,
  finishTaskWork,
  listTasks,
  nameUntitledTask,
  readTask,
  readTaskHeader,
  readTaskWorkspace,
  TaskArchived,
  TaskAssigneeNotMember,
  updateTask,
} from "../task-store.js";
import { voiceSessionRecord } from "../voice-session-record.js";

/**
 * A plan's pin is its reader's own: two members of one workspace read the
 * plan they share, and each reads only the pin they made, through the
 * store's public reads, over a real dialect. A pin made again keeps its first
 * instant, an archive leaves it standing, and it goes with its plan and its
 * account. And a plan's archive, which archives its coding agents with it
 * and whose unarchive brings back those it archived and no other.
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
  return { dean, charles, taskId, workspace };
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

it.layer(getTestDB())("a task made under an id its maker chose", (it) => {
  it.effect(
    "stands under that id with the text given, and a second make under it, even at once, makes nothing",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const organizationId = yield* openWorkspace(owner);
        const id = randomUUID();
        const make = (name: string) =>
          createTaskOnce(owner, { id, organizationId, name, text: "## Goal\n\nBulk invites." });
        const [first, second] = yield* Effect.all([make("Bulk invites"), make("Again")], {
          concurrency: "unbounded",
        });

        assert.equal([first, second].filter(Option.isSome).length, 1, "one make took the id");
        const stored = Option.getOrThrow(yield* readTask(owner, id));
        assert.equal(stored.text, "## Goal\n\nBulk invites.");
        assert.ok(Option.isNone(yield* make("Later")), "a make under a taken id makes nothing");
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

it.layer(getTestDB())("a plan's workspace", (it) => {
  it.effect(
    "names the workspace the plan stands in to every member, follows a move, and names none to an account outside it",
    () =>
      Effect.gen(function* () {
        const { dean, charles, taskId } = yield* openSharedTask;
        const stranger = yield* openAccount;
        const workspace = Option.getOrUndefined(yield* readTask(dean, taskId))?.task.workspaceId;
        assert.ok(workspace);

        assert.deepEqual(yield* readTaskWorkspace(dean, taskId), Option.some(workspace));
        assert.deepEqual(yield* readTaskWorkspace(charles, taskId), Option.some(workspace));
        assert.deepEqual(yield* readTaskWorkspace(stranger, taskId), Option.none());

        const elsewhere = yield* openWorkspace(dean);
        yield* updateTask(dean, taskId, { organizationId: elsewhere });
        assert.deepEqual(yield* readTaskWorkspace(dean, taskId), Option.some(elsewhere));
        assert.deepEqual(yield* readTaskWorkspace(charles, taskId), Option.none());
      }),
  );

  it.effect(
    "a plan's header names where it stands and whose it is to every member, follows its archive, and names nothing to an account outside it or for a plan that is none",
    () =>
      Effect.gen(function* () {
        const { dean, charles, taskId } = yield* openSharedTask;
        const stranger = yield* openAccount;
        const workspace = Option.getOrThrow(yield* readTaskWorkspace(dean, taskId));
        const started = {
          workspaceId: workspace,
          ownerId: dean,
          name: SHARED_TASK.name,
          repository: null,
          archived: false,
        };

        assert.deepEqual(yield* readTaskHeader(dean, taskId), Option.some(started));
        assert.deepEqual(yield* readTaskHeader(charles, taskId), Option.some(started));
        assert.deepEqual(yield* readTaskHeader(stranger, taskId), Option.none());
        assert.deepEqual(yield* readTaskHeader(dean, randomUUID()), Option.none());

        yield* updateTask(dean, taskId, { archived: true });
        const header = Option.getOrThrow(yield* readTaskHeader(charles, taskId));
        assert.deepEqual(header, { ...started, archived: true });
        // The header agrees with the whole read on everything it answers.
        const whole = Option.getOrThrow(yield* readTask(charles, taskId));
        assert.deepEqual(header, {
          workspaceId: whole.task.workspaceId,
          ownerId: whole.ownerId,
          name: whole.task.name,
          repository: whole.task.repository,
          archived: whole.task.archivedAt !== undefined,
        });
      }),
  );
});

/** One of the task's coding agents, started by `userId`, standing unarchived. */
const openTaskAgent = (userId: string, organizationId: string, taskId: string) =>
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
      idempotencyKey: randomUUID(),
    });
    return id;
  });

/** The agent's archive as the store reads it: when, and who it was by. */
const archiveOf = (userId: string, agentId: string) =>
  Effect.map(readCodingAgent(userId, agentId), (read) => {
    const agent = Option.getOrThrow(read);
    return { archivedAt: agent.archivedAt?.getTime(), archivedBy: agent.archivedBy };
  });

it.layer(getTestDB())("a plan's archive and its coding agents", (it) => {
  it.effect(
    "a plan's archive archives its standing agents with it as the member who archived it, again for one brought back on its own since, and its unarchive brings back only those",
    () =>
      Effect.gen(function* () {
        const { dean, charles, taskId } = yield* openSharedTask;
        const workspace = (yield* listedTask(dean, taskId)).workspaceId;
        const working = yield* openTaskAgent(dean, workspace, taskId);
        const putAway = yield* openTaskAgent(dean, workspace, taskId);
        yield* archiveCodingAgent(charles, putAway, true);
        const before = yield* archiveOf(dean, putAway);

        const archived = Option.getOrThrow(yield* updateTask(charles, taskId, { archived: true }));
        assert.deepEqual(yield* archiveOf(dean, working), {
          archivedAt: archived.archivedAt,
          archivedBy: { by: CODING_AGENT_ARCHIVER.MEMBER, userId: charles, withTask: true },
        });
        assert.deepEqual(yield* archiveOf(dean, putAway), before);

        // An agent brought back on its own is taken in again by the archive asked again, under its stamp.
        yield* archiveCodingAgent(dean, working, false);
        yield* updateTask(charles, taskId, { archived: true });
        assert.equal((yield* archiveOf(dean, working)).archivedAt, archived.archivedAt);

        yield* updateTask(dean, taskId, { archived: false });
        assert.deepEqual(yield* archiveOf(dean, working), {
          archivedAt: undefined,
          archivedBy: null,
        });
        assert.deepEqual(yield* archiveOf(dean, putAway), before);
      }),
  );

  it.effect(
    "an archive whose guard finds an agent at work under its conversation's lock is refused, and nothing is archived",
    () =>
      Effect.gen(function* () {
        const { dean, taskId } = yield* openSharedTask;
        const workspace = (yield* listedTask(dean, taskId)).workspaceId;
        const agentId = yield* openTaskAgent(dean, workspace, taskId);
        const read: string[] = [];

        const refused = yield* Effect.result(
          updateTask(dean, taskId, { archived: true }, undefined, (agent) => {
            read.push(agent.id);
            return Effect.succeed(false);
          }),
        );

        assert.equal(Result.isFailure(refused) && refused.failure._tag, "TaskAgentUnstopped");
        assert.deepEqual(read, [agentId]);
        assert.equal((yield* listedTask(dean, taskId)).archivedAt, undefined);
        assert.equal((yield* archiveOf(dean, agentId)).archivedAt, undefined);
      }),
  );
});

/** A call the account opened on the task, held by a connection; answers its live session id. */
const openCall = (userId: string, taskId: string) =>
  Effect.gen(function* () {
    const sessionId = `live-${randomUUID()}`;
    yield* voiceSessionRecord().register({
      userId,
      sessionId,
      taskId,
      attachId: randomUUID(),
      model: "gpt-realtime",
    });
    return sessionId;
  });

/** Which of the calls named the orphan sweep's next run reads, past any grace. */
const sweptOf = (sessionIds: readonly string[]) =>
  Effect.map(
    voiceSessionRecord().detached({ detachedBefore: Date.UTC(1970, 0, 1, 0, 0, 1), limit: 1_000 }),
    (swept) => sessionIds.filter((id) => swept.some((call) => call.sessionId === id)),
  );

it.layer(getTestDB())("a plan's archive and its live calls", (it) => {
  it.effect(
    "an archive hands every open call on the plan to the sweep, the member's and a teammate's, held or not, and no other",
    () =>
      Effect.gen(function* () {
        const { dean, charles, taskId } = yield* openSharedTask;
        const { id: otherTask } = yield* createTask(dean, {
          name: "Billing export",
          organizationId: yield* openWorkspace(dean),
        });
        const deansCall = yield* openCall(dean, taskId);
        const charlesCall = yield* openCall(charles, taskId);
        const ended = yield* openCall(dean, taskId);
        yield* voiceSessionRecord().close({
          sessionId: ended,
          seconds: 3,
          reason: VOICE_CLOSE_REASON.CLOSE_REQUESTED,
        });
        const elsewhere = yield* openCall(dean, otherTask);
        const calls = [deansCall, charlesCall, ended, elsewhere];
        assert.deepEqual(yield* sweptOf(calls), []);

        yield* updateTask(charles, taskId, { archived: true });

        assert.deepEqual(yield* sweptOf(calls), [deansCall, charlesCall]);
      }),
  );

  it.effect(
    "a call opened, or re-attached, on a plan the archive already landed on is handed to the sweep as well",
    () =>
      Effect.gen(function* () {
        const { dean, charles, taskId } = yield* openSharedTask;
        const held = yield* openCall(dean, taskId);
        yield* updateTask(dean, taskId, { archived: true });

        // A re-attach and a creation that read the plan before its archive land after it.
        yield* voiceSessionRecord().attached({ sessionId: held, attachId: randomUUID() });
        const late = yield* openCall(charles, taskId);

        assert.deepEqual(yield* sweptOf([held, late]), [held, late]);
      }),
  );
});

/** The task's number, status, and priority as the account opens it, failing the test where it reaches none. */
const standingOf = (userId: string, taskId: string) =>
  Effect.map(readTask(userId, taskId), (read) => {
    const { number, status, priority } = Option.getOrElse(read, () =>
      assert.fail("the task is not read"),
    ).task;
    return { number, status, priority };
  });

it.layer(getTestDB())("a task's number", (it) => {
  it.effect("counts a workspace's tasks from one, apart from every other workspace's", () =>
    Effect.gen(function* () {
      const dean = yield* openAccount;
      const acme = yield* openWorkspace(dean);
      const initech = yield* openWorkspace(dean);

      const first = yield* createTask(dean, { organizationId: acme });
      const second = yield* createTask(dean, { organizationId: acme });
      const elsewhere = yield* createTask(dean, { organizationId: initech });
      const third = yield* createTaskOnce(dean, {
        organizationId: acme,
        id: randomUUID(),
        text: "",
      });

      assert.deepEqual(
        [first.number, second.number, Option.getOrUndefined(third)?.number],
        [1, 2, 3],
      );
      assert.equal(elsewhere.number, 1);
      assert.equal((yield* listedTask(dean, second.id)).number, 2);
    }),
  );

  it.effect("never hands out again the number of a task deleted or moved away", () =>
    Effect.gen(function* () {
      const dean = yield* openAccount;
      const acme = yield* openWorkspace(dean);
      const initech = yield* openWorkspace(dean);
      yield* createTask(dean, { organizationId: initech });
      yield* createTask(dean, { organizationId: acme });
      const deleted = yield* createTask(dean, { organizationId: acme });
      const moving = yield* createTask(dean, { organizationId: acme });

      yield* deleteTask(dean, deleted.id);
      const moved = yield* updateTask(dean, moving.id, { organizationId: initech });
      const next = yield* createTask(dean, { organizationId: acme });

      assert.equal(Option.getOrUndefined(moved)?.number, 2);
      assert.equal(next.number, 4);
    }),
  );
});

it.layer(getTestDB())("a task's status and priority", (it) => {
  it.effect("start to do and unweighed, or as the start names them", () =>
    Effect.gen(function* () {
      const dean = yield* openAccount;
      const organizationId = yield* openWorkspace(dean);

      const plain = yield* createTask(dean, { organizationId });
      const filed = yield* createTask(dean, {
        organizationId,
        status: TASK_STATUS.BACKLOG,
        priority: TASK_PRIORITY.HIGH,
      });

      assert.deepEqual([plain.status, plain.priority], [TASK_STATUS.TODO, TASK_PRIORITY.NONE]);
      assert.deepEqual([filed.status, filed.priority], [TASK_STATUS.BACKLOG, TASK_PRIORITY.HIGH]);
    }),
  );

  it.effect("change for every member, refused while archived, and not at all for an outsider", () =>
    Effect.gen(function* () {
      const { dean, charles, taskId } = yield* openSharedTask;
      const outsider = yield* openAccount;

      const changed = yield* updateTask(charles, taskId, {
        status: TASK_STATUS.DONE,
        priority: TASK_PRIORITY.URGENT,
      });
      assert.deepEqual(
        [Option.getOrUndefined(changed)?.status, Option.getOrUndefined(changed)?.priority],
        [TASK_STATUS.DONE, TASK_PRIORITY.URGENT],
      );
      assert.equal(
        Option.isNone(yield* updateTask(outsider, taskId, { status: TASK_STATUS.CANCELED })),
        true,
      );

      yield* updateTask(dean, taskId, { archived: true });
      const refused = yield* Effect.result(
        updateTask(dean, taskId, { priority: TASK_PRIORITY.LOW }),
      );
      assert.ok(Result.isFailure(refused) && refused.failure instanceof TaskArchived);
      assert.deepEqual(yield* standingOf(dean, taskId), {
        number: 1,
        status: TASK_STATUS.DONE,
        priority: TASK_PRIORITY.URGENT,
      });
    }),
  );
});

/** Who the task is assigned to, by id, as the account reads it in the list and opened alike, which must agree. */
const assigneeReadBy = (userId: string, taskId: string) =>
  Effect.gen(function* () {
    const listed = (yield* listedTask(userId, taskId)).assignee?.userId;
    const opened = yield* readTask(userId, taskId);
    assert.equal(Option.getOrUndefined(opened)?.task.assignee?.userId, listed);
    return listed;
  });

it.layer(getTestDB())("a task's assignee", (it) => {
  it.effect("starts with no one, or the member the start names, named as their account is", () =>
    Effect.gen(function* () {
      const { dean, charles, workspace: organizationId } = yield* openSharedTask;

      const plain = yield* createTask(dean, { organizationId });
      const assigned = yield* createTask(dean, { organizationId, assigneeId: charles });
      const once = yield* createTaskOnce(dean, {
        organizationId,
        id: randomUUID(),
        text: "",
        assigneeId: charles,
      });

      assert.equal(plain.assignee, undefined);
      assert.deepEqual(assigned.assignee, { userId: charles, name: "Test User" });
      assert.equal(Option.getOrUndefined(once)?.assignee?.userId, charles);
      assert.equal(yield* assigneeReadBy(charles, assigned.id), charles);
    }),
  );

  it.effect("refuses a start that names someone who is no member of the workspace", () =>
    Effect.gen(function* () {
      const dean = yield* openAccount;
      const outsider = yield* openAccount;
      const organizationId = yield* openWorkspace(dean);

      const refused = yield* Effect.result(
        createTask(dean, { organizationId, name: "Refused", assigneeId: outsider }),
      );
      const refusedOnce = yield* Effect.result(
        createTaskOnce(dean, { organizationId, id: randomUUID(), text: "", assigneeId: outsider }),
      );

      assert.ok(Result.isFailure(refused) && refused.failure instanceof TaskAssigneeNotMember);
      assert.ok(
        Result.isFailure(refusedOnce) && refusedOnce.failure instanceof TaskAssigneeNotMember,
      );
      assert.deepEqual(yield* listTasks(dean), []);
    }),
  );

  it.effect("changes for every member, clears with null, and refuses an outsider as assignee", () =>
    Effect.gen(function* () {
      const { dean, charles, taskId } = yield* openSharedTask;
      const outsider = yield* openAccount;

      yield* updateTask(charles, taskId, { assigneeId: dean });
      assert.equal(yield* assigneeReadBy(charles, taskId), dean);

      const refused = yield* Effect.result(updateTask(dean, taskId, { assigneeId: outsider }));
      assert.ok(Result.isFailure(refused) && refused.failure instanceof TaskAssigneeNotMember);
      assert.equal(yield* assigneeReadBy(dean, taskId), dean);
      assert.equal(
        Option.isNone(yield* updateTask(outsider, taskId, { assigneeId: outsider })),
        true,
      );

      yield* updateTask(dean, taskId, { assigneeId: null });
      assert.equal(yield* assigneeReadBy(dean, taskId), undefined);
    }),
  );

  it.effect("is refused while the task is archived, unless the same change brings it back", () =>
    Effect.gen(function* () {
      const { dean, charles, taskId } = yield* openSharedTask;
      yield* updateTask(dean, taskId, { archived: true });

      const refused = yield* Effect.result(updateTask(dean, taskId, { assigneeId: charles }));
      yield* updateTask(dean, taskId, { archived: false, assigneeId: charles });

      assert.ok(Result.isFailure(refused) && refused.failure instanceof TaskArchived);
      assert.equal(yield* assigneeReadBy(dean, taskId), charles);
    }),
  );

  it.effect("goes unassigned when the task moves where its assignee is no member", () =>
    Effect.gen(function* () {
      const { dean, charles, taskId } = yield* openSharedTask;
      const initech = yield* openWorkspace(dean);
      const shared = yield* openWorkspace(dean);
      yield* joinWorkspace(shared, charles);
      const staying = yield* createTask(dean, { organizationId: initech, assigneeId: dean });
      yield* updateTask(dean, taskId, { assigneeId: charles });

      yield* updateTask(dean, staying.id, { organizationId: shared });
      yield* updateTask(dean, taskId, { organizationId: initech });

      assert.equal(yield* assigneeReadBy(dean, staying.id), dean);
      assert.equal(yield* assigneeReadBy(dean, taskId), undefined);
      const refused = yield* Effect.result(
        updateTask(dean, staying.id, { organizationId: initech, assigneeId: charles }),
      );
      assert.ok(Result.isFailure(refused) && refused.failure instanceof TaskAssigneeNotMember);
    }),
  );

  it.effect("lets a former member's tasks of that workspace go, and no other workspace's", () =>
    Effect.gen(function* () {
      const { dean, charles, taskId, workspace } = yield* openSharedTask;
      const elsewhere = yield* openWorkspace(dean);
      yield* joinWorkspace(elsewhere, charles);
      const other = yield* createTask(dean, { organizationId: elsewhere, assigneeId: charles });
      yield* updateTask(dean, taskId, { assigneeId: charles });

      // The member's row is deleted as the plugin deletes it, whichever write takes them out.
      yield* leaveWorkspace(workspace, charles);

      assert.equal(yield* assigneeReadBy(dean, taskId), undefined);
      assert.equal(yield* assigneeReadBy(dean, other.id), charles);
    }),
  );

  it.effect("goes unassigned, and the task stands, when the assignee's account is deleted", () =>
    Effect.gen(function* () {
      const { dean, charles, taskId } = yield* openSharedTask;
      yield* updateTask(dean, taskId, { assigneeId: charles });

      yield* Database.use((db) => db.delete(user).where(eq(user.id, charles)));

      assert.equal(yield* assigneeReadBy(dean, taskId), undefined);
    }),
  );

  it.effect("is the starter of an agent on a task no one is assigned to, and only then", () =>
    Effect.gen(function* () {
      const { dean, charles, taskId, workspace } = yield* openSharedTask;
      const outsider = yield* openAccount;
      const taken = yield* createTask(dean, { organizationId: workspace, assigneeId: dean });

      assert.equal(yield* assignUnassignedTask(outsider, taskId), false);
      assert.equal(yield* assignUnassignedTask(charles, taskId), true);
      assert.equal(yield* assignUnassignedTask(dean, taskId), false);
      assert.equal(yield* assignUnassignedTask(charles, taken.id), false);
      assert.equal(yield* assigneeReadBy(dean, taskId), charles);
      assert.equal(yield* assigneeReadBy(dean, taken.id), dean);
    }),
  );
});

it.layer(getTestDB())("a task's work beginning", (it) => {
  it.effect("moves a task in the backlog or to do into progress, once", () =>
    Effect.gen(function* () {
      const dean = yield* openAccount;
      const organizationId = yield* openWorkspace(dean);
      const filed = yield* createTask(dean, { organizationId, status: TASK_STATUS.BACKLOG });
      const todo = yield* createTask(dean, { organizationId });

      assert.equal(yield* beginTaskWork(dean, filed.id), true);
      assert.equal(yield* beginTaskWork(dean, todo.id), true);
      assert.equal(yield* beginTaskWork(dean, todo.id), false);
      assert.equal((yield* standingOf(dean, filed.id)).status, TASK_STATUS.IN_PROGRESS);
      assert.equal((yield* standingOf(dean, todo.id)).status, TASK_STATUS.IN_PROGRESS);
    }),
  );

  it.effect(
    "reopens a settled task, done or canceled, and moves none of a workspace the account is not in",
    () =>
      Effect.gen(function* () {
        const dean = yield* openAccount;
        const outsider = yield* openAccount;
        const organizationId = yield* openWorkspace(dean);
        const done = yield* createTask(dean, { organizationId, status: TASK_STATUS.DONE });
        const canceled = yield* createTask(dean, { organizationId, status: TASK_STATUS.CANCELED });
        const todo = yield* createTask(dean, { organizationId });

        assert.equal(yield* beginTaskWork(dean, done.id), true);
        assert.equal(yield* beginTaskWork(dean, canceled.id), true);
        assert.equal(yield* beginTaskWork(outsider, todo.id), false);
        assert.equal((yield* standingOf(dean, done.id)).status, TASK_STATUS.IN_PROGRESS);
        assert.equal((yield* standingOf(dean, canceled.id)).status, TASK_STATUS.IN_PROGRESS);
        assert.equal((yield* standingOf(dean, todo.id)).status, TASK_STATUS.TODO);
      }),
  );
});

/** A pull request as an agent's row keeps it, standing where `state` says. */
const pullRequestIn = (state: StoredPullRequest["state"]): StoredPullRequest => ({
  number: 42,
  title: "Teammate invitations",
  url: "https://github.com/acme/api/pull/42",
  state,
  checks: "passing",
  additions: 10,
  deletions: 2,
  changedFiles: 1,
});

/** An inbox item of the task's agent, open and asking, or open as a notice where `asking` is false. */
const openInboxItem = (
  userId: string,
  organizationId: string,
  taskId: string,
  agentId: string,
  asking: boolean,
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    const now = new Date(yield* Clock.currentTimeMillis);
    yield* db.insert(inboxItem).values({
      id,
      userId,
      taskId,
      organizationId,
      agentId,
      key: randomUUID(),
      revision: 1,
      version: 5,
      title: "Which base?",
      blocks: [],
      response: asking ? { type: INBOX_RESPONSE.APPROVAL } : { type: INBOX_RESPONSE.NONE },
      needsReply: asking,
      status: INBOX_STATUS.OPEN,
      postedAt: now,
      updatedAt: now,
    });
    return id;
  });

/** A guard reading every agent idle. */
const everyoneIdle = () => Effect.succeed(true);

it.layer(getTestDB())("a task's work finishing", (it) => {
  it.effect(
    "moves a task to done once an agent's pull request merged, none is open, no question waits, and every standing agent reads idle",
    () =>
      Effect.gen(function* () {
        const { dean, charles, taskId, workspace } = yield* openSharedTask;
        const merged = yield* openTaskAgent(dean, workspace, taskId);
        const reader = yield* openTaskAgent(charles, workspace, taskId);
        yield* beginTaskWork(dean, taskId);

        // No merged pull request yet: the reader's row keeps none, the other's is still open.
        yield* recordCodingAgentPublished(dean, merged, pullRequestIn(PULL_REQUEST_STATE.OPEN));
        assert.equal(yield* finishTaskWork(dean, taskId, everyoneIdle), false);
        assert.equal((yield* standingOf(dean, taskId)).status, TASK_STATUS.IN_PROGRESS);

        // Merged, but the guard reads one standing agent at work, and sees only the standing ones.
        yield* recordCodingAgentPublished(dean, merged, pullRequestIn(PULL_REQUEST_STATE.MERGED));
        const seen: string[] = [];
        const readerBusy = (agent: { readonly id: string }) =>
          Effect.sync(() => {
            seen.push(agent.id);
            return agent.id !== reader;
          });
        assert.equal(yield* finishTaskWork(dean, taskId, readerBusy), false);
        assert.deepEqual(seen.toSorted(), [merged, reader].toSorted());
        assert.equal((yield* standingOf(dean, taskId)).status, TASK_STATUS.IN_PROGRESS);

        // Everyone idle: done, and done once.
        assert.equal(yield* finishTaskWork(charles, taskId, everyoneIdle), true);
        assert.equal((yield* standingOf(dean, taskId)).status, TASK_STATUS.DONE);
        assert.equal(yield* finishTaskWork(dean, taskId, everyoneIdle), false);
      }),
  );

  it.effect(
    "stays while a standing agent's pull request is open or a draft, an archived agent's counting for nothing either way, and while a question waits, a notice never blocking",
    () =>
      Effect.gen(function* () {
        const { dean, taskId, workspace } = yield* openSharedTask;
        const merged = yield* openTaskAgent(dean, workspace, taskId);
        const drafting = yield* openTaskAgent(dean, workspace, taskId);
        yield* recordCodingAgentPublished(dean, merged, pullRequestIn(PULL_REQUEST_STATE.MERGED));
        yield* recordCodingAgentPublished(dean, drafting, pullRequestIn(PULL_REQUEST_STATE.DRAFT));

        assert.equal(yield* finishTaskWork(dean, taskId, everyoneIdle), false);
        yield* recordCodingAgentPublished(dean, drafting, pullRequestIn(PULL_REQUEST_STATE.OPEN));
        assert.equal(yield* finishTaskWork(dean, taskId, everyoneIdle), false);

        // Archived, the draft's agent is left out, and so would the merged one be.
        yield* archiveCodingAgent(dean, drafting, true);
        yield* archiveCodingAgent(dean, merged, true);
        assert.equal(yield* finishTaskWork(dean, taskId, everyoneIdle), false);
        yield* archiveCodingAgent(dean, merged, false);

        // A question open for the developer holds the task; a notice does not.
        const question = yield* openInboxItem(dean, workspace, taskId, merged, true);
        yield* openInboxItem(dean, workspace, taskId, merged, false);
        assert.equal(yield* finishTaskWork(dean, taskId, everyoneIdle), false);
        assert.equal((yield* standingOf(dean, taskId)).status, TASK_STATUS.TODO);
        yield* Database.use((db) =>
          db
            .update(inboxItem)
            .set({ status: INBOX_STATUS.ANSWERED })
            .where(eq(inboxItem.id, question)),
        );
        assert.equal(yield* finishTaskWork(dean, taskId, everyoneIdle), true);
        assert.equal((yield* standingOf(dean, taskId)).status, TASK_STATUS.DONE);
      }),
  );

  it.effect(
    "leaves a settled task, and one of a workspace the account is not in, as they stand",
    () =>
      Effect.gen(function* () {
        const { dean, taskId, workspace } = yield* openSharedTask;
        const outsider = yield* openAccount;
        const merged = yield* openTaskAgent(dean, workspace, taskId);
        yield* recordCodingAgentPublished(dean, merged, pullRequestIn(PULL_REQUEST_STATE.MERGED));

        assert.equal(yield* finishTaskWork(outsider, taskId, everyoneIdle), false);
        yield* updateTask(dean, taskId, { status: TASK_STATUS.CANCELED });
        assert.equal(yield* finishTaskWork(dean, taskId, everyoneIdle), false);
        assert.equal((yield* standingOf(dean, taskId)).status, TASK_STATUS.CANCELED);
      }),
  );
});

it.layer(getTestDB())("a task's GitHub access", (it) => {
  it.effect(
    "a task keeps how its repository was reached as it was named, and a repository named again without one, or cleared, is the App's",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const owner = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        const accessOf = (taskId: string) =>
          Effect.map(
            db.select({ access: task.githubAccess }).from(task).where(eq(task.id, taskId)),
            ([row]) => row?.access,
          );
        const { id: taskId } = yield* createTask(owner, {
          organizationId: workspace,
          repository: "octo-member/side",
          githubAccess: GITHUB_ACCESS.TOKEN,
        });
        const named = yield* accessOf(taskId);
        yield* updateTask(owner, taskId, { repository: "acme/relay" });
        const renamed = yield* accessOf(taskId);

        assert.equal(named, GITHUB_ACCESS.TOKEN);
        assert.equal(renamed, GITHUB_ACCESS.APP);
      }),
  );
});
