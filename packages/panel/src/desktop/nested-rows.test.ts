import type { TaskSummary } from "@repo/features/task-wire";
import { drawnTaskRows, type TaskRow, taskRow, taskRowName } from "@repo/ui/task-list-model";
import { expect, test } from "vitest";
import { listedSlot, movedBeside, nestsOf, siblingsAt, storedSlot } from "./nested-rows.js";

/**
 * nested-rows.test.ts -- a section keeps its rows in an order of its own,
 * which nesting redraws, so a move goes among a row's siblings as drawn and
 * a drop lands at the top where it was let go; each row is read at its
 * place among its siblings; and a move counted among the rows drawn, one on
 * its way out among them, lands among the rows still listed.
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

test("each row is read at its place among the rows under the same parent, a list nesting none at no place at all", () => {
  // Drawn Parent, Child, Other: Parent and Other are the two at the top, Child the one under Parent.
  expect(nestsOf(DRAWN)).toEqual([
    { position: 1, size: 2 },
    { position: 1, size: 1 },
    { position: 2, size: 2 },
  ]);
  expect(nestsOf([{ depth: 0 }, { depth: 0 }])).toEqual([undefined, undefined]);
});

test("a row let go between a child task and the next row at the top lands before that row in the section's order", () => {
  expect(storedSlot(KEPT, DRAWN, at("Other"))).toBe(1);
  expect(storedSlot(KEPT, DRAWN, at("Child"))).toBe(1);
  expect(storedSlot(KEPT, DRAWN, DRAWN.length)).toBe(KEPT.length);
});

test("a row moved among the rows drawn lands among those listed, a row on its way out counting for none", () => {
  // Drawn A, gone, B, C, the second leaving: listed A, B, C.
  const drawn = [{ leaving: false }, { leaving: true }, { leaving: false }, { leaving: false }];
  expect(listedSlot(drawn, 0, 3)).toBe(2);
  expect(listedSlot(drawn, 3, 1)).toBe(1);
  expect(listedSlot(drawn, 3, 0)).toBe(0);
});
