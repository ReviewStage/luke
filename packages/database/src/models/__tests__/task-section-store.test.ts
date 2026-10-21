import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { sidebarLiveRowsSchema, sidebarOfLiveRows } from "@luke/features/sidebar-live";
import {
  TASK_SECTION_GLYPH,
  TASK_SECTION_ICON_KIND,
  TASK_SECTION_WRITE,
  type TaskSections,
  type TaskSectionWrite,
} from "@luke/features/task-section-wire";
import { eq } from "drizzle-orm";
import { Clock, Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { organization, user } from "../../schemas/auth.js";
import { codingAgent } from "../../schemas/coding-agent.js";
import { conversations } from "../../schemas/storage.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB, joinWorkspace, leaveWorkspace, openWorkspace } from "../../testing/index.js";
import {
  listRepositoryPins,
  repositoryPinsLiveStatement,
  setRepositoryPin,
} from "../repository-pin-store.js";
import {
  deleteTaskSectionIn,
  listTaskSections,
  taskSectionsLiveStatements,
  writeTaskSections,
} from "../task-section-store.js";
import { createTask, deleteTask, updateTask } from "../task-store.js";

/**
 * A section is its maker's own: two members of one workspace share its
 * tasks, and each reads only the sections they made and the tasks they put
 * in them, through the store's public reads and writes, over a real
 * dialect. A task stands in one section at a time, deleting a section
 * deletes none of its tasks, and nobody puts a task in a section that is
 * not theirs or a task of another workspace in one. An agent with no task
 * is kept on the same terms beside the tasks.
 *
 * Synthetic accounts, workspaces, sections, and tasks throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** Dean's workspace with Charles a member of it, and two tasks Dean started there. */
const openSharedWorkspace = Effect.gen(function* () {
  const dean = yield* openAccount;
  const charles = yield* openAccount;
  const workspace = yield* openWorkspace(dean);
  yield* joinWorkspace(workspace, charles);
  const { id: first } = yield* createTask(dean, { name: "Invites", organizationId: workspace });
  const { id: second } = yield* createTask(dean, { name: "Billing", organizationId: workspace });
  return { dean, charles, workspace, first, second };
});

/** An agent with no task the account started in the workspace, or on the task given. */
const openAgent = (userId: string, organizationId: string, taskId?: string) =>
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
      conversationId,
      ...(taskId === undefined ? undefined : { taskId, planId: taskId }),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      prompt: "Sweep the flaky tests.",
      repository: "acme/api",
      repositories: ["acme/api"],
      idempotencyKey: randomUUID(),
    });
    return id;
  });

/** A write the test expects taken, answering the sections as they then stand and the transaction it wrote them in. */
const writtenWithTxid = (userId: string, write: TaskSectionWrite) =>
  Effect.map(writeTaskSections(userId, write), (answer) =>
    Option.getOrElse(answer, () => assert.fail("the write was refused")),
  );

/** A write the test expects taken, answering the sections as they then stand. */
const written = (userId: string, write: TaskSectionWrite) =>
  Effect.map(
    writtenWithTxid(userId, write),
    ({ txid: _txid, ...sections }): TaskSections => sections,
  );

const refused = (userId: string, write: TaskSectionWrite) =>
  Effect.map(writeTaskSections(userId, write), Option.isNone);

const create = (workspaceId: string, title: string, id = randomUUID()): TaskSectionWrite => ({
  kind: TASK_SECTION_WRITE.CREATE,
  id,
  workspaceId,
  title,
});

const place = (taskId: string, sectionId: string | null, position?: string): TaskSectionWrite => ({
  kind: TASK_SECTION_WRITE.PLACE,
  taskId,
  sectionId,
  ...(position === undefined ? undefined : { position }),
});

const placeAgent = (
  agentId: string,
  sectionId: string | null,
  position?: string,
): TaskSectionWrite => ({
  kind: TASK_SECTION_WRITE.PLACE_AGENT,
  agentId,
  sectionId,
  ...(position === undefined ? undefined : { position }),
});

/** The sidebar as the desktop builds it from the live statements' rows, run as Realtime runs them. */
const liveSidebarOf = (userId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const sections = Option.getOrThrow(taskSectionsLiveStatements(userId));
    const pins = Option.getOrThrow(repositoryPinsLiveStatement(userId));
    const rows = yield* Effect.all({
      sections: sql.unsafe(sections.sections.sql, [...sections.sections.params]),
      entries: sql.unsafe(sections.entries.sql, [...sections.entries.params]),
      agentEntries: sql.unsafe(sections.agentEntries.sql, [...sections.agentEntries.params]),
      pins: sql.unsafe(pins.sql, [...pins.params]),
    });
    return sidebarOfLiveRows(yield* Schema.decodeUnknownEffect(sidebarLiveRowsSchema)(rows));
  });

it.layer(getTestDB())("an account's task sections", (it) => {
  it.effect(
    "the live statements deliver the sections, their tasks, and the pins the held reads answer, to their maker, and none of them to a teammate or an outsider",
    () =>
      Effect.gen(function* () {
        const { dean, charles, workspace, first, second } = yield* openSharedWorkspace;
        const outsider = yield* openAccount;
        yield* openWorkspace(outsider);
        const launch = randomUUID();
        const later = randomUUID();
        yield* written(dean, create(workspace, "Launch", launch));
        yield* TestClock.adjust("1 minute");
        yield* written(dean, create(workspace, "Later", later));
        const icon = { kind: TASK_SECTION_ICON_KIND.GLYPH, glyph: TASK_SECTION_GLYPH.ROCKET };
        yield* written(dean, { kind: TASK_SECTION_WRITE.EDIT, id: later, title: "Later", icon });
        yield* written(dean, { kind: TASK_SECTION_WRITE.MOVE, id: later, position: "a0" });
        yield* written(dean, place(first, launch));
        yield* TestClock.adjust("1 minute");
        yield* written(dean, place(second, launch, "a1"));
        yield* written(dean, placeAgent(yield* openAgent(dean, workspace), later, "a0"));
        yield* setRepositoryPin(dean, "acme/relay", true);
        yield* TestClock.adjust("1 minute");
        yield* setRepositoryPin(dean, "acme/web", true);

        for (const reader of [dean, charles, outsider]) {
          assert.deepEqual(yield* liveSidebarOf(reader), {
            taskSections: yield* listTaskSections(reader),
            repositoryPins: yield* listRepositoryPins(reader),
          });
        }
        const deans = yield* liveSidebarOf(dean);
        assert.deepEqual(
          [
            deans.taskSections.sections.length,
            deans.taskSections.entries.length,
            deans.taskSections.agentEntries.length,
          ],
          [2, 2, 1],
        );
        assert.deepEqual(
          deans.repositoryPins.map((pin) => pin.repository),
          ["acme/web", "acme/relay"],
        );
        assert.deepEqual(yield* liveSidebarOf(outsider), {
          taskSections: { sections: [], entries: [], agentEntries: [] },
          repositoryPins: [],
        });
      }),
  );

  it.effect("a section and the tasks in it are its maker's alone", () =>
    Effect.gen(function* () {
      const { dean, charles, workspace, first } = yield* openSharedWorkspace;
      const id = randomUUID();
      const madeAt = yield* Clock.currentTimeMillis;
      yield* written(dean, create(workspace, "Launch", id));

      const answer = yield* written(dean, place(first, id));

      assert.deepEqual(answer.sections, [
        { id, workspaceId: workspace, title: "Launch", createdAt: madeAt },
      ]);
      assert.deepEqual(answer.entries, [{ taskId: first, sectionId: id, addedAt: madeAt }]);
      assert.deepEqual(yield* listTaskSections(charles), {
        sections: [],
        entries: [],
        agentEntries: [],
      });
      assert.equal(yield* refused(charles, place(first, id)), true);
      assert.equal(
        yield* refused(charles, { kind: TASK_SECTION_WRITE.MOVE, id, position: "a1" }),
        true,
      );
      yield* written(charles, { kind: TASK_SECTION_WRITE.DELETE, id });
      assert.equal((yield* listTaskSections(dean)).sections.length, 1);
    }),
  );

  it.effect("a section is edited and moved, and made twice under one id stands once", () =>
    Effect.gen(function* () {
      const { dean, workspace } = yield* openSharedWorkspace;
      const id = randomUUID();
      yield* written(dean, create(workspace, "Launch", id));
      yield* written(dean, create(workspace, "Launch again", id));
      const icon = { kind: TASK_SECTION_ICON_KIND.GLYPH, glyph: TASK_SECTION_GLYPH.ROCKET };

      yield* written(dean, { kind: TASK_SECTION_WRITE.EDIT, id, title: "Ship it", icon });
      const moved = yield* written(dean, { kind: TASK_SECTION_WRITE.MOVE, id, position: "a2" });
      assert.deepEqual(
        moved.sections.map(({ title, icon, position }) => ({ title, icon, position })),
        [{ title: "Ship it", icon, position: "a2" }],
      );

      const cleared = yield* written(dean, {
        kind: TASK_SECTION_WRITE.EDIT,
        id,
        title: "Ship it",
        icon: null,
      });
      assert.equal(cleared.sections[0]?.icon, undefined);
    }),
  );

  it.effect("a task stands in one section, and moving within it keeps when it was put there", () =>
    Effect.gen(function* () {
      const { dean, workspace, first } = yield* openSharedWorkspace;
      const launch = randomUUID();
      const later = randomUUID();
      yield* written(dean, create(workspace, "Launch", launch));
      yield* written(dean, create(workspace, "Later", later));
      const addedAt = yield* Clock.currentTimeMillis;
      yield* written(dean, place(first, launch));
      yield* TestClock.adjust("1 minute");

      const reordered = yield* written(dean, place(first, launch, "a1"));
      assert.deepEqual(reordered.entries, [
        { taskId: first, sectionId: launch, position: "a1", addedAt },
      ]);

      const movedAt = yield* Clock.currentTimeMillis;
      const moved = yield* written(dean, place(first, later));
      assert.deepEqual(moved.entries, [{ taskId: first, sectionId: later, addedAt: movedAt }]);

      const out = yield* written(dean, place(first, null));
      assert.deepEqual(out.entries, []);
    }),
  );

  it.effect("deleting a section puts its tasks back and deletes none of them", () =>
    Effect.gen(function* () {
      const { dean, workspace, first, second } = yield* openSharedWorkspace;
      const id = randomUUID();
      yield* written(dean, create(workspace, "Launch", id));
      yield* written(dean, place(first, id));
      yield* written(dean, place(second, id));

      const answer = yield* written(dean, { kind: TASK_SECTION_WRITE.DELETE, id });

      assert.deepEqual(answer, { sections: [], entries: [], agentEntries: [] });
      assert.equal(Option.isSome(yield* updateTask(dean, first, { name: "Invites" })), true);
    }),
  );

  it.effect(
    "a delete in a workspace answers the section it took and the tasks that went back, once, and takes none of another workspace's or another account's",
    () =>
      Effect.gen(function* () {
        const { dean, charles, workspace, first, second } = yield* openSharedWorkspace;
        const elsewhere = yield* openWorkspace(dean);
        const id = randomUUID();
        yield* written(dean, create(workspace, "Launch", id));
        yield* written(dean, place(first, id));
        yield* written(dean, place(second, id));

        assert.ok(Option.isNone(yield* deleteTaskSectionIn(dean, elsewhere, id)));
        assert.ok(Option.isNone(yield* deleteTaskSectionIn(charles, workspace, id)));
        const deleted = yield* deleteTaskSectionIn(dean, workspace, id);
        assert.deepEqual(
          Option.map(deleted, ({ section, returnedTasks }) => [
            section.id,
            section.title,
            returnedTasks,
          ]),
          Option.some([id, "Launch", 2]),
        );
        assert.ok(
          Option.isNone(yield* deleteTaskSectionIn(dean, workspace, id)),
          "a second delete takes nothing",
        );
        assert.deepEqual(yield* listTaskSections(dean), {
          sections: [],
          entries: [],
          agentEntries: [],
        });
      }),
  );

  it.effect("a section is made only in a workspace its maker is a member of", () =>
    Effect.gen(function* () {
      const { workspace } = yield* openSharedWorkspace;
      const outsider = yield* openAccount;

      assert.equal(yield* refused(outsider, create(workspace, "Not mine")), true);
      assert.deepEqual(yield* listTaskSections(outsider), {
        sections: [],
        entries: [],
        agentEntries: [],
      });
    }),
  );

  it.effect(
    "a task of another workspace is put in no section, and one moved away and back stands in none",
    () =>
      Effect.gen(function* () {
        const { dean, workspace, first } = yield* openSharedWorkspace;
        const elsewhere = yield* openWorkspace(dean);
        const { id: other } = yield* createTask(dean, { name: "Other", organizationId: elsewhere });
        const id = randomUUID();
        yield* written(dean, create(workspace, "Launch", id));

        assert.equal(yield* refused(dean, place(other, id)), true);

        yield* written(dean, place(first, id));
        assert.equal(
          Option.isSome(yield* updateTask(dean, first, { organizationId: elsewhere })),
          true,
        );
        assert.deepEqual((yield* listTaskSections(dean)).entries, []);
        // Moved back, it stands in none of the sections it left.
        yield* updateTask(dean, first, { organizationId: workspace });
        assert.deepEqual((yield* listTaskSections(dean)).entries, []);
      }),
  );

  it.effect("a section goes with its account and its workspace, and an entry with its task", () =>
    Effect.gen(function* () {
      const { dean, charles, workspace, first, second } = yield* openSharedWorkspace;
      const deans = randomUUID();
      yield* written(dean, create(workspace, "Launch", deans));
      yield* written(dean, place(first, deans));
      yield* written(dean, place(second, deans));
      yield* written(charles, create(workspace, "Mine"));

      assert.equal(yield* deleteTask(dean, first), true);
      assert.deepEqual(
        (yield* listTaskSections(dean)).entries.map(({ taskId }) => taskId),
        [second],
      );
      yield* Database.use((db) => db.delete(user).where(eq(user.id, charles)));
      yield* Database.use((db) => db.delete(organization).where(eq(organization.id, workspace)));
      assert.deepEqual(yield* listTaskSections(dean), {
        sections: [],
        entries: [],
        agentEntries: [],
      });
    }),
  );

  it.effect(
    "a write that changes a row answers the transaction it wrote in, which the live sidebar waits for, and one that changes nothing answers none",
    () =>
      Effect.gen(function* () {
        const { dean, workspace, first } = yield* openSharedWorkspace;
        const txidOf = (write: TaskSectionWrite) =>
          Effect.map(writtenWithTxid(dean, write), (answer) => answer.txid);
        const isTxid = (txid: string | undefined) => txid !== undefined && /^\d+$/u.test(txid);
        const launch = randomUUID();
        const icon = { kind: TASK_SECTION_ICON_KIND.GLYPH, glyph: TASK_SECTION_GLYPH.ROCKET };
        const edit: TaskSectionWrite = {
          kind: TASK_SECTION_WRITE.EDIT,
          id: launch,
          title: "Ship",
          icon,
        };
        const move: TaskSectionWrite = {
          kind: TASK_SECTION_WRITE.MOVE,
          id: launch,
          position: "a0",
        };
        const remove: TaskSectionWrite = { kind: TASK_SECTION_WRITE.DELETE, id: launch };

        const made = yield* txidOf(create(workspace, "Launch", launch));
        const madeAgain = yield* txidOf(create(workspace, "Launch", launch));
        const edited = yield* txidOf(edit);
        const editedAgain = yield* txidOf(edit);
        const moved = yield* txidOf(move);
        const movedAgain = yield* txidOf(move);
        const placed = yield* txidOf(place(first, launch));
        const placedAgain = yield* txidOf(place(first, launch));
        const placedAt = yield* txidOf(place(first, launch, "a1"));
        const placedAtAgain = yield* txidOf(place(first, launch, "a1"));
        const unplaced = yield* txidOf(place(first, null));
        const unplacedAgain = yield* txidOf(place(first, null));
        const deleted = yield* txidOf(remove);
        const deletedAgain = yield* txidOf(remove);

        const changed = [made, edited, moved, placed, placedAt, unplaced, deleted];
        assert.ok(
          changed.every(isTxid),
          `every write that changed a row answers a txid: ${changed}`,
        );
        assert.equal(new Set(changed).size, changed.length, "each write is its own transaction");
        assert.deepEqual(
          [
            madeAgain,
            editedAgain,
            movedAgain,
            placedAgain,
            placedAtAgain,
            unplacedAgain,
            deletedAgain,
          ],
          Array.from({ length: 7 }, () => undefined),
        );

        const pinned = yield* setRepositoryPin(dean, "acme/relay", true);
        const pinnedAgain = yield* setRepositoryPin(dean, "acme/relay", true);
        const unpinned = yield* setRepositoryPin(dean, "acme/relay", false);
        const unpinnedAgain = yield* setRepositoryPin(dean, "acme/relay", false);
        const txids = [pinned, pinnedAgain, unpinned, unpinnedAgain].map(
          (answer) => Option.getOrThrow(answer).txid,
        );
        assert.ok(isTxid(txids[0]) && isTxid(txids[2]) && txids[0] !== txids[2]);
        assert.deepEqual([txids[1], txids[3]], [undefined, undefined]);
        assert.deepEqual(
          Option.getOrThrow(pinnedAgain).pins.map((pin) => pin.repository),
          ["acme/relay"],
        );
      }),
  );

  it.effect(
    "an agent with no task stands in one of its reader's sections, and no other account reads or moves it",
    () =>
      Effect.gen(function* () {
        const { dean, charles, workspace } = yield* openSharedWorkspace;
        const outsider = yield* openAccount;
        const agent = yield* openAgent(dean, workspace);
        const launch = randomUUID();
        const later = randomUUID();
        yield* written(dean, create(workspace, "Launch", launch));
        yield* written(dean, create(workspace, "Later", later));
        const addedAt = yield* Clock.currentTimeMillis;

        const placed = yield* written(dean, placeAgent(agent, launch));
        assert.deepEqual(placed.agentEntries, [{ agentId: agent, sectionId: launch, addedAt }]);
        yield* TestClock.adjust("1 minute");
        const reordered = yield* written(dean, placeAgent(agent, launch, "a1"));
        assert.deepEqual(reordered.agentEntries, [
          { agentId: agent, sectionId: launch, position: "a1", addedAt },
        ]);

        // A teammate who reaches the agent still reads none of Dean's entries, nor puts it in his section.
        assert.deepEqual((yield* listTaskSections(charles)).agentEntries, []);
        assert.equal(yield* refused(charles, placeAgent(agent, launch)), true);
        assert.equal(yield* refused(outsider, placeAgent(agent, launch)), true);
        const charlesSection = randomUUID();
        yield* written(charles, create(workspace, "Mine", charlesSection));
        yield* written(charles, placeAgent(agent, charlesSection));
        assert.deepEqual(
          (yield* listTaskSections(dean)).agentEntries.map(({ sectionId }) => sectionId),
          [launch],
        );

        const movedAt = yield* Clock.currentTimeMillis;
        const moved = yield* written(dean, placeAgent(agent, later));
        assert.deepEqual(moved.agentEntries, [
          { agentId: agent, sectionId: later, addedAt: movedAt },
        ]);
        const out = yield* written(dean, placeAgent(agent, null));
        assert.deepEqual(out.agentEntries, []);
      }),
  );

  it.effect(
    "an agent on a task, of another workspace, or one its reader no longer reaches is put in no section",
    () =>
      Effect.gen(function* () {
        const { dean, charles, workspace, first } = yield* openSharedWorkspace;
        const elsewhere = yield* openWorkspace(dean);
        const onTask = yield* openAgent(dean, workspace, first);
        const away = yield* openAgent(dean, elsewhere);
        const id = randomUUID();
        yield* written(dean, create(workspace, "Launch", id));

        assert.equal(yield* refused(dean, placeAgent(onTask, id)), true);
        assert.equal(yield* refused(dean, placeAgent(away, id)), true);

        const shared = yield* openAgent(dean, workspace);
        const mine = randomUUID();
        yield* written(charles, create(workspace, "Mine", mine));
        yield* written(charles, placeAgent(shared, mine));
        assert.equal((yield* listTaskSections(charles)).agentEntries.length, 1);
        // Once Charles leaves, he reads neither the section nor the agent kept in it.
        yield* leaveWorkspace(workspace, charles);
        assert.deepEqual(yield* listTaskSections(charles), {
          sections: [],
          entries: [],
          agentEntries: [],
        });
      }),
  );

  it.effect(
    "deleting a section puts its agents back under Tasks, and an entry goes with its agent",
    () =>
      Effect.gen(function* () {
        const { dean, workspace, first } = yield* openSharedWorkspace;
        const agent = yield* openAgent(dean, workspace);
        const doomed = yield* openAgent(dean, workspace);
        const launch = randomUUID();
        yield* written(dean, create(workspace, "Launch", launch));
        yield* written(dean, place(first, launch));
        yield* written(dean, placeAgent(agent, launch));
        yield* written(dean, placeAgent(doomed, launch));

        yield* Database.use((db) => db.delete(codingAgent).where(eq(codingAgent.id, doomed)));
        assert.deepEqual(
          (yield* listTaskSections(dean)).agentEntries.map(({ agentId }) => agentId),
          [agent],
        );

        const answer = yield* written(dean, { kind: TASK_SECTION_WRITE.DELETE, id: launch });
        assert.deepEqual(answer, { sections: [], entries: [], agentEntries: [] });
      }),
  );
});
