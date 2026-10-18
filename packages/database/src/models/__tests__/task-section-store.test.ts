import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  TASK_SECTION_GLYPH,
  TASK_SECTION_ICON_KIND,
  TASK_SECTION_WRITE,
  type TaskSections,
  type TaskSectionWrite,
} from "@luke/features/task-section-wire";
import { eq } from "drizzle-orm";
import { Clock, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { organization, user } from "../../schemas/auth.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import { deleteTaskSectionIn, listTaskSections, writeTaskSections } from "../task-section-store.js";
import { createTask, deleteTask, updateTask } from "../task-store.js";

/**
 * A section is its maker's own: two members of one workspace share its
 * tasks, and each reads only the sections they made and the tasks they put
 * in them, through the store's public reads and writes, over a real
 * dialect. A task stands in one section at a time, deleting a section
 * deletes none of its tasks, and nobody puts a task in a section that is
 * not theirs or a task of another workspace in one.
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

/** A write the test expects taken, answering the sections as they then stand. */
const written = (userId: string, write: TaskSectionWrite) =>
  Effect.map(
    writeTaskSections(userId, write),
    (answer): TaskSections => Option.getOrElse(answer, () => assert.fail("the write was refused")),
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

it.layer(getTestDB())("an account's task sections", (it) => {
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
      assert.deepEqual(yield* listTaskSections(charles), { sections: [], entries: [] });
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

      assert.deepEqual(answer, { sections: [], entries: [] });
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
        assert.deepEqual(yield* listTaskSections(dean), { sections: [], entries: [] });
      }),
  );

  it.effect("a section is made only in a workspace its maker is a member of", () =>
    Effect.gen(function* () {
      const { workspace } = yield* openSharedWorkspace;
      const outsider = yield* openAccount;

      assert.equal(yield* refused(outsider, create(workspace, "Not mine")), true);
      assert.deepEqual(yield* listTaskSections(outsider), { sections: [], entries: [] });
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
      assert.deepEqual(yield* listTaskSections(dean), { sections: [], entries: [] });
    }),
  );
});
