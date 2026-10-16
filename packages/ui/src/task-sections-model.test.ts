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
  NO_TASK_SECTIONS,
  placeWrites,
  sectionMoveWrites,
  sectionOrder,
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
  sectionOrder(state, sectionId).map((entry) => entry.taskId);

describe("a task dropped into a section", () => {
  it("stands where it was let go: on top, between two, or at the foot", () => {
    const state = launchWithThree();
    for (const [to, expected] of [
      [0, [TASK(9), TASK(1), TASK(2), TASK(3)]],
      [2, [TASK(1), TASK(2), TASK(9), TASK(3)]],
      [3, [TASK(1), TASK(2), TASK(3), TASK(9)]],
    ] as const) {
      const writes = placeWrites(state, TASK(9), LAUNCH, to, 20);
      assert.deepEqual(tasksIn(applyAll(state, writes, 20), LAUNCH), expected);
    }
  });

  it("leaves the section it stood in, and Tasks takes it back out of any", () => {
    const state = launchWithThree();
    const moved = applyAll(state, placeWrites(state, TASK(2), LATER, 0, 20), 20);
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
    const once = applyAll(state, entryMoveWrites(state, LAUNCH, 0, 2), 20);
    assert.deepEqual(tasksIn(once, LAUNCH), [TASK(2), TASK(3), TASK(1)]);
    const twice = applyAll(once, placeWrites(once, TASK(1), LAUNCH, 0, 21), 21);
    assert.deepEqual(tasksIn(twice, LAUNCH), [TASK(1), TASK(2), TASK(3)]);
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
    const state = applyAll(
      launchWithThree(),
      placeWrites(launchWithThree(), TASK(9), LATER, 0, 20),
      20,
    );
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
