// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { RELATED_TASK_CELLS, TASK_ROW_CELL, TaskRow, TaskRows } from "./task-row.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

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
        content: { [TASK_ROW_CELL.RELATION]: `${name} kind` },
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

function pressOf(container: HTMLElement, name: string): HTMLButtonElement {
  const press = [...container.querySelectorAll<HTMLButtonElement>("[data-card-press]")].find(
    (each) => each.textContent?.includes(name),
  );
  if (press === undefined) throw new Error(`no press names ${name}`);
  return press;
}

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
