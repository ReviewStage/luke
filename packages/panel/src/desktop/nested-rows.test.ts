import type { TaskSummary } from "@luke/features/task-wire";
import { drawnTaskRows, type TaskRow, taskRow, taskRowName } from "@luke/ui/task-list-model";
import { expect, test } from "vitest";
import { movedBeside, siblingsAt, storedSlot } from "./nested-rows.js";

/**
 * nested-rows.test.ts -- a section keeps its rows in an order of its own,
 * which nesting redraws, so a move goes among a row's siblings as drawn and
 * a drop lands at the top where it was let go.
 */

function task(name: string, parentTaskId?: string): TaskSummary {
  return {
    id: name,
    workspaceId: "workspace-acme",
    name,
    createdAt: 1,
    updatedAt: 1,
    repository: "acme/relay",
    ...(parentTaskId === undefined ? undefined : { parentTaskId }),
  };
}

/** A section kept as Parent, Other, Child, Parent opened, so it is drawn Parent, Child, Other. */
const KEPT: readonly TaskRow[] = [task("Parent"), task("Other"), task("Child", "Parent")].map(
  taskRow,
);
const DRAWN = drawnTaskRows(
  KEPT,
  () => true,
  () => false,
);
const at = (name: string) => DRAWN.findIndex(({ row }) => taskRowName(row) === name);

test("a row moved up past a parent's child tasks lands beside the parent, never between it and them", () => {
  expect(DRAWN.map(({ row }) => taskRowName(row))).toEqual(["Parent", "Child", "Other"]);
  expect(movedBeside(DRAWN, at("Other"), at("Child"))).toBe(at("Parent"));
  expect(movedBeside(DRAWN, at("Parent"), at("Child"))).toBe(at("Other"));
  expect(movedBeside(DRAWN, at("Child"), at("Parent"))).toBeUndefined();
  expect(siblingsAt(DRAWN, at("Child"))).toEqual([at("Child")]);
});

test("a row let go between a child task and the next row at the top lands before that row in the section's order", () => {
  expect(storedSlot(KEPT, DRAWN, at("Other"))).toBe(1);
  expect(storedSlot(KEPT, DRAWN, at("Child"))).toBe(1);
  expect(storedSlot(KEPT, DRAWN, DRAWN.length)).toBe(KEPT.length);
});
