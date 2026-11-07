import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import type {
  GitHubRepositoryIssueAnswer,
  GitHubRepositoryPullRequestAnswer,
} from "@repo/features";
import { BROWSER_TABS_PLACE } from "@repo/features/agent-browser-tab-wire";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { AGENT_MACHINE, AGENT_STATUS, PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_REFUSAL,
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
  type DescriptionCommentThread,
} from "@repo/features/description-comment-wire";
import { ISSUE_STATE } from "@repo/features/github-repositories-wire";
import { WRITE_UNTAKEN } from "@repo/features/keyed-write";
import { LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import { PAGE_OWNER, PAGE_SHOWER } from "@repo/features/page-wire";
import { PICTURE_TYPE } from "@repo/features/picture-wire";
import { TASK_PAGES_READ } from "@repo/features/task-pages-live";
import { TASK_SECTION_WRITE, type TaskSection } from "@repo/features/task-section-wire";
import {
  DESCRIPTION_ACTOR,
  TASK_BLOCK_CHANGE,
  TASK_BLOCK_RELATION,
  TASK_PRIORITY,
  TASK_RELATION_KIND,
  TASK_SKILL_SOURCE,
  TASK_STATUS,
  type TaskFileAnswer,
  type TaskSkillsAnswer,
  type TaskTreeAnswer,
} from "@repo/features/task-wire";
import {
  COMMENT_SUBJECT,
  HOST_LIVE,
  PICTURE_KEEP_FAILURE,
  TASK_CALL_FAILURE,
  TASKS_READ,
  type TasksView,
  type TasksWriteSectionParams,
} from "@repo/features/tasks-view";
import { GATEWAY_EVENT, GATEWAY_METHOD } from "@repo/gateway";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { type EntityPool, entityPool } from "@repo/sync";
import { isRecord, TURN_STATUS, type WireValue } from "@repo/wire";
import { Deferred, Duration, Effect, Exit, Fiber, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";
import type { AppDescriptionComments } from "./app-state.js";
import type { TasksClient } from "./compose-tasks.js";
import { KEPT_READ, openEntityStore } from "./entity-store.js";
import { FIXTURE_IDS, FIXTURE_PAGE } from "./fixture-stage.js";
import { memoryFileSystem } from "./testing/memory-file-system.js";
import { polledLive } from "./testing/polled-live.js";
import { agentListRow } from "./testing/task-list-rows.js";
import {
  ACME,
  ADA,
  answered,
  BILLING,
  type CommentPart,
  EDITED_AT,
  type FakeService,
  fakeService,
  followSettled,
  INVITES,
  INVITES_TEXT,
  listAnswers,
  MARKED_AT,
  NOT_FOUND_LIVE,
  nextPoll,
  PERSONAL,
  type RecordPart,
  rowOfTask,
  SECTION_ID,
  subject,
  task,
  taskRow,
  workspacesLiveRows,
} from "./testing/tasks-subject.js";
import { testCipher } from "./testing/test-cipher.js";

it.effect(
  "a run that sends nothing reads its fixture's page, each version it stages, and no other page",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const { call } = yield* subject(service, { sendsNetwork: false });
      const read = (pageId: string, version: number) =>
        call(GATEWAY_METHOD.TASKS_PAGE, { taskId: FIXTURE_IDS.TASK, pageId, version });

      const newest = yield* read(FIXTURE_PAGE.id, FIXTURE_PAGE.version);
      const first = yield* read(FIXTURE_PAGE.id, 1);
      const other = yield* read("8b2d4f6a-0c1e-4b5d-9f7a-1c3e5b7d9f1a", 1);

      assert.ok(isRecord(newest) && isRecord(newest.page));
      assert.equal(newest.page.version, FIXTURE_PAGE.version);
      assert.ok(isRecord(first) && isRecord(first.page));
      assert.equal(first.page.version, 1);
      assert.deepEqual(other, { failure: TASK_CALL_FAILURE.UNANSWERED });
    }),
);

it.effect(
  "a description's picture is answered to the window that asked as its bytes, and as not found where the service holds none for it",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const picture = { contentType: PICTURE_TYPE.PNG, base64: "iVBORw0KGgo=" };
      service.pictures.set(INVITES, new Map([["picture-1", picture]]));
      const { call, told } = yield* subject(service);

      const read = yield* call("TASKS_PICTURE_READ", {
        planId: INVITES,
        attachmentId: "picture-1",
      });
      const gone = yield* call("TASKS_PICTURE_READ", {
        planId: INVITES,
        attachmentId: "picture-2",
      });

      assert.deepEqual(read, picture);
      assert.deepEqual(gone, { failure: TASK_CALL_FAILURE.NOT_FOUND });
      assert.equal(told.length, 0, "a picture's bytes are never told in the view");
    }),
);

it.effect(
  "a window of a File tab's file is answered as the service read it, its lines plain, since the panel colors code itself",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const window = {
        path: "src/seats.ts",
        repository: "acme/relay",
        branch: "main",
        firstLine: 1,
        lineCount: 2,
        lines: ["const seats = 3;", "export { seats };"],
      };
      service.files["src/seats.ts"] = { file: window };
      const { call } = yield* subject(service);

      const read = yield* call("TASKS_FILE", {
        taskId: INVITES,
        path: "src/seats.ts",
        firstLine: 1,
        lastLine: 2,
      });

      assert.deepEqual(read, { file: window });
    }),
);

it.effect(
  "a file read at a commit answers what was first read there, while one read at the head or at another commit answers the file as it stands",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const window = {
        path: "src/seats.ts",
        repository: "acme/relay",
        branch: "main",
        firstLine: 1,
        lineCount: 2,
        lines: ["const seats = 3;", "export { seats };"],
      };
      service.files["src/seats.ts"] = { file: window };
      const { call } = yield* subject(service);
      const read = { taskId: INVITES, path: "src/seats.ts", firstLine: 1, lastLine: 2 };
      const atCommit = { ...read, ref: "0123456789abcdef0123456789abcdef01234567" };

      yield* call("TASKS_FILE", atCommit);
      const changed = { ...window, lines: ["const seats = 4;", "export { seats };"] };
      service.files["src/seats.ts"] = { file: changed };

      assert.deepEqual(yield* call("TASKS_FILE", atCommit), { file: window });
      assert.deepEqual(yield* call("TASKS_FILE", read), { file: changed });
      assert.deepEqual(
        yield* call("TASKS_FILE", {
          ...read,
          ref: "89abcdef0123456789abcdef0123456789abcdef",
        }),
        { file: changed },
      );
    }),
);

it.effect(
  "a picture the editor took is kept on the service and read back by the id it answered, and one past the description's bound is refused in so many words",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const { call } = yield* subject(service);
      const picture = "data:image/png;base64,iVBORw0KGgo=";

      const kept = yield* call("TASKS_PICTURE_KEEP", { planId: INVITES, picture });
      yield* call("TASKS_PICTURE_KEEP", { planId: INVITES, picture });
      const third = yield* call("TASKS_PICTURE_KEEP", { planId: INVITES, picture });

      assert.deepEqual(kept, { id: "kept-1" });
      assert.deepEqual(
        yield* call("TASKS_PICTURE_READ", { planId: INVITES, attachmentId: "kept-1" }),
        { contentType: PICTURE_TYPE.PNG, base64: "iVBORw0KGgo=" },
      );
      assert.deepEqual(third, { failure: PICTURE_KEEP_FAILURE.TOO_MANY });
    }),
);

it.effect("the window's refresh lists the plans and opening one draws its saved document", () =>
  Effect.gen(function* () {
    const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
    const billing = task(BILLING, "Billing export", "# Billing export", 20);
    const { call, last, tasks, listed, openTask, description } = yield* subject(
      fakeService([billing, invites]),
    );

    yield* call("TASKS_REFRESH", undefined);
    yield* listed();
    assert.deepEqual(
      last()?.tasks.map((each) => each.name),
      [billing.name, invites.name],
    );
    assert.equal(last()?.listStatus, TASKS_READ.READY);
    assert.equal(last()?.activeTaskId, undefined);

    assert.deepEqual(yield* openTask(INVITES), true);
    assert.equal(last()?.activeTaskId, INVITES);
    assert.deepEqual(description(INVITES)?.document, invites.document);
    assert.equal(tasks.snapshot().activeTaskId, INVITES);

    yield* openTask(BILLING);
    assert.equal(last()?.activeTaskId, BILLING);
    assert.deepEqual(description(BILLING)?.document, billing.document);
  }),
);

it.effect(
  "the account gate opening draws the lists kept on disk while the service answers nothing, and reads the list past where it was kept",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("tasks-entities-");
      const earlier = yield* Scope.make();
      const kept = yield* Scope.provide(earlier)(
        openEntityStore({ directory, cipher: testCipher(), accountId: "user-dana" }),
      );
      yield* kept.keep(KEPT_READ.TASK_LIST, {
        rows: { plans: [rowOfTask(task(INVITES, "Kept invitations", "# Kept", 10))], agents: [] },
        at: "7",
      });
      yield* kept.keep(KEPT_READ.WORKSPACES, [PERSONAL, ACME]);
      yield* kept.keep(KEPT_READ.SIDEBAR, {
        sections: [],
        entries: [],
        agentEntries: [],
        pins: [{ repository: "acme/relay", pinnedAt: 3 }],
      });
      yield* Scope.close(earlier, Exit.void);
      const entities = yield* openEntityStore({
        directory,
        cipher: testCipher(),
        accountId: "user-dana",
      });
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      service.live.list.refuse({ failure: TASK_CALL_FAILURE.UNANSWERED });
      service.workspacesFail = true;
      service.liveRead = (() =>
        Effect.succeed({ failure: TASK_CALL_FAILURE.UNANSWERED })) as TasksClient["liveRead"];
      const asked: (string | undefined)[] = [];
      const { listLive } = service;
      service.listLive = (userId, sync) => {
        asked.push(sync);
        return listLive(userId, sync);
      };
      const { last, settled, open } = yield* subject(service, { entities });

      yield* open;
      yield* settled;

      assert.deepEqual(
        last()?.tasks.map((each) => each.name),
        ["Kept invitations"],
      );
      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
      assert.deepEqual(last()?.repositoryPins, [{ repository: "acme/relay", pinnedAt: 3 }]);
      assert.equal(asked[0], "7");
    }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
);

it.effect(
  "an answer of the list that moves no row writes nothing to disk, and the sync id it reached is written as the store closes",
  () =>
    Effect.gen(function* () {
      const disk = Layer.merge(memoryFileSystem().layer, NodePath.layer);
      const opened = Effect.provide(
        openEntityStore({ directory: "/state", cipher: testCipher(), accountId: "user-dana" }),
        disk,
      );
      /** The sync id the list stands at on disk, as a store opened over it reads it. */
      const keptAt = Effect.map(
        Effect.scoped(opened),
        (store) => store.stored(KEPT_READ.TASK_LIST)?.at,
      );
      const quit = yield* Scope.make();
      const entities = yield* Scope.provide(quit)(opened);
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const { call, listed } = yield* Scope.provide(quit)(subject(service, { entities }));
      yield* call("TASKS_REFRESH", undefined);
      yield* listed();
      yield* TestClock.adjust("30 seconds");
      const first = yield* keptAt;

      // The service answers past the id it answered last, nothing having moved since.
      yield* listed();
      yield* TestClock.adjust("30 seconds");
      const meanwhile = yield* keptAt;
      yield* Scope.close(quit, Exit.void);

      assert.deepEqual([first, meanwhile, yield* keptAt], ["1", "1", "2"]);
    }),
);

it.effect(
  "a rename the service did not answer stays drawn through a relaunch on the same disk, and is sent once more under its key",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("tasks-queue-");
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      service.renameUntaken = WRITE_UNTAKEN.UNANSWERED;
      const options = { mintKey: () => "rename-key", replayRefused: Effect.void };
      const opened = (pool: EntityPool) =>
        openEntityStore({
          directory,
          cipher: testCipher(),
          accountId: "user-dana",
          queued: pool.queued,
        });
      const quit = yield* Scope.make();
      const before = yield* Scope.provide(quit)(entityPool(options));
      const kept = yield* Scope.provide(quit)(opened(before));
      const first = yield* Scope.provide(quit)(subject(service, { entities: kept, pool: before }));
      yield* first.call("TASKS_REFRESH", undefined);
      yield* first.listed();
      const answered = yield* first.call("TASKS_RENAME", {
        taskId: INVITES,
        name: "Invitations",
      });
      yield* Scope.close(quit, Exit.void);

      const pool = yield* entityPool(options);
      const entities = yield* opened(pool);
      const relaunched = yield* subject(service, { entities, pool });
      yield* pool.requeue(entities.queue, relaunched.tasks.queueable);
      service.renameUntaken = undefined;
      yield* relaunched.call("TASKS_REFRESH", undefined);
      yield* relaunched.listed();
      yield* relaunched.settled;

      assert.deepEqual(answered, true);
      assert.deepEqual(
        relaunched.last()?.tasks.map((each) => each.name),
        ["Invitations"],
      );
      assert.deepEqual(service.renameKeys, ["rename-key", "rename-key"]);
      assert.deepEqual(pool.queued(), []);
    }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
);

it.effect(
  "a change made offline that the service refuses as it is sent again is taken back and counted",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      service.renameUntaken = WRITE_UNTAKEN.UNANSWERED;
      const refused = { times: 0 };
      const pool = yield* entityPool({
        mintKey: () => "rename-key",
        replayRefused: Effect.sync(() => {
          refused.times += 1;
        }),
      });
      const { call, listed, last, settled } = yield* subject(service, { pool });
      yield* call("TASKS_REFRESH", undefined);
      yield* listed();
      yield* call("TASKS_RENAME", { taskId: INVITES, name: "Invitations" });
      const drawn = last()?.tasks.map((each) => each.name);

      service.renameUntaken = WRITE_UNTAKEN.REFUSED;
      yield* listed();
      yield* settled;

      assert.deepEqual(drawn, ["Invitations"]);
      assert.deepEqual(
        last()?.tasks.map((each) => each.name),
        ["Teammate invitations"],
      );
      assert.equal(refused.times, 1);
    }),
);

it.effect(
  "a start the service did not answer stays drawn and open through a relaunch, and is sent once more under its key, opening nothing",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("tasks-queue-");
      const billing = task(BILLING, "Billing export", "# Billing", 20);
      const service = fakeService([billing]);
      service.createAnswer = {
        ok: false,
        failure: TASK_CALL_FAILURE.UNANSWERED,
        untaken: WRITE_UNTAKEN.UNANSWERED,
      };
      const options = { mintKey: () => "start-key", replayRefused: Effect.void };
      const opened = (pool: EntityPool) =>
        openEntityStore({
          directory,
          cipher: testCipher(),
          accountId: "user-dana",
          queued: pool.queued,
        });
      const quit = yield* Scope.make();
      const before = yield* Scope.provide(quit)(entityPool(options));
      const kept = yield* Scope.provide(quit)(opened(before));
      const first = yield* Scope.provide(quit)(subject(service, { entities: kept, pool: before }));
      yield* first.call("TASKS_REFRESH", undefined);
      yield* first.listed();
      const answered = yield* first.call("TASKS_START", {
        name: "Invitation expiry",
        workspaceId: billing.workspaceId,
      });
      const waiting = first.last();
      yield* Scope.close(quit, Exit.void);

      const pool = yield* entityPool(options);
      const entities = yield* opened(pool);
      const relaunched = yield* subject(service, { entities, pool });
      yield* pool.requeue(entities.queue, relaunched.tasks.queueable);
      const made = { ...task(INVITES, "Invitation expiry", "", 30), createdAt: 3_000 };
      service.tasks = [...service.tasks, made];
      service.createAnswer = { ok: true, answer: { task: made } };
      yield* relaunched.call("TASKS_REFRESH", undefined);
      yield* relaunched.listed();
      yield* relaunched.settled;

      assert.deepEqual(answered, { planId: INVITES });
      assert.equal(waiting?.activeTaskId, INVITES, "the task stands open while it waits");
      assert.equal(
        waiting?.tasks.some((row) => row.id === INVITES),
        true,
        "its row is drawn",
      );
      assert.deepEqual(service.createKeys, ["start-key", "start-key"]);
      assert.equal(relaunched.last()?.activeTaskId, undefined, "sent again, it opens nothing");
      assert.deepEqual(
        relaunched.last()?.tasks.map((row) => row.id),
        [INVITES, BILLING],
      );
      assert.deepEqual(pool.queued(), []);
    }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
);

it.effect(
  "a start the service took already as it is sent again stands open and follows its task's record, so a save someone else makes reaches its description",
  () =>
    Effect.gen(function* () {
      const billing = task(BILLING, "Billing export", "# Billing", 20);
      const service = fakeService([billing]);
      service.createAnswer = {
        ok: false,
        failure: TASK_CALL_FAILURE.UNANSWERED,
        untaken: WRITE_UNTAKEN.UNANSWERED,
      };
      const pool = yield* entityPool({ mintKey: () => "start-key", replayRefused: Effect.void });
      const { call, listed, last, settled, description } = yield* subject(service, { pool });
      yield* call("TASKS_REFRESH", undefined);
      yield* listed();
      yield* call("TASKS_START", {
        name: "Invitation expiry",
        workspaceId: billing.workspaceId,
      });

      // The first send landed though its answer was lost, so the service holds the task, its record, and its key.
      service.tasks = [...service.tasks, task(INVITES, "Invitation expiry", "", 30)];
      const record = polledRecord(service, INVITES);
      service.recordLives[INVITES] = record;
      service.createAnswer = {
        ok: false,
        failure: TASK_CALL_FAILURE.UNANSWERED,
        untaken: WRITE_UNTAKEN.ALREADY_WRITTEN,
      };
      yield* listed();
      yield* settled;
      yield* TestClock.adjust(Duration.seconds(1));
      yield* followSettled;
      // A teammate saves the description, which the next poll carries.
      service.tasks = service.tasks.map((each) =>
        each.id === INVITES
          ? { ...each, updatedAt: 40, document: { ...each.document, body: "# Theirs" } }
          : each,
      );
      record.move();
      yield* TestClock.adjust(Duration.seconds(1));
      yield* followSettled;

      assert.deepEqual(service.createKeys, ["start-key", "start-key"]);
      assert.equal(last()?.activeTaskId, INVITES);
      assert.equal(description(INVITES)?.document.body, "# Theirs");
      assert.deepEqual(pool.queued(), []);
    }),
);

it.effect(
  "a start that names an agent waits where the service did not answer, its call held until it is sent again, and then answers its agent's start",
  () =>
    Effect.gen(function* () {
      const billing = task(BILLING, "Billing export", "# Billing", 20);
      const service = fakeService([billing]);
      service.createAnswer = {
        ok: false,
        failure: TASK_CALL_FAILURE.UNANSWERED,
        untaken: WRITE_UNTAKEN.UNANSWERED,
      };
      const pool = yield* entityPool({ mintKey: () => "start-key", replayRefused: Effect.void });
      const { call, listed, last, settled } = yield* subject(service, { pool });
      yield* call("TASKS_REFRESH", undefined);
      yield* listed();

      const starting = yield* Effect.forkChild(
        call("TASKS_START", {
          workspaceId: billing.workspaceId,
          agent: { idempotencyKey: "agent-key", prompt: "Expire invitations." },
          quiet: true,
        }),
      );
      yield* settled;
      const meanwhile = starting.pollUnsafe();
      const drawn = last()?.tasks.some((row) => row.id === INVITES);
      const made = task(INVITES, "Untitled", "", 30);
      const agentStart = {
        agent: {
          id: "3c9e1d2a-6b7f-4e8a-9c0d-1e2f3a4b5c6d",
          planId: INVITES,
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          title: null,
          createdAt: 31,
          status: AGENT_STATUS.STARTING,
          turnId: null,
        },
      };
      service.tasks = [...service.tasks, made];
      service.createAnswer = { ok: true, answer: { task: made, agent: agentStart } };
      yield* listed();

      assert.equal(meanwhile, undefined, "no answer while it waits");
      assert.equal(drawn, true, "its row is drawn while it waits");
      assert.deepEqual(yield* Fiber.join(starting), { planId: INVITES, agentStart });
      assert.deepEqual(
        service.createKeys,
        [undefined, undefined],
        "sent under the agent's key alone",
      );
      assert.deepEqual(pool.queued(), []);
    }),
);

it.effect(
  "the account gate opening follows the task list, the workspaces, and the sidebar, and reads GitHub, with no window asking",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      service.memberships = [PERSONAL, ACME];
      service.pins = [{ repository: "acme/relay", pinnedAt: 3 }];
      service.connection = { connected: true, login: "ada" };
      const { last, listed, open } = yield* subject(service);

      yield* open;
      yield* listed();

      assert.deepEqual(
        last()?.tasks.map((each) => each.name),
        ["Teammate invitations"],
      );
      assert.equal(last()?.listStatus, TASKS_READ.READY);
      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
      assert.deepEqual(last()?.repositoryPins, [{ repository: "acme/relay", pinnedAt: 3 }]);
      assert.deepEqual(last()?.github, { connected: true, login: "ada" });
    }),
);

it.effect(
  "a start reaches the service whole: its workspace, brief, planning, standing, and the device its agents run on, under the id the host minted",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const { call } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      service.createAnswer = { ok: true, answer: { task: task(INVITES, "Rate limit", "", 10) } };
      const asked = {
        name: "Rate limit",
        brief: "Rate limit search.",
        repository: "acme/ledger",
        workspaceId: "workspace-acme",
        planning: false,
        status: TASK_STATUS.BACKLOG,
        priority: TASK_PRIORITY.HIGH,
        assigneeId: "user-ada",
        runsOn: { machine: AGENT_MACHINE.DEVICE, deviceId: "6f0c1d0e-6b1a-4d43-9a49-2b7b6f1f0a11" },
      } as const;

      yield* call("TASKS_START", { ...asked, quiet: true });

      assert.deepEqual(service.createRequests, [{ ...asked, id: INVITES }]);
    }),
);

it.effect(
  "a quiet start opens nothing and answers its task, and its agent's start where it named one",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(BILLING, "Billing export", "# Billing", 20)]);
      const { call, listed, last } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* listed();
      const made = task(INVITES, "Invitation expiry", "", 10);
      const refusal = { failure: AGENT_CALL_FAILURE.INVALID_CHOICE };
      service.createAnswer = { ok: true, answer: { task: made } };
      const started = yield* call("TASKS_START", {
        name: "Invitation expiry",
        quiet: true,
      });
      service.createAnswer = { ok: true, answer: { task: made, agent: refusal } };
      const withAgent = yield* call("TASKS_START", {
        agent: { idempotencyKey: "start-1", prompt: "Expire invitations." },
        quiet: true,
      });

      assert.deepEqual(started, { planId: INVITES });
      assert.deepEqual(withAgent, { planId: INVITES, agentStart: refusal });
      assert.equal(last()?.activeTaskId, undefined, "the task is not opened");
    }),
);

it.effect(
  "a quick add draws its row before the service answers and holds it until the list carries the start, and one the service refused is taken back",
  () =>
    Effect.gen(function* () {
      const billing = task(BILLING, "Billing export", "# Billing", 20);
      const service = fakeService([billing]);
      const { call, last, settled, listed } = yield* subject(service);
      const shown = () => last()?.tasks.some((row) => row.id === INVITES);
      yield* call("TASKS_REFRESH", undefined);
      yield* listed();
      // An answer Sync woke hands the follow its wait for a write's transaction.
      service.live.list.set({ plans: [rowOfTask(billing)] }, ["tx-earlier"]);
      yield* nextPoll(settled);
      // The service answers a start only once let go, as one still out.
      const answered = yield* Deferred.make<void>();
      const { create } = service;
      service.create = (request) => Effect.andThen(Deferred.await(answered), create(request));
      service.createAnswer = { ok: false, failure: TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE };
      const quickAdd = { name: "Invitation expiry", workspaceId: billing.workspaceId, quiet: true };

      const refusing = yield* Effect.forkChild(call("TASKS_START", quickAdd));
      yield* settled;
      const drawn = shown();
      yield* Deferred.succeed(answered, undefined);
      const refused = yield* Fiber.join(refusing);
      const takenBack = shown();

      const made = { ...task(INVITES, "Invitation expiry", "", 30), createdAt: 3_000 };
      service.createAnswer = { ok: true, answer: { task: made, txid: "tx-start" } };
      const start = yield* Effect.forkChild(call("TASKS_START", quickAdd));
      yield* settled;
      // A list read from before the start answers without it.
      service.live.list.set({ plans: [rowOfTask(billing)] }, ["tx-other"]);
      yield* nextPoll(settled);
      const throughStale = shown();
      service.live.list.set({ plans: [rowOfTask(made), rowOfTask(billing)] }, ["tx-start"]);
      yield* nextPoll(settled);

      assert.equal(drawn, true, "the row is drawn before the service answers");
      assert.deepEqual(refused, { failure: TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE });
      assert.equal(takenBack, false, "a refused start's row is taken back");
      assert.equal(throughStale, true, "the row stands until the list carries the start");
      assert.deepEqual(yield* Fiber.join(start), { planId: INVITES });
      assert.deepEqual(
        last()?.tasks.map((row) => row.id),
        [INVITES, BILLING],
      );
    }),
);

it.effect(
  "a start opens its task at once on its empty description, and one the service refused puts the reader back on the task they stood on",
  () =>
    Effect.gen(function* () {
      const billing = task(BILLING, "Billing export", "# Billing", 20);
      const service = fakeService([billing]);
      const { call, last, settled, listed, openTask, description } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* listed();
      yield* openTask(BILLING);
      // The service answers the start only once let go, as one still out.
      const answered = yield* Deferred.make<void>();
      const { create } = service;
      service.create = (request) => Effect.andThen(Deferred.await(answered), create(request));
      service.createAnswer = { ok: false, failure: TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE };

      const start = yield* Effect.forkChild(
        call("TASKS_START", {
          name: "Invitation expiry",
          workspaceId: billing.workspaceId,
        }),
      );
      yield* settled;
      const opened = last()?.activeTaskId;
      const drawn = description(INVITES);
      yield* Deferred.succeed(answered, undefined);
      const refused = yield* Fiber.join(start);

      assert.equal(opened, INVITES, "the task opens before the service answers");
      assert.equal(drawn?.name, "Invitation expiry");
      assert.equal(drawn?.document.body, "", "on its empty description");
      assert.deepEqual(refused, { failure: TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE });
      assert.equal(last()?.activeTaskId, BILLING, "the reader is back where they stood");
    }),
);

it.effect(
  "a start opened at once follows its task's record once the service made it, so a save someone else makes reaches its description",
  () =>
    Effect.gen(function* () {
      const billing = task(BILLING, "Billing export", "# Billing", 20);
      const service = fakeService([billing]);
      const { call, settled, listed, description } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* listed();
      // The service makes the task only once let go, its record sealed from then on.
      const answered = yield* Deferred.make<void>();
      const { create } = service;
      service.create = (request) => Effect.andThen(Deferred.await(answered), create(request));
      const made = { ...task(INVITES, "Invitation expiry", "", 30), createdAt: 3_000 };
      service.createAnswer = { ok: true, answer: { task: made } };

      const start = yield* Effect.forkChild(
        call("TASKS_START", {
          name: "Invitation expiry",
          workspaceId: billing.workspaceId,
        }),
      );
      yield* settled;
      service.tasks = [...service.tasks, made];
      const record = polledRecord(service, INVITES);
      service.recordLives[INVITES] = record;
      yield* Deferred.succeed(answered, undefined);
      yield* Fiber.join(start);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* followSettled;
      // A teammate saves the description, which the next poll carries.
      service.tasks = service.tasks.map((each) =>
        each.id === INVITES
          ? { ...each, updatedAt: 40, document: { ...each.document, body: "# Theirs" } }
          : each,
      );
      record.move();
      yield* TestClock.adjust(Duration.seconds(1));
      yield* followSettled;

      assert.equal(description(INVITES)?.document.body, "# Theirs");
    }),
);

it.effect("a start answered after another task was opened answers its task and opens nothing", () =>
  Effect.gen(function* () {
    const billing = task(BILLING, "Billing export", "# Billing", 20);
    const service = fakeService([billing]);
    const { call, last, settled } = yield* subject(service);
    // The service makes the task only once let go, as a start still out when the next press lands.
    const answered = yield* Deferred.make<void>();
    const { create } = service;
    service.create = (request) => Effect.andThen(Deferred.await(answered), create(request));
    service.createAnswer = {
      ok: true,
      answer: { task: task(INVITES, "Invitation expiry", "", 10) },
    };

    const starting = yield* Effect.forkChild(call("TASKS_START", { name: "Invitation expiry" }));
    yield* settled;
    yield* call("TASKS_SELECT", { taskId: BILLING });
    yield* Deferred.succeed(answered, undefined);
    yield* settled;

    assert.deepEqual(starting.pollUnsafe(), Exit.succeed({ planId: INVITES }));
    assert.equal(last()?.activeTaskId, BILLING, "the task opened since stays open");
  }),
);

it.effect("a task opened again draws its held description before any read of it answers", () =>
  Effect.gen(function* () {
    const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
    const billing = task(BILLING, "Billing export", "# Billing export", 20);
    const service = fakeService([billing, invites]);
    const { call, last, openTask, held, settled } = yield* subject(service);
    yield* openTask(INVITES);
    yield* openTask(BILLING);
    // Every read of the service is held from here, as a service that has not answered yet.
    const answered = yield* Deferred.make<void>();
    const { open } = service;
    service.open = (taskId) => Effect.andThen(Deferred.await(answered), open(taskId));

    // The window lets the billing task's description go as it opens the invites task again, whose it holds anew.
    yield* call(GATEWAY_METHOD.TASKS_DOCUMENT_UNFOLLOW, { taskId: BILLING });
    const opening = yield* Effect.forkChild(call("TASKS_SELECT", { taskId: INVITES }));
    yield* call(GATEWAY_METHOD.TASKS_DOCUMENT_FOLLOW, { taskId: INVITES });
    yield* settled;

    assert.deepEqual(opening.pollUnsafe(), Exit.succeed(true), "the open answered");
    assert.equal(last()?.activeTaskId, INVITES);
    assert.deepEqual(held(INVITES), { rows: { task: invites } });
    assert.deepEqual(
      held(BILLING),
      { rows: { task: billing } },
      "a description let go lately stays held",
    );
  }),
);

it.effect(
  "an open is not queued behind the read of a task switched past, whose answer lands on that task's description alone",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const billing = task(BILLING, "Billing export", "# Billing export", 20);
      const service = fakeService([billing, invites]);
      // The billing task's description is held, as a read still out when the next press lands.
      const answered = yield* Deferred.make<void>();
      const { open } = service;
      service.open = (taskId) =>
        taskId === BILLING ? Effect.andThen(Deferred.await(answered), open(taskId)) : open(taskId);
      const { call, last, settled, held, openTask, holdDescription } = yield* subject(service);

      yield* openTask(BILLING);
      const opening = yield* call("TASKS_SELECT", { taskId: INVITES });
      yield* holdDescription(INVITES);
      yield* settled;

      assert.deepEqual(opening, true);
      assert.equal(last()?.activeTaskId, INVITES);
      assert.deepEqual(held(INVITES), { rows: { task: invites } });
      assert.equal(held(BILLING), undefined);

      yield* Deferred.succeed(answered, undefined);
      yield* settled;
      assert.deepEqual(held(INVITES), { rows: { task: invites } });
      assert.deepEqual(held(BILLING), { rows: { task: billing } });
    }),
);

it.effect("a press on the task already open reads nothing again", () =>
  Effect.gen(function* () {
    const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
    const service = fakeService([invites]);
    const { openTask, description } = yield* subject(service);
    yield* openTask(INVITES);
    const before = service.reads.length;

    assert.deepEqual(yield* openTask(INVITES), true);
    assert.deepEqual(service.reads.slice(before), []);
    assert.deepEqual(description(INVITES), invites);
  }),
);

it.effect(
  "a rename answered while the description it opened on is still read draws the renamed description, which the read then never lands over",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([invites]);
      const { call, settled, held, description, openTask } = yield* subject(service);
      // The read takes the task as it stands when asked, and answers only once let go.
      const answered = yield* Deferred.make<void>();
      const { open } = service;
      service.open = (taskId) =>
        Effect.flatMap(open(taskId), (read) => Effect.as(Deferred.await(answered), read));

      yield* openTask(INVITES);
      assert.equal(held(INVITES), undefined, "the description is still read");
      yield* call("TASKS_RENAME", { taskId: INVITES, name: "Invitations" });
      assert.equal(description(INVITES)?.document.body, "# Invitations");

      yield* Deferred.succeed(answered, undefined);
      yield* settled;
      assert.equal(description(INVITES)?.name, "Invitations");
      assert.equal(description(INVITES)?.document.body, "# Invitations");
    }),
);

it.effect(
  "a pin answered while a description's first read is out stands over the pin the read took, and the read's description still lands",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const billing = task(BILLING, "Billing export", "# Billing export", 20);
      const service = fakeService([billing, invites]);
      const { call, settled, listed, description, openTask } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* listed();

      // The read takes the task as it stands when asked, and answers only once let go.
      const answered = yield* Deferred.make<void>();
      const { open } = service;
      service.open = (taskId) =>
        Effect.flatMap(open(taskId), (read) => Effect.as(Deferred.await(answered), read));
      yield* openTask(INVITES);
      yield* call("TASKS_PIN", { taskId: INVITES, pinned: true });

      yield* Deferred.succeed(answered, undefined);
      yield* settled;
      assert.equal(description(INVITES)?.pinnedAt, MARKED_AT);
      assert.equal(description(INVITES)?.document.body, "# Teammate invitations");
    }),
);

it.effect("a refresh that reads what the view already holds tells the window nothing", () =>
  Effect.gen(function* () {
    const billing = task(BILLING, "Billing export", "# Billing export", 20);
    const { call, told } = yield* subject(fakeService([billing]));

    yield* call("TASKS_REFRESH", undefined);
    const firstRead = told.length;
    yield* call("TASKS_REFRESH", undefined);

    assert.ok(firstRead > 0, "the first read is told");
    assert.equal(told.length, firstRead);
  }),
);

it.effect(
  "a list that moves again holds the tasks it had already listed as the objects it held",
  () =>
    Effect.gen(function* () {
      const billing = task(BILLING, "Billing export", "# Billing export", 20);
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([billing]);
      const { call, tasks, listed } = yield* subject(service);

      yield* call("TASKS_REFRESH", undefined);
      yield* listed();
      const first = tasks.snapshot();
      service.tasks = [billing, invites];
      yield* listed();

      assert.deepEqual(
        tasks.snapshot().tasks.map((each) => each.id),
        [BILLING, INVITES],
      );
      assert.equal(tasks.snapshot().tasks[0], first.tasks[0]);
      assert.equal(tasks.snapshot().workspaces, first.workspaces);
    }),
);

it.effect("the window's refresh lists the agents with no task beside the tasks", () =>
  Effect.gen(function* () {
    const billing = task(BILLING, "Billing export", "# Billing export", 20);
    const { call, last, listed } = yield* subject(fakeService([billing]));
    const triage = agentRow(null, 60_000);

    yield* call("TASKS_REFRESH", undefined);
    yield* listed([triage]);

    assert.deepEqual(
      last()?.tasks.map((each) => each.id),
      [BILLING],
    );
    assert.deepEqual(
      last()?.tasklessAgents?.map((each) => each.id),
      [triage.id],
    );
  }),
);

it.effect(
  "the developer's edit is saved on the service and the open description takes the plan it answered, which stands with its list row until the record and the list carry its transaction",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", INVITES_TEXT, 10);
      const service = fakeService([invites]);
      const record = polledRecord(service, INVITES);
      service.recordLives[INVITES] = record;
      const { call, last, openTask, description, settled, listed } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* listed();
      yield* openTask(INVITES);
      // Answers Sync woke hand the list's and the record's follows their waits for a write's transaction.
      service.live.list.set({}, ["tx-earlier"]);
      yield* nextPoll(settled);
      yield* answered(() => record.set({}, ["tx-earlier"]));
      const opens = () => service.reads.filter((read) => read === `open:${INVITES}`).length;
      const opened = opens();

      service.editTxid = "tx-edit";
      const mine = `${INVITES_TEXT}\n\nInvites expire.`;
      const answer = yield* call("TASKS_EDIT", {
        taskId: INVITES,
        edit: { document: { base: INVITES_TEXT, value: mine } },
      });
      assert.deepEqual(answer, { saved: true }, "the edit answers once its description is drawn");
      assert.equal(description(INVITES)?.document.body, mine);
      assert.equal(description(INVITES)?.updatedAt, EDITED_AT);

      // A teammate's save the record carries before the edit's transaction reads nothing, and the list's row from before it is held over.
      const [edited] = service.tasks;
      assert.ok(edited !== undefined);
      const theirs = {
        ...edited,
        updatedAt: 9_000,
        document: { ...edited.document, body: "Theirs." },
      };
      service.tasks = [theirs];
      yield* answered(() =>
        record.set({ description: [{ taskId: INVITES, savedAt: theirs.updatedAt }] }, ["tx-other"]),
      );
      service.live.list.set({ plans: [rowOfTask(invites)] }, ["tx-other"]);
      yield* nextPoll(settled);
      assert.equal(opens(), opened);
      assert.equal(description(INVITES)?.document.body, mine);
      assert.equal(last()?.tasks.find((row) => row.id === INVITES)?.updatedAt, EDITED_AT);

      // Once the record carries the edit's transaction, the save it delivered meanwhile is read.
      yield* answered(() =>
        record.set({ description: [{ taskId: INVITES, savedAt: theirs.updatedAt }] }, ["tx-edit"]),
      );
      service.live.list.set({ plans: [rowOfTask(theirs)] }, ["tx-edit"]);
      yield* nextPoll(settled);
      assert.equal(opens(), opened + 1);
      assert.equal(description(INVITES)?.document.body, "Theirs.");
      assert.equal(last()?.tasks.find((row) => row.id === INVITES)?.updatedAt, theirs.updatedAt);
    }),
);

it.effect(
  "a start naming an agent opens the task it made and answers the agent's start beside it, a refusal among them",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const { call, last } = yield* subject(service);
      const made = task(INVITES, "Invitation expiry", "", 10);
      const agent = {
        id: "3c9e1d2a-6b7f-4e8a-9c0d-1e2f3a4b5c6d",
        planId: INVITES,
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        title: null,
        createdAt: 11,
        status: AGENT_STATUS.STARTING,
        turnId: null,
      };
      const params = {
        repository: "acme/relay",
        agent: { idempotencyKey: "start-1", prompt: "Expire invitations." },
      };

      service.createAnswer = { ok: true, answer: { task: made, agent: { agent } } };
      const started = yield* call("TASKS_START", params);
      service.createAnswer = {
        ok: true,
        answer: { task: made, agent: { failure: AGENT_CALL_FAILURE.INVALID_CHOICE } },
      };
      const refused = yield* call("TASKS_START", params);

      assert.deepEqual(started, { planId: INVITES, agentStart: { agent } });
      assert.deepEqual(refused, {
        planId: INVITES,
        agentStart: { failure: AGENT_CALL_FAILURE.INVALID_CHOICE },
      });
      assert.equal(last()?.activeTaskId, INVITES);
    }),
);

it.effect("behind a closed account gate nothing is read and nothing starts", () =>
  Effect.gen(function* () {
    const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call, told, open } = yield* subject(service, { signedIn: false });

    yield* open;
    yield* call("TASKS_REFRESH", undefined);
    const started = yield* call("TASKS_START", { name: "Teammate invitations" });

    assert.deepEqual(started, { failure: TASK_CALL_FAILURE.UNANSWERED });
    assert.deepEqual(told, []);
    assert.deepEqual(service.reads, []);
  }),
);

it.effect(
  "the sidebar's sections and pins are followed from the first refresh and never read again, a change takes the service's answer, one refused leaves them, and another Mac's change is told at once",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, last, told, settled } = yield* subject(service);
      const launch: TaskSection = {
        id: SECTION_ID,
        workspaceId: PERSONAL.id,
        title: "Launch",
        createdAt: 5,
      };
      service.sections = { sections: [launch], entries: [], agentEntries: [] };
      service.pins = [{ repository: "acme/relay", pinnedAt: 3 }];

      yield* call("TASKS_REFRESH", undefined);
      yield* call("TASKS_REFRESH", undefined);
      yield* settled;
      assert.deepEqual(last()?.taskSections, service.sections);
      assert.deepEqual(last()?.repositoryPins, service.pins);
      assert.equal(service.reads.filter((read) => read === "sidebar-live").length, 1);

      const placed = { taskId: INVITES, sectionId: SECTION_ID, addedAt: 6 };
      service.sections = { sections: [launch], entries: [placed], agentEntries: [] };
      const place = { kind: TASK_SECTION_WRITE.PLACE, taskId: INVITES, sectionId: SECTION_ID };
      assert.deepEqual(yield* call("TASKS_WRITE_SECTION", { writes: [place] }), true);
      assert.deepEqual(last()?.taskSections, {
        sections: [launch],
        entries: [placed],
        agentEntries: [],
      });

      service.sections = undefined;
      const removal = { ...place, sectionId: null };
      assert.deepEqual(yield* call("TASKS_WRITE_SECTION", { writes: [removal] }), false);
      assert.deepEqual(last()?.taskSections, {
        sections: [launch],
        entries: [placed],
        agentEntries: [],
      });
      assert.deepEqual(service.sectionWrites, [place, removal]);

      const later = {
        ...launch,
        id: "8c2e1f3a-4b5d-4e6f-9a7b-0c1d2e3f4a5b",
        title: "Later",
        createdAt: 7,
      };
      service.sections = { sections: [later, launch], entries: [], agentEntries: [] };
      service.pins = [
        { repository: "acme/relay", pinnedAt: 3 },
        { repository: "acme/web", pinnedAt: 9 },
      ];
      const before = told.length;
      service.live.sidebar.move();
      yield* nextPoll(settled);
      // Note that an answer moving two parts is told once, so no window draws one moved without the other.
      assert.equal(told.length - before, 1);
      assert.deepEqual(
        last()?.taskSections?.sections.map((section) => section.title),
        ["Launch", "Later"],
      );
      assert.deepEqual(
        last()?.repositoryPins?.map((pin) => pin.repository),
        ["acme/web", "acme/relay"],
      );
    }),
);

it.effect(
  "a drag's change the service refused takes back only what it drew, so the changes the service kept before it stay drawn",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, last } = yield* subject(service);
      const launch: TaskSection = {
        id: SECTION_ID,
        workspaceId: PERSONAL.id,
        title: "Launch",
        createdAt: 5,
      };
      // The service keeps the section, then refuses to put the task in it.
      service.sections = { sections: [launch], entries: [], agentEntries: [] };
      service.sectionRefused = TASK_SECTION_WRITE.PLACE;
      const writes: TasksWriteSectionParams["writes"] = [
        {
          kind: TASK_SECTION_WRITE.CREATE,
          id: SECTION_ID,
          workspaceId: PERSONAL.id,
          title: "Launch",
        },
        { kind: TASK_SECTION_WRITE.PLACE, taskId: INVITES, sectionId: SECTION_ID },
      ];

      assert.deepEqual(yield* call("TASKS_WRITE_SECTION", { writes }), false);
      assert.deepEqual(last()?.taskSections, service.sections);
    }),
);

it.effect(
  "two quick drags draw at once, the later over the earlier, and reach the service in the order they were asked, each whole",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, last, settled } = yield* subject(service);
      service.sections = { sections: [], entries: [], agentEntries: [] };
      yield* call("TASKS_REFRESH", undefined);
      yield* settled;
      const create = {
        kind: TASK_SECTION_WRITE.CREATE,
        id: SECTION_ID,
        workspaceId: PERSONAL.id,
        title: "Launch",
      };
      const place = { kind: TASK_SECTION_WRITE.PLACE, taskId: INVITES, sectionId: SECTION_ID };
      const rename = {
        kind: TASK_SECTION_WRITE.EDIT,
        id: SECTION_ID,
        title: "Launch week",
        icon: null,
      };
      const answered = yield* Deferred.make<void>();
      service.sectionAnswered = Deferred.await(answered);

      const first = yield* Effect.forkChild(
        call("TASKS_WRITE_SECTION", { writes: [create, place] }),
      );
      yield* settled;
      const second = yield* Effect.forkChild(call("TASKS_WRITE_SECTION", { writes: [rename] }));
      yield* settled;
      const drawn = last()?.taskSections;
      yield* Deferred.succeed(answered, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);

      assert.deepEqual(
        [
          drawn?.sections.map((section) => section.title),
          drawn?.entries.map((each) => each.taskId),
        ],
        [["Launch week"], [INVITES]],
      );
      assert.deepEqual(service.sectionWrites, [create, place, rename]);
    }),
);

it.effect(
  "a pin's write answers the service's word, before the sidebar is followed and after",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, settled } = yield* subject(service);
      const pin = (repository: string) =>
        call("TASKS_PIN_REPOSITORY", { repository, pinned: true });

      assert.deepEqual(yield* pin("acme/relay"), true);
      yield* call("TASKS_REFRESH", undefined);
      yield* settled;
      assert.deepEqual(yield* pin("acme/web"), true);
      assert.deepEqual(
        service.pins.map((each) => each.repository),
        ["acme/web", "acme/relay"],
      );
    }),
);

it.effect(
  "a pin stands from the press until the followed sidebar carries its transaction, through an answer from before it, and a refused one is put back",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, last, told, settled } = yield* subject(service);
      const pinned = (view: TasksView | undefined) =>
        view?.repositoryPins?.map((pin) => pin.repository) ?? [];
      yield* call("TASKS_REFRESH", undefined);
      yield* settled;
      // An answer Sync woke hands the follow its wait for a write's transaction.
      service.live.sidebar.set({}, ["tx-earlier"]);
      yield* nextPoll(settled);

      service.pinTxid = "tx-pin";
      const from = told.length;
      const pin = yield* Effect.forkChild(
        call("TASKS_PIN_REPOSITORY", { repository: "acme/relay", pinned: true }),
      );
      yield* settled;
      // Another Mac's change from before the pin landed is answered without it.
      service.live.sidebar.set({ pins: [] }, ["tx-other"]);
      yield* nextPoll(settled);
      service.live.sidebar.set({ pins: service.pins }, ["tx-pin"]);
      yield* nextPoll(settled);

      assert.deepEqual(yield* Fiber.join(pin), true);
      assert.ok(told.length > from);
      assert.deepEqual(
        told.slice(from).filter((view) => !pinned(view).includes("acme/relay")),
        [],
        "the pin is never drawn back",
      );

      service.pinsFail = true;
      assert.deepEqual(
        yield* call("TASKS_PIN_REPOSITORY", { repository: "acme/web", pinned: true }),
        false,
      );
      assert.deepEqual(pinned(last()), ["acme/relay"]);
    }),
);

it.effect("a pin still being written when the account signs out is drawn for nobody after", () =>
  Effect.gen(function* () {
    const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call, told, settled, listed, reset } = yield* subject(service);
    yield* call("TASKS_REFRESH", undefined);
    yield* listed();
    const answered = yield* Deferred.make<void>();
    service.pinAnswered = Deferred.await(answered);
    service.markAnswered = Deferred.await(answered);

    const pin = yield* Effect.forkChild(
      call("TASKS_PIN_REPOSITORY", { repository: "acme/secret", pinned: true }),
    );
    const taskPin = yield* Effect.forkChild(call("TASKS_PIN", { taskId: INVITES, pinned: true }));
    yield* settled;
    const from = told.length;
    // Note that the sign-out waits on the pin's service call, which holds the one lock reads take.
    const signingOut = yield* Effect.forkChild(reset);
    yield* settled;
    yield* Deferred.succeed(answered, undefined);
    yield* Fiber.join(pin);
    yield* Fiber.join(taskPin);
    yield* Fiber.join(signingOut);
    yield* settled;

    assert.deepEqual(
      told.slice(from).flatMap((view) => view.repositoryPins ?? []),
      [],
    );
    assert.deepEqual(
      told.slice(from).flatMap((view) => view.tasks.filter((row) => row.pinnedAt !== undefined)),
      [],
    );
  }),
);

it.effect(
  "a task's pin stands from the press until the followed list carries its transaction, through an answer from before it, and a refused one is put back",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, last, told, settled, listed } = yield* subject(service);
      const pinned = (view: TasksView | undefined) =>
        view?.tasks.find((row) => row.id === INVITES)?.pinnedAt !== undefined;
      yield* call("TASKS_REFRESH", undefined);
      yield* listed();
      // An answer Sync woke hands the follow its wait for a write's transaction.
      service.live.list.set({}, ["tx-earlier"]);
      yield* nextPoll(settled);

      service.markTxid = "tx-pin";
      const from = told.length;
      const pin = yield* Effect.forkChild(call("TASKS_PIN", { taskId: INVITES, pinned: true }));
      yield* settled;
      const standing = last()?.pendingTasks;
      // Another Mac's change from before the pin landed is answered without it.
      const [invites] = service.tasks;
      assert.ok(invites);
      service.live.list.set({ plans: [{ ...rowOfTask(invites), name: "Invites" }] }, ["tx-other"]);
      yield* nextPoll(settled);
      service.live.list.set({ plans: [{ ...rowOfTask(invites), pinnedAt: MARKED_AT }] }, [
        "tx-pin",
      ]);
      yield* nextPoll(settled);

      assert.deepEqual(yield* Fiber.join(pin), true);
      assert.ok(told.length > from);
      assert.deepEqual(
        told.slice(from).filter((view) => !pinned(view)),
        [],
        "the pin is never drawn back",
      );
      // A list held still while read moves the task the pin stood over, and lets it go once kept.
      assert.deepEqual(standing, [INVITES]);
      assert.equal(last()?.pendingTasks, undefined);

      service.markFails = true;
      assert.deepEqual(yield* call("TASKS_PIN", { taskId: INVITES, pinned: false }), false);
      assert.equal(pinned(last()), true);
    }),
);

it.effect(
  "a repository the service answered stands on the task's row through another write's draw, until the list carries it",
  () =>
    Effect.gen(function* () {
      const service = fakeService([
        task(INVITES, "Teammate invitations", "# Draft", 10),
        task(BILLING, "Billing", "# Draft", 11),
      ]);
      const { call, last, settled, listed } = yield* subject(service);
      const repositoryOf = () => last()?.tasks.find((row) => row.id === INVITES)?.repository;
      yield* call("TASKS_REFRESH", undefined);
      yield* listed();
      // An answer Sync woke hands the follow its wait for a write's transaction.
      service.live.list.set({}, ["tx-earlier"]);
      yield* nextPoll(settled);

      service.repositoryTxid = "tx-repository";
      const changed = yield* Effect.forkChild(
        call("TASKS_SET_REPOSITORY", { taskId: INVITES, repository: "acme/relay" }),
      );
      yield* settled;
      // Another task's pin draws the list again before the list carries the repository.
      yield* call("TASKS_PIN", { taskId: BILLING, pinned: true });
      const drawn = repositoryOf();
      service.live.list.set({ plans: service.tasks.map(rowOfTask) }, ["tx-repository"]);
      yield* nextPoll(settled);

      assert.deepEqual(yield* Fiber.join(changed), { repository: "acme/relay" });
      assert.equal(drawn, "acme/relay");
      assert.equal(repositoryOf(), "acme/relay");
    }),
);

it.effect("a block the service answered stands on the open task through the list's next draw", () =>
  Effect.gen(function* () {
    const service = fakeService([
      task(INVITES, "Teammate invitations", "# Draft", 10),
      task(BILLING, "Billing", "# Draft", 11),
    ]);
    const { call, listed, openTask, description } = yield* subject(service);
    yield* call("TASKS_REFRESH", undefined);
    yield* listed();
    yield* openTask(INVITES);
    const blockedBy = () => description(INVITES)?.blockedBy;

    const answered = yield* call("TASKS_BLOCK", {
      taskId: INVITES,
      block: {
        change: TASK_BLOCK_CHANGE.ADD,
        relation: TASK_BLOCK_RELATION.BLOCKED_BY,
        taskId: BILLING,
      },
    });
    yield* listed();

    assert.deepEqual(answered, { blockedBy: [BILLING], blocks: [] });
    assert.deepEqual(blockedBy(), [BILLING]);
  }),
);

it.effect(
  "a block turned around between two tasks draws on both at once, and a refusal takes both back",
  () =>
    Effect.gen(function* () {
      const invites = {
        ...task(INVITES, "Teammate invitations", "# Draft", 10),
        blockedBy: [BILLING],
      };
      const service = fakeService([invites, task(BILLING, "Billing", "# Draft", 11)]);
      const { call, last, settled, listed, openTask } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* listed();
      service.live.list.set({
        plans: service.tasks.map((each) => ({ ...rowOfTask(each), blocked: each.id === INVITES })),
      });
      yield* nextPoll(settled);
      yield* openTask(INVITES);
      const blocked = () =>
        [INVITES, BILLING].map(
          (id) => last()?.tasks.find((row) => row.id === id)?.blocked === true,
        );
      const answered = yield* Deferred.make<void>();
      service.relationAnswered = Deferred.await(answered);
      service.relationFails = true;

      const turning = yield* Effect.forkChild(
        call("TASKS_CHANGE_RELATION", {
          taskId: INVITES,
          relation: {
            taskId: BILLING,
            from: TASK_RELATION_KIND.BLOCKED_BY,
            to: TASK_RELATION_KIND.BLOCKS,
          },
        }),
      );
      yield* settled;
      const drawn = blocked();
      yield* Deferred.succeed(answered, undefined);

      assert.deepEqual(yield* Fiber.join(turning), { failure: TASK_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(drawn, [false, true], "the block is drawn turned around while it is out");
      assert.deepEqual(blocked(), [true, false]);
    }),
);

it.effect("a delete asked draws its task gone before the service answers", () =>
  Effect.gen(function* () {
    const service = fakeService([
      task(INVITES, "Teammate invitations", "# Draft", 10),
      task(BILLING, "Billing", "# Draft", 11),
    ]);
    const { call, last, settled, listed } = yield* subject(service);
    yield* call("TASKS_REFRESH", undefined);
    yield* listed();
    const answered = yield* Deferred.make<void>();
    service.deleteAnswered = Deferred.await(answered);

    const deleting = yield* Effect.forkChild(call("TASKS_DELETE", { taskId: INVITES }));
    yield* settled;
    const drawn = last()?.tasks.map((row) => row.id);
    yield* Deferred.succeed(answered, undefined);

    assert.deepEqual(yield* Fiber.join(deleting), true);
    assert.deepEqual(drawn, [BILLING]);
  }),
);

it.effect(
  "a parent the service answered stands on the open task and nests the list's row at once, through the list's next draw",
  () =>
    Effect.gen(function* () {
      const service = fakeService([
        task(INVITES, "Teammate invitations", "# Draft", 10),
        task(BILLING, "Billing", "# Draft", 11),
      ]);
      const { call, last, listed, openTask, description } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* listed();
      yield* openTask(INVITES);
      const parentOf = () => description(INVITES)?.parentTaskId;
      const nestedUnder = () => last()?.tasks.find((row) => row.id === INVITES)?.parentTaskId;

      const answered = yield* call("TASKS_SET_PARENT", {
        taskId: INVITES,
        parentTaskId: BILLING,
      });
      yield* listed();

      assert.deepEqual(answered, { parentTaskId: BILLING });
      assert.equal(parentOf(), BILLING);
      assert.equal(nestedUnder(), BILLING);
    }),
);

it.effect("a task marked done here is drawn finished now, so the recently finished find it", () =>
  Effect.gen(function* () {
    const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call, told, listed } = yield* subject(service);
    yield* call("TASKS_REFRESH", undefined);
    yield* listed();
    const from = told.length;

    yield* call("TASKS_SET_STANDING", { taskId: INVITES, status: TASK_STATUS.DONE });

    const drawn = told[from]?.tasks.find((row) => row.id === INVITES);
    assert.equal(drawn?.status, TASK_STATUS.DONE);
    // The harness's host clock reads zero.
    assert.equal(drawn?.completedAt, 0);
  }),
);

it.effect("a sign-out drops the view the window drew", () =>
  Effect.gen(function* () {
    const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call, last, openTask, descriptions, reset } = yield* subject(service);
    yield* call("TASKS_REFRESH", undefined);
    yield* openTask(INVITES);

    yield* reset;

    assert.deepEqual(last(), { tasks: [], listStatus: TASKS_READ.IDLE, workspaces: [] });
    assert.deepEqual(
      descriptions(),
      {},
      "the descriptions held for the session are dropped with it",
    );
  }),
);

it.effect(
  "a file, a folder, and the skills of a repository are read by its workspace and its name where no plan names it, and by the plan where one does",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const folder = (path: string): TaskTreeAnswer => ({
        folder: { path, repository: "acme/relay", branch: "main", entries: [], truncated: false },
      });
      const skills = (name: string): TaskSkillsAnswer => ({
        skills: {
          repository: "acme/relay",
          branch: "main",
          skills: [
            {
              name,
              description: "",
              source: TASK_SKILL_SOURCE.REPOSITORY,
              path: `.agents/skills/${name}/SKILL.md`,
            },
          ],
        },
      });
      const file = (path: string): TaskFileAnswer => ({
        file: {
          path,
          repository: "acme/relay",
          branch: "main",
          firstLine: 1,
          lineCount: 1,
          lines: ["const seats = 3;"],
        },
      });
      service.places[ACME.id] = {
        "acme/relay": {
          files: { "src/seats.ts": file("src/seats.ts") },
          folders: { src: folder("src") },
          skills: skills("release"),
        },
      };
      service.files["docs/plan.md"] = file("docs/plan.md");
      service.folders.docs = folder("docs");
      service.skills[INVITES] = skills("review");
      const { call } = yield* subject(service);
      const place = { workspaceId: ACME.id, repository: "acme/relay" };

      const window = { firstLine: 1, lastLine: 1 };
      assert.deepEqual(
        yield* call("TASKS_FILE", { ...place, path: "src/seats.ts", ...window }),
        file("src/seats.ts"),
      );
      assert.deepEqual(
        yield* call("TASKS_FILE", {
          taskId: INVITES,
          path: "docs/plan.md",
          ...window,
        }),
        file("docs/plan.md"),
      );
      assert.deepEqual(yield* call("TASKS_TREE", { ...place, path: "src" }), folder("src"));
      assert.deepEqual(yield* call("TASKS_SKILLS", place), skills("release"));
      assert.deepEqual(
        yield* call("TASKS_TREE", { planId: INVITES, path: "docs" }),
        folder("docs"),
      );
      assert.deepEqual(yield* call("TASKS_SKILLS", { planId: INVITES }), skills("review"));
    }),
);

it.effect(
  "a plan's skills are answered at once from what was read and read again behind the answer, so a skill added lands on the next ask; a read that does not answer keeps them, and a sign-out lets them go",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const skillsNamed = (...names: string[]): TaskSkillsAnswer => ({
        skills: {
          repository: "acme/relay",
          branch: "main",
          skills: names.map((name) => ({
            name,
            description: "",
            source: TASK_SKILL_SOURCE.REPOSITORY,
            path: `.agents/skills/${name}/SKILL.md`,
          })),
        },
      });
      const { call, settled, reset } = yield* subject(service);
      const asked = () => call("TASKS_SKILLS", { planId: INVITES });

      assert.deepEqual(yield* asked(), { failure: TASK_CALL_FAILURE.UNANSWERED });
      service.skills[INVITES] = skillsNamed("review");
      assert.deepEqual(yield* asked(), skillsNamed("review"), "none held, the read is waited on");

      // A skill added on GitHub: the next ask answers what is held, and the one after what was read behind it.
      service.skills[INVITES] = skillsNamed("review", "release");
      assert.deepEqual(yield* asked(), skillsNamed("review"));
      yield* settled;
      assert.deepEqual(yield* asked(), skillsNamed("review", "release"));

      Reflect.deleteProperty(service.skills, INVITES);
      yield* asked();
      yield* settled;
      assert.deepEqual(
        yield* asked(),
        skillsNamed("review", "release"),
        "kept past a read unanswered",
      );

      yield* reset;
      assert.deepEqual(yield* asked(), { failure: TASK_CALL_FAILURE.UNANSWERED });
    }),
);

it.effect(
  "a plan moved to another workspace on the same repository has its skills read there, never answered with the last workspace's",
  () =>
    Effect.gen(function* () {
      const invites = {
        ...task(INVITES, "Teammate invitations", "# Invites", 10),
        repository: "acme/relay",
      };
      const service = fakeService([invites]);
      const installed = (name: string): TaskSkillsAnswer => ({
        skills: {
          repository: "acme/relay",
          branch: "main",
          skills: [{ name, description: "", source: TASK_SKILL_SOURCE.WORKSPACE }],
        },
      });
      const { call, listed } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* listed();
      const asked = () => call("TASKS_SKILLS", { planId: INVITES });
      service.skills[INVITES] = installed("review");
      assert.deepEqual(yield* asked(), installed("review"));

      // Moved to another workspace, the plan offers that workspace's installed skills.
      service.tasks = [{ ...invites, workspaceId: "workspace-acme" }];
      service.skills[INVITES] = installed("release");
      yield* listed();
      assert.deepEqual(yield* asked(), installed("release"));
    }),
);

/** A pull request's or an issue's address on GitHub, as a link to it names it. */
const RELAY_PULL = "https://github.com/acme/relay/pull/42";

const RELAY_PULL_GONE = "https://github.com/acme/relay/pull/43";

const RELAY_PULL_UNANSWERED = "https://github.com/acme/relay/pull/44";

const RELAY_ISSUE = "https://github.com/acme/relay/issues/7";

const RELAY_HOME = "https://github.com/acme/relay";

/** A pull request of acme/relay as GitHub answers it, titled as given. */
const relayPull = (title: string): GitHubRepositoryPullRequestAnswer => ({
  pullRequest: { number: 42, title, url: RELAY_PULL, state: PULL_REQUEST_STATE.OPEN },
});

/** The links' standings the host holds for the windows, as it last told them. */
function standingsOf(events: readonly { readonly kind: string; readonly payload: WireValue }[]) {
  return events.filter((event) => event.kind === GATEWAY_EVENT.LINK_STANDINGS_CHANGED).at(-1)
    ?.payload;
}

/** One link's standing as the host last told it, by the workspace it is read through and its address. */
function standingAt(
  events: readonly { readonly kind: string; readonly payload: WireValue }[],
  workspaceId: string,
  address: string,
) {
  const held = standingsOf(events);
  const inWorkspace = isRecord(held) ? held[workspaceId] : undefined;
  return isRecord(inWorkspace) ? inWorkspace[address] : undefined;
}

it.effect(
  "a link's standing is held by the workspace it is read through and its own address: a pull request or an issue as GitHub holds it, one it holds none of as none, and one the service did not answer, or an address naming no page, as failed",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const notPlanned: GitHubRepositoryIssueAnswer = {
        issue: {
          number: 7,
          title: "Invites expire",
          url: RELAY_ISSUE,
          state: ISSUE_STATE.NOT_PLANNED,
        },
      };
      service.pullRequests[ACME.id] = {
        "acme/relay": new Map([
          [42, relayPull("Batch invites")],
          [43, { pullRequest: null }],
        ]),
      };
      service.issues[ACME.id] = { "acme/relay": new Map([[7, notPlanned]]) };
      const { call, events, settled } = yield* subject(service);

      for (const address of [
        RELAY_PULL,
        RELAY_PULL_GONE,
        RELAY_PULL_UNANSWERED,
        RELAY_ISSUE,
        RELAY_HOME,
      ]) {
        yield* call(GATEWAY_METHOD.TASKS_LINK_STANDING_FOLLOW, { workspaceId: ACME.id, address });
      }
      yield* settled;

      assert.deepEqual(standingsOf(events), {
        [ACME.id]: {
          [RELAY_PULL]: { rows: relayPull("Batch invites") },
          [RELAY_PULL_GONE]: { rows: { pullRequest: null } },
          [RELAY_PULL_UNANSWERED]: { failed: true },
          [RELAY_ISSUE]: { rows: notPlanned },
          [RELAY_HOME]: { failed: true },
        },
      });
    }),
);

it.effect(
  "a window coming forward inside the minute a link's read is kept asks GitHub nothing, and one past it reads what moved; one the service did not answer is asked again only after two",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.pullRequests[ACME.id] = { "acme/relay": new Map([[42, relayPull("Batch invites")]]) };
      service.pullRequestQuota = 1;
      const { call, events, settled, focus } = yield* subject(service);
      const hold = (address: string) =>
        call(GATEWAY_METHOD.TASKS_LINK_STANDING_FOLLOW, { workspaceId: ACME.id, address });
      /** A window coming forward after `seconds`, and every ask it caused landed. */
      const forwardAfter = (seconds: number) =>
        Effect.gen(function* () {
          yield* TestClock.adjust(Duration.seconds(seconds));
          yield* focus.raise;
          yield* settled;
        });

      yield* hold(RELAY_PULL);
      yield* settled;
      service.pullRequests[ACME.id] = {
        "acme/relay": new Map([[42, relayPull("Send in batches")]]),
      };
      service.pullRequestQuota = undefined;
      yield* forwardAfter(30);
      assert.deepEqual(standingsOf(events), {
        [ACME.id]: { [RELAY_PULL]: { rows: relayPull("Batch invites") } },
      });
      yield* forwardAfter(31);
      assert.deepEqual(standingsOf(events), {
        [ACME.id]: { [RELAY_PULL]: { rows: relayPull("Send in batches") } },
      });

      service.pullRequestQuota = 0;
      yield* hold(RELAY_PULL_GONE);
      yield* settled;
      service.pullRequestQuota = undefined;
      service.pullRequests[ACME.id] = {
        "acme/relay": new Map([
          [42, relayPull("Send in batches")],
          [43, { pullRequest: null }],
        ]),
      };
      yield* forwardAfter(90);
      assert.deepEqual(standingAt(events, ACME.id, RELAY_PULL_GONE), { failed: true });
      yield* forwardAfter(31);
      assert.deepEqual(standingAt(events, ACME.id, RELAY_PULL_GONE), {
        rows: { pullRequest: null },
      });
    }),
);

it.effect("behind a closed account gate a link's standing reaches no service", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    service.pullRequests[ACME.id] = { "acme/relay": new Map([[42, relayPull("Batch invites")]]) };
    const { call, events, settled } = yield* subject(service, { signedIn: false });

    yield* call(GATEWAY_METHOD.TASKS_LINK_STANDING_FOLLOW, {
      workspaceId: ACME.id,
      address: RELAY_PULL,
    });
    yield* settled;

    assert.equal(standingsOf(events), undefined);
  }),
);

it.effect(
  "a workspace's repositories are held by the workspace, every one's where none is named, and asked again as its GitHub installations move or a token repository is set in it",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      service.repositoriesAnswer = {
        ok: true,
        answer: {
          installed: true,
          repositories: [],
          installationUrl: "https://github.com/apps/vespin",
        },
      };
      service.tokenRepositorySet = { ok: true, answer: [] };
      const { act, call, settled } = yield* subject(service);
      const asked = () => service.reads.filter((read) => read.startsWith("repositories"));
      yield* call("TASKS_REFRESH", undefined);
      yield* settled;

      yield* call(GATEWAY_METHOD.TASKS_REPOSITORIES_FOLLOW, { workspaceId: ACME.id });
      yield* call(GATEWAY_METHOD.TASKS_REPOSITORIES_FOLLOW, {});
      yield* settled;
      assert.deepEqual(asked(), [`repositories:${ACME.id}`, "repositories"]);

      const installed = {
        ...ACME,
        githubInstallations: [
          ...(ACME.githubInstallations ?? []),
          { installationId: 9, login: "acme-labs", active: true },
        ],
      };
      service.live.workspaces.set(workspacesLiveRows([PERSONAL, installed]));
      yield* nextPoll(settled);
      assert.deepEqual(
        asked().slice(2).toSorted(),
        [`repositories:${ACME.id}`, "repositories"].toSorted(),
      );

      yield* act("WORKSPACE_TOKEN_REPOSITORY_SET", {
        workspaceId: ACME.id,
        repository: "acme/side",
        added: true,
      });
      yield* settled;
      assert.deepEqual(
        asked().slice(4).toSorted(),
        [`repositories:${ACME.id}`, "repositories"].toSorted(),
      );
    }),
);

it.effect(
  "a plan moved to another workspace answers that workspace, and the list and the open document take it in place",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([invites]);
      service.memberships = [PERSONAL, ACME];
      const { call, last, listed, openTask, description } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* listed();
      yield* openTask(INVITES);

      const moved = yield* call("TASKS_MOVE", {
        taskId: INVITES,
        workspaceId: ACME.id,
      });

      assert.deepEqual(moved, { workspaceId: ACME.id });
      assert.deepEqual(
        last()?.tasks.map((each) => each.workspaceId),
        [ACME.id],
      );
      assert.equal(description(INVITES)?.workspaceId, ACME.id);
    }),
);

it.effect(
  "a plan's status and priority set on the service land in the list and the open document in place",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([invites]);
      const { call, last, openTask, description } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* listAnswers(service, { plans: [rowOfTask(invites)], agents: [], issues: [] });
      yield* openTask(INVITES);

      const changed = yield* call("TASKS_SET_STANDING", {
        taskId: INVITES,
        status: TASK_STATUS.DONE,
        priority: TASK_PRIORITY.HIGH,
      });

      assert.deepEqual(changed, true);
      assert.deepEqual(
        last()?.tasks.map((each) => [each.status, each.priority]),
        [[TASK_STATUS.DONE, TASK_PRIORITY.HIGH]],
      );
      assert.equal(description(INVITES)?.status, TASK_STATUS.DONE);
    }),
);

it.effect(
  "a plan's assignee set on the service lands in the list and the open document in place, and null assigns it to no one",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const { call, last, listed, openTask, description } = yield* subject(fakeService([invites]));
      yield* call("TASKS_REFRESH", undefined);
      yield* listed();
      yield* openTask(INVITES);
      const openAssignee = () => description(INVITES)?.assignee;

      const assigned = yield* call("TASKS_SET_STANDING", {
        taskId: INVITES,
        assigneeId: "user-ada",
      });
      assert.deepEqual(assigned, true);
      assert.deepEqual(
        last()?.tasks.map((each) => each.assignee?.userId),
        ["user-ada"],
      );
      assert.equal(openAssignee()?.userId, "user-ada");

      yield* call("TASKS_SET_STANDING", { taskId: INVITES, assigneeId: null });
      assert.deepEqual(
        last()?.tasks.map((each) => each.assignee),
        [undefined],
      );
      assert.equal(openAssignee(), undefined);
    }),
);

/** A task's record's live read as the service answers it polled, its rows none until a test sets them. */
const recordLive = () =>
  polledLive<RecordPart, typeof NOT_FOUND_LIVE>(["description", "pages", "calls", "code"]);

/** A task's record's live read as the service reads it from `tasks`: the description marked by its last save, and no pages, calls, or code. */
function polledRecord(service: FakeService, taskId: string) {
  return polledLive<RecordPart, typeof NOT_FOUND_LIVE>(
    ["description", "pages", "calls", "code"],
    () => ({
      description: service.tasks
        .filter((each) => each.id === taskId)
        .map((each) => ({ taskId, savedAt: each.updatedAt })),
      pages: [],
      calls: [],
      code: [],
    }),
  );
}

it.effect(
  "a description saved by someone else reaches its held description as its polled mark moves, the task open or not, a read of it that went unanswered asked again, and the window's own save, which the mark only confirms, reads nothing",
  () =>
    Effect.gen(function* () {
      const service = fakeService([
        task(INVITES, "Teammate invitations", INVITES_TEXT, 10),
        task(BILLING, "Billing export", "# Billing export", 20),
      ]);
      const record = polledRecord(service, INVITES);
      service.recordLives[INVITES] = record;
      const { call, last, openTask, description } = yield* subject(service);
      yield* openTask(INVITES);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* followSettled;
      const opens = () => service.reads.filter((read) => read === `open:${INVITES}`).length;
      const opened = opens();
      // The first poll's mark is the save the first read already holds, so nothing reads it again.
      yield* TestClock.adjust(Duration.seconds(5));
      yield* followSettled;
      assert.equal(opens(), opened);

      // The window goes on to another task and lets this one's description go, which stays held among those let go lately.
      yield* openTask(BILLING);
      yield* call(GATEWAY_METHOD.TASKS_DOCUMENT_UNFOLLOW, { taskId: INVITES });
      assert.equal(last()?.activeTaskId, BILLING);

      // A teammate saves the description, which the next poll carries.
      const theirs = `${INVITES_TEXT}\n\nInvites expire after a week.`;
      const held = service.tasks.find((each) => each.id === INVITES);
      assert.ok(held !== undefined);
      service.tasks = service.tasks.map((each) =>
        each.id === INVITES
          ? {
              ...held,
              updatedAt: 20,
              document: { ...held.document, body: theirs },
              lastEdit: { actor: DESCRIPTION_ACTOR.DEVELOPER, at: 20, duringCall: false },
            }
          : each,
      );
      // The first read of it goes unanswered, and is asked again, since the mark it read for stands still.
      service.opensUnanswered = 1;
      record.move();
      yield* TestClock.adjust(Duration.seconds(1));
      yield* followSettled;
      assert.equal(opens(), opened + 1);
      assert.equal(description(INVITES)?.document.body, INVITES_TEXT, "the copy held stands");
      yield* TestClock.adjust(Duration.seconds(2));
      yield* followSettled;
      assert.equal(description(INVITES)?.document.body, theirs);
      assert.equal(opens(), opened + 2);

      // The window's own save is drawn from its answer, which the next poll's mark only confirms.
      const mine = `${theirs}\n\nOnly members invite.`;
      assert.deepEqual(
        yield* call("TASKS_EDIT", {
          taskId: INVITES,
          edit: { document: { base: theirs, value: mine } },
        }),
        { saved: true },
      );
      record.move();
      yield* TestClock.adjust(Duration.seconds(5));
      yield* followSettled;
      assert.equal(description(INVITES)?.document.body, mine);
      assert.equal(opens(), opened + 2);
    }),
);

it.effect(
  "a poll that finds the open task gone ends its record's follow, rather than asking again",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([invites]);
      const record = recordLive();
      service.recordLives[INVITES] = record;
      const { openTask, description } = yield* subject(service);
      yield* openTask(INVITES);
      yield* followSettled;
      yield* answered(() => record.set({ description: [], pages: [], calls: [], code: [] }));
      assert.equal(record.held(), 1);

      // Another member deletes the task, so the poll standing answers it not found.
      record.refuse(NOT_FOUND_LIVE);
      yield* followSettled;
      yield* TestClock.adjust(Duration.hours(1));
      yield* followSettled;
      assert.equal(record.held(), 0);
      const polls = record.polls();
      yield* TestClock.adjust(Duration.hours(1));
      yield* followSettled;
      assert.equal(record.polls(), polls, "a follow whose task is gone asks no more");
      assert.deepEqual(description(INVITES), invites, "the description read stays drawn");
    }),
);

it.effect("a read answering an older save than the held description lands nothing", () =>
  Effect.gen(function* () {
    const invites = task(INVITES, "Teammate invitations", INVITES_TEXT, 10);
    const service = fakeService([invites]);
    const record = polledRecord(service, INVITES);
    service.recordLives[INVITES] = record;
    const { call, openTask, description } = yield* subject(service);
    yield* openTask(INVITES);
    yield* followSettled;
    const mine = `${INVITES_TEXT}\n\nInvites expire.`;
    yield* call("TASKS_EDIT", {
      taskId: INVITES,
      edit: { document: { base: INVITES_TEXT, value: mine } },
    });
    const opens = () => service.reads.filter((read) => read === `open:${INVITES}`).length;
    const opened = opens();

    // A later save moves the mark, but the read it asks answers the description from before the edit, as a store behind the save would.
    const { open } = service;
    service.open = (taskId) =>
      Effect.map(open(taskId), (read) => (read.ok ? { ok: true, answer: invites } : read));
    const [edited] = service.tasks;
    assert.ok(edited !== undefined);
    service.tasks = [{ ...edited, updatedAt: EDITED_AT + 1 }];
    record.move();
    yield* TestClock.adjust(Duration.seconds(1));
    yield* followSettled;

    assert.equal(opens(), opened + 1, "the moved mark asked a read");
    assert.equal(
      description(INVITES)?.document.body,
      mine,
      "the saved description stands over the older read",
    );
  }),
);

it.effect(
  "a pin answered while a read of a plan the list does not hold yet is out keeps the pin the held description took",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", INVITES_TEXT, 10);
      const service = fakeService([invites]);
      service.createAnswer = { ok: true, answer: { task: invites } };
      const record = polledRecord(service, INVITES);
      service.recordLives[INVITES] = record;
      const { call, description, settled } = yield* subject(service);
      yield* call("TASKS_START", { name: "Teammate invitations" });
      yield* followSettled;

      // A teammate's save moves the mark, and the read it asks takes the task as it stands when asked, answering only once let go.
      const answered = yield* Deferred.make<void>();
      const { open } = service;
      service.open = (taskId) =>
        Effect.flatMap(open(taskId), (read) => Effect.as(Deferred.await(answered), read));
      service.tasks = [
        { ...invites, updatedAt: 20, document: { ...invites.document, body: "Theirs." } },
      ];
      record.move();
      yield* TestClock.adjust(Duration.seconds(1));
      yield* followSettled;
      yield* call("TASKS_PIN", { taskId: INVITES, pinned: true });
      assert.equal(description(INVITES)?.pinnedAt, MARKED_AT);

      yield* Deferred.succeed(answered, undefined);
      yield* settled;
      assert.equal(
        description(INVITES)?.pinnedAt,
        MARKED_AT,
        "the read from before the pin lands nothing",
      );
      service.open = open;
      yield* TestClock.adjust(Duration.seconds(2));
      yield* followSettled;
      assert.equal(
        description(INVITES)?.document.body,
        "Theirs.",
        "the save is read again after the pin",
      );
      assert.equal(description(INVITES)?.pinnedAt, MARKED_AT);
    }),
);

const FUNNEL = {
  id: "3f8e2a1b-6c4d-4e5f-8a9b-0c1d2e3f4a5b",
  title: "Invite funnel",
  version: 1,
  at: 1_500,
};

it.effect(
  "a plan's pages held for the Inbox are laid on the app state as they move, never in the view, a read that never answered as failed, kept followed once let go, and dropped with the session",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const { call, told, pushed, reset } = yield* subject(service);
      const held = (read: WireValue) => [
        GATEWAY_EVENT.PAGES_CHANGED,
        { [PAGE_OWNER.TASK]: { [INVITES]: read }, [PAGE_OWNER.AGENT]: {} },
      ];

      yield* call(GATEWAY_METHOD.TASKS_PAGES_FOLLOW, { taskId: INVITES });
      yield* followSettled;
      assert.deepEqual(pushed, [held({ failed: true })]);

      const pages = polledLive<"pages", typeof NOT_FOUND_LIVE>(["pages"]);
      service.pageLives[INVITES] = pages;
      yield* TestClock.adjust(Duration.seconds(2));
      yield* followSettled;
      yield* answered(() => pages.set({ pages: [{ ...FUNNEL, shownBy: null }] }));
      const shown = { ...FUNNEL, version: 2, at: 2_500, shownBy: { kind: PAGE_SHOWER.APP } };
      yield* answered(() => pages.set({ pages: [shown] }));
      assert.deepEqual(pushed.slice(1), [held({ rows: [FUNNEL] }), held({ rows: [shown] })]);
      assert.equal(told.length, 0, "a plan's pages held for the Inbox are never told in the view");

      // Let go, the pages stay followed among those let go lately, so choosing the plan again reads nothing anew.
      yield* call(GATEWAY_METHOD.TASKS_PAGES_UNFOLLOW, { taskId: INVITES });
      yield* followSettled;
      assert.equal(pages.held(), 1);
      yield* call(GATEWAY_METHOD.TASKS_PAGES_FOLLOW, { taskId: INVITES });
      yield* followSettled;
      assert.equal(pushed.length, 3, "a plan held again is drawn from where its pages stand");

      yield* reset;
      yield* followSettled;
      assert.equal(pages.held(), 0);
      assert.deepEqual(
        pushed.findLast(([kind]) => kind === GATEWAY_EVENT.PAGES_CHANGED),
        [GATEWAY_EVENT.PAGES_CHANGED, { [PAGE_OWNER.TASK]: {}, [PAGE_OWNER.AGENT]: {} }],
      );
    }),
);

it.effect(
  "a plan's pages the service refuses are told as failed and asked no more while held, and held anew are asked again",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const pages = polledLive<"pages", typeof NOT_FOUND_LIVE>(["pages"]);
      pages.refuse(NOT_FOUND_LIVE);
      service.pageLives[INVITES] = pages;
      const { liveRead } = service;
      let seals = 0;
      service.liveRead = ((...asked: Parameters<TasksClient["liveRead"]>) =>
        Effect.suspend(() => {
          if (asked[0].name === TASK_PAGES_READ.name) seals += 1;
          return liveRead(...asked);
        })) as TasksClient["liveRead"];
      const { call, pushed } = yield* subject(service);

      yield* call(GATEWAY_METHOD.TASKS_PAGES_FOLLOW, { taskId: INVITES });
      yield* followSettled;
      yield* TestClock.adjust(Duration.minutes(1));
      yield* followSettled;
      assert.equal(seals, 1, "a plan the reader cannot reach is not asked again while held");
      assert.deepEqual(pushed, [
        [
          GATEWAY_EVENT.PAGES_CHANGED,
          { [PAGE_OWNER.TASK]: { [INVITES]: { failed: true } }, [PAGE_OWNER.AGENT]: {} },
        ],
      ]);

      yield* call(GATEWAY_METHOD.TASKS_PAGES_UNFOLLOW, { taskId: INVITES });
      yield* call(GATEWAY_METHOD.TASKS_PAGES_FOLLOW, { taskId: INVITES });
      yield* followSettled;
      assert.equal(seals, 2);
    }),
);

/** A thread on the description, as the window draws it, with its first comment. */
const SEVEN_DAYS: DescriptionCommentThread = {
  id: "1b7c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
  scope: DESCRIPTION_COMMENT_SCOPE.WORDS,
  quote: "Invites",
  anchor: { from: 2, to: 9 },
  section: "Goal",
  status: DESCRIPTION_COMMENT_STATUS.OPEN,
  entries: [
    {
      id: "2c8d3e4f-5a6b-4c7d-9e8f-0a1b2c3d4e5f",
      kind: DESCRIPTION_COMMENT_ENTRY.COMMENT,
      writer: { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, by: { userId: "u1", name: "Dean" } },
      words: "Should this be a setting?",
      at: 0,
    },
  ],
  // Note that it is started before the thread the fake service starts, so a read lists it first.
  createdAt: 0,
  updatedAt: 0,
  revision: 1,
};

/** The rows a subject's comments' live read delivers for `threads`, each entry by a member and with no files. */
function commentRows(threads: readonly DescriptionCommentThread[]) {
  return {
    threads: threads.map((thread) => ({
      id: thread.id,
      scope: thread.scope,
      quote: thread.quote,
      anchorFrom: thread.anchor?.from ?? null,
      anchorTo: thread.anchor?.to ?? null,
      section: thread.section,
      pageId: thread.page?.id ?? null,
      pageVersion: thread.page?.version ?? null,
      pageElement: thread.page?.element ?? null,
      status: thread.status,
      revision: thread.revision,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    })),
    entries: threads.flatMap((thread) =>
      thread.entries.map((entry, seq) => ({
        id: entry.id,
        threadId: thread.id,
        seq,
        kind: entry.kind,
        actor: entry.writer.actor,
        userId: entry.writer.by?.userId ?? null,
        userName: entry.writer.by?.name ?? null,
        agentId: null,
        words: entry.words ?? null,
        askedActor: null,
        askedAgentId: null,
        createdAt: entry.at,
        editedAt: null,
      })),
    ),
    files: [],
  };
}

it.effect(
  "a description's comments and a page's held for a window are laid on the app state apart as they move, never in the view, and dropped with the session",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const description = polledLive<CommentPart, typeof NOT_FOUND_LIVE>([
        "threads",
        "entries",
        "files",
      ]);
      const page = polledLive<CommentPart, typeof NOT_FOUND_LIVE>(["threads", "entries", "files"]);
      service.commentLives[INVITES] = description;
      service.commentLives[FUNNEL.id] = page;
      const { call, told, pushed, reset } = yield* subject(service);
      const onPage = {
        ...SEVEN_DAYS,
        id: "3d9e4f5a-6b7c-4d8e-8f9a-1b2c3d4e5f6a",
        scope: DESCRIPTION_COMMENT_SCOPE.PAGE,
        quote: "Invite funnel",
        page: { id: FUNNEL.id, version: 1 },
        entries: [],
      };
      const { anchor: _anchor, ...withoutAnchor } = onPage;

      yield* call(GATEWAY_METHOD.TASKS_COMMENTS_FOLLOW, { taskId: INVITES });
      yield* call(GATEWAY_METHOD.TASKS_COMMENTS_FOLLOW, { taskId: INVITES, pageId: FUNNEL.id });
      yield* followSettled;
      yield* answered(() => description.set(commentRows([SEVEN_DAYS])));
      yield* answered(() => page.set(commentRows([withoutAnchor])));

      assert.deepEqual(pushed.at(-1), [
        GATEWAY_EVENT.DESCRIPTION_COMMENTS_CHANGED,
        {
          [COMMENT_SUBJECT.DESCRIPTION]: { [INVITES]: { rows: [SEVEN_DAYS] } },
          [COMMENT_SUBJECT.PAGE]: { [FUNNEL.id]: { rows: [withoutAnchor] } },
        },
      ]);
      assert.equal(told.length, 0, "a task's comments are never told in the view");

      yield* reset;
      yield* followSettled;
      assert.equal(description.held() + page.held(), 0);
      assert.deepEqual(
        pushed.findLast(([kind]) => kind === GATEWAY_EVENT.DESCRIPTION_COMMENTS_CHANGED),
        [
          GATEWAY_EVENT.DESCRIPTION_COMMENTS_CHANGED,
          { [COMMENT_SUBJECT.DESCRIPTION]: {}, [COMMENT_SUBJECT.PAGE]: {} },
        ],
      );
    }),
);

it.effect(
  "a resolve draws over its thread at once, stands through a read from before it until the read carries it, and a refused one is taken back",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const description = polledLive<CommentPart, typeof NOT_FOUND_LIVE>([
        "threads",
        "entries",
        "files",
      ]);
      service.commentLives[INVITES] = description;
      const { call, pushed } = yield* subject(service);
      const status = () => {
        const [, held] =
          pushed.findLast(([kind]) => kind === GATEWAY_EVENT.DESCRIPTION_COMMENTS_CHANGED) ?? [];
        const rows = (held as AppDescriptionComments | undefined)?.[COMMENT_SUBJECT.DESCRIPTION][
          INVITES
        ]?.rows;
        return rows?.map((thread) => thread.status);
      };
      const resolve = call("TASKS_COMMENT_ACT", {
        planId: INVITES,
        threadId: SEVEN_DAYS.id,
        action: { action: DESCRIPTION_COMMENT_ACTION.RESOLVE },
      });
      const resolved = { ...SEVEN_DAYS, status: DESCRIPTION_COMMENT_STATUS.RESOLVED, revision: 2 };
      yield* call(GATEWAY_METHOD.TASKS_COMMENTS_FOLLOW, { taskId: INVITES });
      yield* followSettled;
      // An answer Sync woke hands the follow its wait for a write's transaction.
      yield* answered(() => description.set(commentRows([SEVEN_DAYS]), ["tx-earlier"]));

      service.commentGate = Deferred.makeUnsafe<void>();
      service.commentAnswer = { refused: DESCRIPTION_COMMENT_REFUSAL.NOT_YOURS };
      const refused = yield* Effect.forkChild(resolve);
      yield* followSettled;
      assert.deepEqual(
        status(),
        [DESCRIPTION_COMMENT_STATUS.RESOLVED],
        "drawn before the service answers",
      );
      Deferred.doneUnsafe(service.commentGate, Effect.void);
      assert.deepEqual(yield* Fiber.join(refused), {
        refused: DESCRIPTION_COMMENT_REFUSAL.NOT_YOURS,
      });
      assert.deepEqual(status(), [DESCRIPTION_COMMENT_STATUS.OPEN], "taken back once refused");

      service.commentGate = undefined;
      service.commentAnswer = { thread: resolved, txid: "tx-resolve" };
      const kept = yield* Effect.forkChild(resolve);
      yield* followSettled;
      yield* answered(() => description.set(commentRows([SEVEN_DAYS]), ["tx-other"]));
      assert.deepEqual(status(), [DESCRIPTION_COMMENT_STATUS.RESOLVED], "a read from before it");
      yield* answered(() => description.set(commentRows([resolved]), ["tx-resolve"]));
      assert.deepEqual(yield* Fiber.join(kept), { thread: resolved, txid: "tx-resolve" });
      assert.deepEqual(status(), [DESCRIPTION_COMMENT_STATUS.RESOLVED]);
    }),
);

/** One kept tab's row, as the live read delivers it, the agent's pointer on it. */
const SIGN_IN_TAB = {
  id: "7c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  agentId: "8d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a",
  address: "https://example.com/sign-in",
  title: "Sign in",
  openedBy: "agent",
  openedByUserId: null,
  driverUserId: null,
  heldUntil: null,
  createdAt: 1_000,
  lastActedAt: 1_500,
  cursorX: 320,
  cursorY: 200,
  cursorKind: "click",
  cursorViewportW: 1280,
  cursorViewportH: 800,
  cursorAt: 1_500,
} as const;

it.effect(
  "a task's Browser tabs held for the side panel are laid on the app state by kind and id as they move, the agent's pointer among them, laid again as a takeover lapses though let go, never in the view, and dropped with the session",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const { call, told, pushed, reset } = yield* subject(service);
      const held = (read: WireValue) => [
        GATEWAY_EVENT.BROWSER_TABS_CHANGED,
        { [BROWSER_TABS_PLACE.TASK]: { [INVITES]: read }, [BROWSER_TABS_PLACE.AGENT]: {} },
      ];
      const tab = {
        id: SIGN_IN_TAB.id,
        agentId: SIGN_IN_TAB.agentId,
        address: SIGN_IN_TAB.address,
        title: SIGN_IN_TAB.title,
        openedBy: { kind: "agent" },
        createdAt: 1_000,
        lastActedAt: 1_500,
        cursor: {
          x: 320,
          y: 200,
          kind: "click",
          viewport: { width: 1280, height: 800 },
          at: 1_500,
        },
      };

      yield* call(GATEWAY_METHOD.TASKS_BROWSER_TABS_FOLLOW, { taskId: INVITES });
      yield* followSettled;
      assert.deepEqual(pushed, [held({ failed: true })]);

      const tabs = polledLive<"tabs", typeof NOT_FOUND_LIVE>(["tabs"]);
      service.browserTabLives[INVITES] = tabs;
      yield* TestClock.adjust(Duration.seconds(2));
      yield* followSettled;
      // Dana takes the tab over until ten seconds in.
      yield* answered(() =>
        tabs.set({ tabs: [{ ...SIGN_IN_TAB, driverUserId: "user-dana", heldUntil: 10_000 }] }),
      );
      assert.deepEqual(pushed.slice(1), [
        held({ rows: [{ ...tab, driver: { userId: "user-dana", heldUntil: 10_000 } }] }),
      ]);

      // Let go, the tabs stay followed among those let go lately; her window goes away, so the takeover lapses with no row moving.
      yield* call(GATEWAY_METHOD.TASKS_BROWSER_TABS_UNFOLLOW, { taskId: INVITES });
      yield* followSettled;
      assert.equal(tabs.held(), 1);
      yield* TestClock.adjust(Duration.seconds(8));
      yield* followSettled;
      assert.deepEqual(pushed.slice(2), [held({ rows: [{ ...tab, driver: null }] })]);
      assert.equal(told.length, 0, "a task's Browser tabs are never told in the view");

      yield* reset;
      yield* followSettled;
      assert.equal(tabs.held(), 0);
      assert.deepEqual(
        pushed.findLast(([kind]) => kind === GATEWAY_EVENT.BROWSER_TABS_CHANGED),
        [
          GATEWAY_EVENT.BROWSER_TABS_CHANGED,
          { [BROWSER_TABS_PLACE.TASK]: {}, [BROWSER_TABS_PLACE.AGENT]: {} },
        ],
      );
    }),
);

/** One revision as the history's live read delivers its row: saved by Dean by hand at `at`. */
function historyRow(seq: number, at: number) {
  return {
    seq,
    actor: DESCRIPTION_ACTOR.DEVELOPER,
    editorId: "user-dean",
    editorName: "Dean",
    liveSessionId: null,
    agentId: null,
    agentModel: null,
    agentTitle: null,
    callId: null,
    changes: 1,
    restoredFrom: null,
    at,
    startedAt: at,
    restoredAt: null,
  };
}

/** One revision as the version history lists it, from the row `historyRow` delivers. */
function historyLine(seq: number, at: number) {
  return {
    seq,
    lastEdit: {
      actor: DESCRIPTION_ACTOR.DEVELOPER,
      by: { userId: "user-dean", name: "Dean" },
      at,
      duringCall: false,
    },
    startedAt: at,
    changes: 1,
  };
}

/** The revisions `newest` down to `oldest`, newest first. */
function revisionsFrom(newest: number, oldest: number): readonly number[] {
  return Array.from({ length: newest - oldest + 1 }, (_, back) => newest - back);
}

it.effect(
  "a description's newest page of history held for a window is laid on the app state as saves land, never in the view, kept followed once let go, and dropped with the session",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const history = polledLive<"revisions">(["revisions"]);
      service.historyLives[INVITES] = history;
      const { call, told, pushed, reset } = yield* subject(service);
      const held = (read: WireValue) => [GATEWAY_EVENT.HISTORIES_CHANGED, { [INVITES]: read }];

      yield* call(GATEWAY_METHOD.TASKS_HISTORY_FOLLOW, { taskId: INVITES });
      yield* followSettled;
      yield* answered(() => history.set({ revisions: [historyRow(1, 1_000)] }));
      yield* answered(() =>
        history.set({ revisions: [historyRow(2, 2_000), historyRow(1, 1_000)] }),
      );
      assert.deepEqual(pushed, [
        held({ rows: { revisions: [historyLine(1, 1_000)] } }),
        held({ rows: { revisions: [historyLine(2, 2_000), historyLine(1, 1_000)] } }),
      ]);
      assert.equal(told.length, 0, "a description's history is never told in the view");

      // Let go, the history stays followed among those let go lately, so its version history opened again reads nothing anew.
      yield* call(GATEWAY_METHOD.TASKS_HISTORY_UNFOLLOW, { taskId: INVITES });
      yield* followSettled;
      assert.equal(history.held(), 1);
      yield* call(GATEWAY_METHOD.TASKS_HISTORY_FOLLOW, { taskId: INVITES });
      yield* followSettled;
      assert.equal(pushed.length, 2, "a history held again is drawn from where it stands");

      yield* reset;
      yield* followSettled;
      assert.equal(history.held(), 0);
      assert.deepEqual(
        pushed.findLast(([kind]) => kind === GATEWAY_EVENT.HISTORIES_CHANGED),
        [GATEWAY_EVENT.HISTORIES_CHANGED, {}],
      );
    }),
);

it.effect("an older page laid into a held history stays when a save lands a new newest page", () =>
  Effect.gen(function* () {
    const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
    const history = polledLive<"revisions">(["revisions"]);
    service.historyLives[INVITES] = history;
    // The service delivers one revision past a page of fifty, so the page reads that an older one stands, here before 3.
    const rows = (newest: number, oldest: number) =>
      revisionsFrom(newest, oldest).map((seq) => historyRow(seq, seq * 1_000));
    const lines = (newest: number, oldest: number) =>
      revisionsFrom(newest, oldest).map((seq) => historyLine(seq, seq * 1_000));
    service.olderHistory[3] = { revisions: lines(2, 1) };
    const { call, pushed } = yield* subject(service);
    const heldNow = () => pushed.findLast(([kind]) => kind === GATEWAY_EVENT.HISTORIES_CHANGED);

    yield* call(GATEWAY_METHOD.TASKS_HISTORY_FOLLOW, { taskId: INVITES });
    yield* followSettled;
    yield* answered(() => history.set({ revisions: rows(52, 2) }));
    assert.deepEqual(heldNow(), [
      GATEWAY_EVENT.HISTORIES_CHANGED,
      { [INVITES]: { rows: { revisions: lines(52, 3), earlier: 3 } } },
    ]);

    // The reader scrolls back: the older page is answered, and laid after the newest.
    assert.deepEqual(yield* call("TASKS_REVISIONS", { taskId: INVITES, before: 3 }), {
      revisions: lines(2, 1),
    });
    assert.deepEqual(heldNow(), [
      GATEWAY_EVENT.HISTORIES_CHANGED,
      { [INVITES]: { rows: { revisions: lines(52, 1) } } },
    ]);

    // A save lands a newest page that reaches back only to 4, and the versions read past it stay.
    yield* answered(() => history.set({ revisions: rows(53, 3) }));
    assert.deepEqual(heldNow(), [
      GATEWAY_EVENT.HISTORIES_CHANGED,
      { [INVITES]: { rows: { revisions: lines(53, 1) } } },
    ]);
  }),
);

it.effect(
  "a restore puts the revision back and is answered once the history held for its version history carries its transaction",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      service.revisions[1] = {
        seq: 1,
        document: { body: "# Invites", assumptions: [] },
        previous: null,
      };
      const history = polledLive<"revisions">(["revisions"]);
      service.historyLives[INVITES] = history;
      const { call } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_HISTORY_FOLLOW, { taskId: INVITES });
      yield* followSettled;
      // An answer Sync woke hands the held history its wait for a write's transaction.
      yield* answered(() => history.set({ revisions: [historyRow(1, 1_000)] }, ["tx-earlier"]));

      const restoring = yield* Effect.forkChild(call("TASKS_RESTORE", { taskId: INVITES, seq: 1 }));
      yield* followSettled;
      assert.equal(restoring.pollUnsafe(), undefined, "no answer before the history carries it");
      yield* answered(() =>
        history.set({ revisions: [historyRow(2, 2_000), historyRow(1, 1_000)] }, ["txid-1"]),
      );
      assert.deepEqual(yield* Fiber.join(restoring), true);
    }),
);

/** The instant the live list is read at, which the test's clock is set to. */
const LIVE_NOW = 1_800_000_000_000;

/** One agent of the plan, or of none, as the agents statement delivers its row, started `ago` before the list is read, with no turn yet. */
function agentRow(planId: string | null, ago: number) {
  return agentListRow(planId, LIVE_NOW - ago);
}

it.effect(
  "a list that could not be read says so beside what it drew and is read again, and a read refused as signed out ends the follow",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(LIVE_NOW);
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      service.live.list.refuse({ failure: TASK_CALL_FAILURE.UNANSWERED });
      const { call, last, settled } = yield* subject(service);

      yield* call("TASKS_REFRESH", undefined);
      yield* settled;
      assert.equal(last()?.listStatus, TASKS_READ.FAILED);
      assert.equal(last()?.live, HOST_LIVE.OFFLINE, "a service that answers no read is offline");

      service.live.list.refuse(undefined);
      yield* TestClock.adjust(Duration.seconds(5));
      yield* listAnswers(service, {
        plans: [taskRow(INVITES, "Teammate invitations, live")],
        agents: [],
        issues: [],
      });
      assert.equal(last()?.listStatus, TASKS_READ.READY);
      assert.equal(last()?.live, HOST_LIVE.LIVE);
      assert.equal(last()?.tasks[0]?.name, "Teammate invitations, live");

      // The session is another account's now: the poll standing is refused for good.
      service.live.list.refuse({ failure: LIVE_SIGNED_OUT.failure });
      yield* settled;
      yield* TestClock.adjust(Duration.seconds(30));
      yield* settled;
      const asked = [service.liveListReads, service.live.list.polls()];
      yield* TestClock.adjust(Duration.minutes(1));
      yield* settled;
      assert.deepEqual(
        [service.liveListReads, service.live.list.polls()],
        asked,
        "a follow refused as signed out asks no more",
      );
      assert.equal(last()?.tasks[0]?.name, "Teammate invitations, live");
    }),
);

it.effect(
  "a task the service no longer lists leaves the list as an answer past its sync id names it gone, and the rest stand",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const { call, last } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* listAnswers(service, {
        plans: [taskRow(INVITES, "Teammate invitations"), taskRow(BILLING, "Billing export")],
        agents: [],
        issues: [],
      });
      assert.deepEqual(
        last()
          ?.tasks.map((row) => row.id)
          .toSorted(),
        [BILLING, INVITES].toSorted(),
      );

      // Another member deleted the billing task, and nothing else moved.
      yield* listAnswers(service, { plans: [taskRow(INVITES, "Teammate invitations")] });

      assert.deepEqual(
        last()?.tasks.map((row) => row.id),
        [INVITES],
      );
    }),
);

it.effect(
  "the list is drawn from its live rows, and an agent with no turn reads failed once its grace ends with nothing read",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(LIVE_NOW);
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const { call, last, settled } = yield* subject(service);

      yield* call("TASKS_REFRESH", undefined);
      yield* listAnswers(service, {
        plans: [taskRow(INVITES, "Teammate invitations, live")],
        agents: [agentRow(INVITES, 60_000)],
        issues: [],
      });
      const drawn = last()?.tasks[0];
      assert.equal(drawn?.name, "Teammate invitations, live");
      assert.deepEqual(
        [drawn?.agents?.working, last()?.taskAgents?.map((each) => each.status)],
        [1, [AGENT_STATUS.STARTING]],
      );
      assert.deepEqual(
        last()?.taskAgents?.map((each) => [each.planId, each.status, each.turnId]),
        [[INVITES, AGENT_STATUS.STARTING, null]],
      );

      yield* call("TASKS_REFRESH", undefined);
      yield* call("TASKS_DELETE", { taskId: BILLING });
      yield* TestClock.adjust(Duration.minutes(5));
      yield* settled;

      assert.deepEqual(
        [last()?.tasks[0]?.agents?.working, last()?.taskAgents?.map((each) => each.status)],
        [0, [AGENT_STATUS.FAILED]],
      );
    }),
);

it.effect(
  "an agent whose line no turn takes reads running in the live list until the line's grace ends, then failed with nothing read",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(LIVE_NOW);
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const { call, last, settled } = yield* subject(service);

      yield* call("TASKS_REFRESH", undefined);
      yield* listAnswers(service, {
        plans: [taskRow(INVITES, "Teammate invitations, live")],
        // A settled turn, and a line written after it that no turn has taken yet.
        agents: [
          {
            ...agentRow(INVITES, 30 * 60_000),
            turnId: "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d",
            turnStatus: TURN_STATUS.SETTLED,
            cancelRequested: false,
            queuedAt: LIVE_NOW - 20 * 60_000,
            startedAt: LIVE_NOW - 20 * 60_000,
            settledAt: LIVE_NOW - 10 * 60_000,
            turnSessionEnded: false,
            awaitingLineAt: LIVE_NOW - 60_000,
          },
        ],
        issues: [],
      });
      assert.equal(last()?.tasks[0]?.name, "Teammate invitations, live", "the list is drawn live");
      assert.deepEqual(
        last()?.taskAgents?.map((each) => each.status),
        [AGENT_STATUS.RUNNING],
      );
      yield* TestClock.adjust(Duration.minutes(3));
      yield* settled;
      assert.deepEqual(
        last()?.taskAgents?.map((each) => each.status),
        [AGENT_STATUS.RUNNING],
        "inside the line's grace",
      );
      yield* TestClock.adjust(Duration.minutes(2));
      yield* settled;
      assert.deepEqual(
        last()?.taskAgents?.map((each) => each.status),
        [AGENT_STATUS.FAILED],
        "the line's grace ran out with no row moving",
      );
    }),
);

it.effect(
  "a list whose rows stop decoding keeps what it drew and says it is catching up, and is live again once it is read again",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(LIVE_NOW);
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const { call, last, settled } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* listAnswers(service, {
        plans: [taskRow(INVITES, "Teammate invitations, live")],
        agents: [],
        issues: [],
      });
      assert.equal(last()?.live, HOST_LIVE.LIVE);

      // A deploy changed the row's shape, so it no longer decodes, and the poll asked again within a second fails the same way.
      yield* listAnswers(service, { plans: [{ id: INVITES, title: "Teammate invitations" }] });
      yield* TestClock.adjust(Duration.seconds(1));
      yield* settled;
      assert.equal(last()?.live, HOST_LIVE.CATCHING_UP);
      assert.equal(last()?.listStatus, TASKS_READ.READY, "the list drawn stands");
      assert.equal(last()?.tasks[0]?.name, "Teammate invitations, live");

      // The rows decode again by the time the follow starts again, a pause later.
      service.live.list.set({ plans: [taskRow(INVITES, "Teammate invitations, again")] });
      yield* TestClock.adjust(Duration.seconds(5));
      yield* settled;
      assert.equal(last()?.live, HOST_LIVE.LIVE);
      assert.equal(last()?.tasks[0]?.name, "Teammate invitations, again");
    }),
);

it.effect(
  "a resync reads a followed list again at once, once for a wake's several events, without saying it is behind, and asks nothing of a list not followed; a regain right after a wake reads it again",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(LIVE_NOW);
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const { call, last, told, settled } = yield* subject(service);

      yield* call(GATEWAY_METHOD.TASKS_RESYNC);
      yield* settled;
      assert.equal(service.liveListReads, 0, "nothing is followed before the Tasks tab asks");

      yield* call("TASKS_REFRESH", undefined);
      yield* listAnswers(service, {
        plans: [taskRow(INVITES, "Teammate invitations, live")],
        agents: [],
        issues: [],
      });
      const before = service.liveListReads;
      const toldBefore = told.length;

      // The Mac woke: a resume and an unlock land together.
      yield* call(GATEWAY_METHOD.TASKS_RESYNC);
      yield* call(GATEWAY_METHOD.TASKS_RESYNC);
      yield* settled;
      assert.equal(service.liveListReads, before + 1, "one wake reads the list once");
      assert.ok(
        told.slice(toldBefore).every((view) => view.live !== HOST_LIVE.CATCHING_UP),
        "a read asked again is loading, not behind",
      );
      assert.equal(last()?.live, HOST_LIVE.LIVE);

      // The connection comes back a moment after the wake, which may have read the list before the network was there.
      yield* call(GATEWAY_METHOD.TASKS_REGAINED);
      yield* settled;
      assert.equal(service.liveListReads, before + 2, "a regain reads the list again");

      yield* TestClock.adjust(Duration.seconds(10));
      const later = service.liveListReads;
      yield* call(GATEWAY_METHOD.TASKS_RESYNC);
      yield* settled;
      assert.equal(service.liveListReads, later + 1, "a later wake reads it again");
    }),
);

it.effect(
  "a teammate's change to the open task's status, assignee, and repository reaches its held description as the live list carries it, its body and last save kept",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([invites]);
      const { call, openTask, description } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* listAnswers(service, { plans: [rowOfTask(invites)], agents: [], issues: [] });
      yield* openTask(INVITES);
      const standing = () => {
        const open = description(INVITES);
        return [
          open?.status,
          open?.assignee,
          open?.repository,
          open?.document.body,
          open?.updatedAt,
        ];
      };

      yield* listAnswers(service, {
        plans: [
          {
            ...rowOfTask(invites),
            status: TASK_STATUS.IN_PROGRESS,
            assigneeId: ADA.userId,
            assigneeName: ADA.name,
            repository: "acme/relay",
            updatedAt: 20,
          },
        ],
      });
      assert.deepEqual(standing(), [
        TASK_STATUS.IN_PROGRESS,
        { userId: ADA.userId, name: ADA.name },
        "acme/relay",
        "# Teammate invitations",
        10,
      ]);

      // A row that names no assignee is a task assigned to no one.
      yield* listAnswers(service, { plans: [{ ...rowOfTask(invites), status: TASK_STATUS.DONE }] });
      assert.deepEqual(standing(), [
        TASK_STATUS.DONE,
        undefined,
        null,
        "# Teammate invitations",
        10,
      ]);
    }),
);
