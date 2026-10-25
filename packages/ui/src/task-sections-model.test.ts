import assert from "node:assert/strict";
import {
  TASK_SECTION_GLYPH,
  TASK_SECTION_ICON_KIND,
  TASK_SECTION_WRITE,
  type TaskSections,
  type TaskSectionWrite,
} from "@luke/features/task-section-wire";
import { describe, it } from "vitest";
import {
  applySectionWrite,
  entryMoveWrites,
  memberOf,
  NO_TASK_SECTIONS,
  placeAllWrites,
  placeWrites,
  restoreWrites,
  sectionMoveWrites,
  sectionOrder,
  unplaceAllWrites,
  workspaceSections,
} from "./task-sections-model.js";

/**
 * The sidebar's sections as a drop or a menu leaves them: every write a
 * drag asks for is applied as the service would keep it, and the tasks and
 * sections are read back in the order the sidebar draws them.
 */

const WORKSPACE = "workspace-1";
const LAUNCH = "0a1b2c3d-0000-4000-8000-000000000001";
const LATER = "0a1b2c3d-0000-4000-8000-000000000002";
const TASK = (n: number) => `0a1b2c3d-0000-4000-8000-1000000000${String(n).padStart(2, "0")}`;
const AGENT = (n: number) => `0a1b2c3d-0000-4000-8000-2000000000${String(n).padStart(2, "0")}`;
const task = (id: string) => ({ agent: false, id });
const agent = (id: string) => ({ agent: true, id });

const applyAll = (state: TaskSections, writes: readonly TaskSectionWrite[], now: number) =>
  writes.reduce((held, write) => applySectionWrite(held, write, now), state);

const create = (id: string, title: string): TaskSectionWrite => ({
  kind: TASK_SECTION_WRITE.CREATE,
  id,
  workspaceId: WORKSPACE,
  title,
});

/** Launch holding tasks 1, 2, and 3 top to bottom, put there one after another, and Later empty. */
function launchWithThree(): TaskSections {
  let state = applyAll(NO_TASK_SECTIONS, [create(LAUNCH, "Launch")], 1);
  state = applyAll(state, [create(LATER, "Later")], 2);
  for (const [n, at] of [
    [3, 10],
    [2, 11],
    [1, 12],
  ] as const) {
    state = applySectionWrite(
      state,
      { kind: TASK_SECTION_WRITE.PLACE, taskId: TASK(n), sectionId: LAUNCH },
      at,
    );
  }
  return state;
}

const tasksIn = (state: TaskSections, sectionId: string) =>
  sectionOrder(state, sectionId).map((entry) => memberOf(entry).id);

describe("a task dropped into a section", () => {
  it("stands where it was let go: on top, between two, or at the foot", () => {
    const state = launchWithThree();
    for (const [to, expected] of [
      [0, [TASK(9), TASK(1), TASK(2), TASK(3)]],
      [2, [TASK(1), TASK(2), TASK(9), TASK(3)]],
      [3, [TASK(1), TASK(2), TASK(3), TASK(9)]],
    ] as const) {
      const writes = placeWrites(sectionOrder(state, LAUNCH), task(TASK(9)), LAUNCH, to, 20);
      assert.deepEqual(tasksIn(applyAll(state, writes, 20), LAUNCH), expected);
    }
  });

  it("leaves the section it stood in, and Tasks takes it back out of any", () => {
    const state = launchWithThree();
    const moved = applyAll(
      state,
      placeWrites(sectionOrder(state, LATER), task(TASK(2)), LATER, 0, 20),
      20,
    );
    assert.deepEqual(tasksIn(moved, LAUNCH), [TASK(1), TASK(3)]);
    assert.deepEqual(tasksIn(moved, LATER), [TASK(2)]);

    const out = applySectionWrite(
      moved,
      { kind: TASK_SECTION_WRITE.PLACE, taskId: TASK(2), sectionId: null },
      21,
    );
    assert.deepEqual(tasksIn(out, LATER), []);
  });

  it("dragged within its own section moves there, and again from where it landed", () => {
    const state = launchWithThree();
    const once = applyAll(state, entryMoveWrites(sectionOrder(state, LAUNCH), LAUNCH, 0, 2), 20);
    assert.deepEqual(tasksIn(once, LAUNCH), [TASK(2), TASK(3), TASK(1)]);
    const twice = applyAll(
      once,
      placeWrites(sectionOrder(once, LAUNCH), task(TASK(1)), LAUNCH, 0, 21),
      21,
    );
    assert.deepEqual(tasksIn(twice, LAUNCH), [TASK(1), TASK(2), TASK(3)]);
  });
});

describe("tasks moved together", () => {
  it("stand on top of the section chosen in their order, even stamped in one instant", () => {
    const state = applyAll(launchWithThree(), placeWrites([], task(TASK(9)), LATER, 0, 15), 15);
    const writes = placeAllWrites(state, [task(TASK(1)), task(TASK(2)), task(TASK(3))], LATER, 20);
    const moved = applyAll(state, writes, 20);
    assert.deepEqual(tasksIn(moved, LATER), [TASK(1), TASK(2), TASK(3), TASK(9)]);
    assert.deepEqual(tasksIn(moved, LAUNCH), []);
  });

  it("stand above a section's dragged tasks as well as its loose ones", () => {
    const later = applyAll(launchWithThree(), placeWrites([], task(TASK(8)), LATER, 0, 14), 14);
    const loose = applyAll(
      later,
      placeWrites(sectionOrder(later, LATER), task(TASK(9)), LATER, 1, 15),
      15,
    );
    const dragged = applyAll(loose, entryMoveWrites(sectionOrder(loose, LATER), LATER, 0, 1), 16);
    const moved = applyAll(
      dragged,
      placeAllWrites(dragged, [task(TASK(3)), task(TASK(1))], LATER, 20),
      20,
    );
    assert.deepEqual(tasksIn(moved, LATER), [TASK(3), TASK(1), TASK(9), TASK(8)]);
    assert.deepEqual(tasksIn(moved, LAUNCH), [TASK(2)]);
  });

  it("into a section made with them stand there in their order", () => {
    const NEW = "0a1b2c3d-0000-4000-8000-000000000003";
    const state = launchWithThree();
    const writes = [
      create(NEW, "New"),
      ...placeAllWrites(state, [task(TASK(2)), task(TASK(1))], NEW, 20),
    ];
    assert.deepEqual(tasksIn(applyAll(state, writes, 20), NEW), [TASK(2), TASK(1)]);
  });

  it("taken out of their section stand in none, and the others stay", () => {
    const state = launchWithThree();
    const out = applyAll(state, unplaceAllWrites([task(TASK(1)), task(TASK(3))]), 20);
    assert.deepEqual(tasksIn(out, LAUNCH), [TASK(2)]);
    assert.deepEqual(
      out.entries.map((entry) => entry.taskId),
      [TASK(2)],
    );
  });
});

describe("a section", () => {
  it("stands newest made on top until dragged, and a drag stands it there", () => {
    const state = launchWithThree();
    const sections = workspaceSections(state, WORKSPACE);
    assert.deepEqual(
      sections.map((section) => section.title),
      ["Later", "Launch"],
    );
    const moved = applyAll(state, sectionMoveWrites(sections, 0, 1), 20);
    assert.deepEqual(
      workspaceSections(moved, WORKSPACE).map((section) => section.title),
      ["Launch", "Later"],
    );
    assert.deepEqual(workspaceSections(moved, "another-workspace"), []);
  });

  it("deleted takes its tasks out of every section and leaves the others' standing", () => {
    const state = applyAll(launchWithThree(), placeWrites([], task(TASK(9)), LATER, 0, 20), 20);
    const deleted = applySectionWrite(state, { kind: TASK_SECTION_WRITE.DELETE, id: LAUNCH }, 21);
    assert.deepEqual(
      deleted.entries.map((entry) => entry.taskId),
      [TASK(9)],
    );
    assert.deepEqual(
      workspaceSections(deleted, WORKSPACE).map((section) => section.id),
      [LATER],
    );
  });

  it("edited takes its new title and icon, and none clears the icon", () => {
    const icon = { kind: TASK_SECTION_ICON_KIND.GLYPH, glyph: TASK_SECTION_GLYPH.ROCKET };
    const edited = applySectionWrite(
      launchWithThree(),
      { kind: TASK_SECTION_WRITE.EDIT, id: LAUNCH, title: "Ship it", icon },
      20,
    );
    const launch = () => edited.sections.find((section) => section.id === LAUNCH);
    assert.equal(launch()?.title, "Ship it");
    assert.deepEqual(launch()?.icon, icon);
    const cleared = applySectionWrite(
      edited,
      { kind: TASK_SECTION_WRITE.EDIT, id: LAUNCH, title: "Ship it", icon: null },
      21,
    );
    assert.equal(cleared.sections.find((section) => section.id === LAUNCH)?.icon, undefined);
  });

  it("a task put in a section nobody holds stands in none", () => {
    const state = applySectionWrite(
      NO_TASK_SECTIONS,
      { kind: TASK_SECTION_WRITE.PLACE, taskId: TASK(1), sectionId: LAUNCH },
      1,
    );
    assert.deepEqual(state, NO_TASK_SECTIONS);
  });
});

describe("an agent with no task in a section", () => {
  it("is dropped among the section's tasks in the one order, and dragged within it", () => {
    const state = launchWithThree();
    const dropped = applyAll(
      state,
      placeWrites(sectionOrder(state, LAUNCH), agent(AGENT(1)), LAUNCH, 1, 20),
      20,
    );
    assert.deepEqual(tasksIn(dropped, LAUNCH), [TASK(1), AGENT(1), TASK(2), TASK(3)]);
    assert.deepEqual(
      dropped.agentEntries.map((entry) => entry.agentId),
      [AGENT(1)],
    );
    const dragged = applyAll(
      dropped,
      entryMoveWrites(sectionOrder(dropped, LAUNCH), LAUNCH, 1, 3),
      21,
    );
    assert.deepEqual(tasksIn(dragged, LAUNCH), [TASK(1), TASK(2), TASK(3), AGENT(1)]);
    // A task dragged below the agent is placed past it, as past any task.
    const onTop = applyAll(
      dragged,
      placeWrites(sectionOrder(dragged, LAUNCH), task(TASK(3)), LAUNCH, 3, 22),
      22,
    );
    assert.deepEqual(tasksIn(onTop, LAUNCH), [TASK(1), TASK(2), AGENT(1), TASK(3)]);
  });

  it("moves to another section whole, with the tasks moved beside it, and leaves under null", () => {
    const state = applyAll(launchWithThree(), placeWrites([], agent(AGENT(1)), LAUNCH, 0, 13), 13);
    const moved = applyAll(
      state,
      placeAllWrites(state, [agent(AGENT(1)), task(TASK(2))], LATER, 20),
      20,
    );
    assert.deepEqual(tasksIn(moved, LATER), [AGENT(1), TASK(2)]);
    assert.deepEqual(tasksIn(moved, LAUNCH), [TASK(1), TASK(3)]);
    const out = applyAll(moved, unplaceAllWrites([agent(AGENT(1))]), 21);
    assert.deepEqual(out.agentEntries, []);
    assert.deepEqual(tasksIn(out, LATER), [TASK(2)]);
  });

  it("goes back under Tasks with its section's tasks when the section is deleted", () => {
    const state = applyAll(
      launchWithThree(),
      [
        ...placeWrites([], agent(AGENT(1)), LAUNCH, 0, 20),
        ...placeWrites([], agent(AGENT(2)), LATER, 0, 20),
      ],
      20,
    );
    const deleted = applySectionWrite(state, { kind: TASK_SECTION_WRITE.DELETE, id: LAUNCH }, 21);
    assert.deepEqual(
      deleted.agentEntries.map((entry) => entry.agentId),
      [AGENT(2)],
    );
    assert.deepEqual(deleted.entries, []);
  });

  it("with the same id as a task's is no task, so placing one moves neither the other", () => {
    const shared = TASK(1);
    const state = applyAll(launchWithThree(), placeWrites([], agent(shared), LATER, 0, 20), 20);
    assert.deepEqual(tasksIn(state, LATER), [shared]);
    assert.deepEqual(tasksIn(state, LAUNCH), [TASK(1), TASK(2), TASK(3)]);
  });
});

describe("an Undo of tasks moved together", () => {
  it("puts each back in its section under the rows it stood under, though none had a place of its own", () => {
    const state = launchWithThree();
    const members = [task(TASK(3)), task(TASK(1))];
    const moved = applyAll(state, placeAllWrites(state, members, LATER, 20), 20);
    const undone = applyAll(moved, restoreWrites(state, moved, members, LATER, 30), 30);
    assert.deepEqual(tasksIn(undone, LAUNCH), [TASK(1), TASK(2), TASK(3)]);
    assert.deepEqual(tasksIn(undone, LATER), []);
  });

  it("leaves a task moved again since where it was moved, and takes one from no section back out", () => {
    const state = applyAll(launchWithThree(), [create(TASK(50), "Today")], 3);
    const members = [task(TASK(2)), task(TASK(9))];
    const moved = applyAll(state, placeAllWrites(state, members, LATER, 20), 20);
    const again = applyAll(
      moved,
      placeWrites(sectionOrder(moved, TASK(50)), task(TASK(2)), TASK(50), 0, 21),
      21,
    );
    const undone = applyAll(again, restoreWrites(state, again, members, LATER, 30), 30);
    assert.deepEqual(tasksIn(undone, TASK(50)), [TASK(2)]);
    assert.deepEqual(tasksIn(undone, LATER), []);
    assert.deepEqual(tasksIn(undone, LAUNCH), [TASK(1), TASK(3)]);
  });
});
