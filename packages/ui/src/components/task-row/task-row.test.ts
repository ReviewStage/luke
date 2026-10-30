// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { RELATED_TASK_CELLS, TASK_ROW_CELL, TaskRow, TaskRows } from "./task-row.js";

/**
 * task-row.test.ts -- a list of task rows standing on its own folds a row's
 * nested rows by a chevron that is a control of its own beside the row's
 * press, and by → and ← on the press, and chooses its rows as a Mac's list
 * does, a ⌘-click choosing a row rather than opening it while a plain press
 * still opens it. Synthetic tasks.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

// Note that a row's name measures whether it is cut short, so each test draws beside a ResizeObserver, which jsdom lacks.
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** Draws a parent task folding one child, and a task beside them, recording what was opened and chosen. */
function drawList(opened: string[], chosen: ReadonlySet<string>[]): HTMLElement {
  function Rows(): React.JSX.Element {
    const [open, setOpen] = useState(true);
    const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
    const row = (id: string, name: string, more: object = {}) =>
      createElement(TaskRow, {
        key: id,
        taskId: id,
        name,
        cells: RELATED_TASK_CELLS,
        content: { [TASK_ROW_CELL.END]: `${name} kind` },
        onOpen: () => opened.push(id),
        ...more,
      });
    return createElement(TaskRows, {
      label: "Related tasks",
      selection: {
        selected,
        onChange: (next) => {
          chosen.push(next);
          setSelected(next);
        },
      },
      children: [
        row("parent", "Ship the release", {
          fold: { open, onOpenChange: setOpen, label: "Child tasks of Ship the release" },
        }),
        open ? row("child", "Write the notes", { depth: 1 }) : null,
        row("other", "Tag the build"),
      ],
    });
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Rows)));
  return container;
}

/** The press that opens the task named `name`. */
function pressOf(container: HTMLElement, name: string): HTMLButtonElement {
  const press = [...container.querySelectorAll<HTMLButtonElement>("[data-card-press]")].find(
    (each) => each.textContent?.includes(name),
  );
  if (press === undefined) throw new Error(`no press names ${name}`);
  return press;
}

/** The names of the rows drawn, in order. */
function namesOf(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll("[data-card-press]")].map((each) => each.textContent ?? "");
}

test("a row's chevron folds its nested rows beside its press, and → and ← on the press open and fold them", () => {
  const opened: string[] = [];
  const container = drawList(opened, []);
  const chevron = container.querySelector<HTMLButtonElement>(
    "button[aria-label='Child tasks of Ship the release']",
  );
  expect(chevron?.getAttribute("aria-expanded")).toBe("true");
  expect(chevron?.closest("[data-card-press]")).toBeNull();
  expect(namesOf(container)).toEqual(["Ship the release", "Write the notes", "Tag the build"]);

  act(() => chevron?.click());
  expect(namesOf(container)).toEqual(["Ship the release", "Tag the build"]);

  const press = pressOf(container, "Ship the release");
  act(() => {
    press.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  });
  expect(namesOf(container)).toEqual(["Ship the release", "Write the notes", "Tag the build"]);
  act(() => {
    press.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  });
  expect(namesOf(container)).toEqual(["Ship the release", "Tag the build"]);
  expect(opened).toEqual([]);
});

test("a ⌘-click chooses a row without opening it, and a plain press opens it", () => {
  const opened: string[] = [];
  const chosen: ReadonlySet<string>[] = [];
  const container = drawList(opened, chosen);

  act(() => {
    pressOf(container, "Tag the build").dispatchEvent(
      new MouseEvent("click", { bubbles: true, metaKey: true }),
    );
  });
  expect(opened).toEqual([]);
  expect([...(chosen.at(-1) ?? [])]).toEqual(["other"]);

  act(() => pressOf(container, "Write the notes").click());
  expect(opened).toEqual(["child"]);
});
