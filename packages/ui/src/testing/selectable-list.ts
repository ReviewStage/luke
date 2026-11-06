import { act } from "react";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const SELECTABLE_SURFACE = {
  CATALOG: {
    source: "apps/catalog/src/examples/selection.tsx",
    test: "apps/catalog/src/selectable-lists.test.ts",
  },
  TASKS: {
    source: "packages/panel/src/desktop/tasks-list.tsx",
    test: "packages/panel/src/desktop/tasks-list-selectable.test.ts",
  },
  INBOX: {
    source: "packages/panel/src/tasks/inbox-list.tsx",
    test: "packages/panel/src/tasks/inbox-list-selectable.test.ts",
  },
} as const;

export type SelectableSurfaceName = keyof typeof SELECTABLE_SURFACE;

interface SelectableDrawn {
  readonly root: HTMLElement;
  readonly opened: () => readonly string[];
  readonly unmount: () => void;
}

export interface SelectableSurface {
  readonly part?: string;
  readonly mount: () => Promise<SelectableDrawn> | SelectableDrawn;
}

const KEY_ATTRIBUTE = "data-select-key";

const SELECTED = "Selected";

function presses(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`[${KEY_ATTRIBUTE}]`)];
}

function available(root: HTMLElement): string[] {
  return presses(root)
    .filter(
      (press) => !press.matches(":disabled") && press.getAttribute("aria-disabled") !== "true",
    )
    .map(keyOf);
}

function keyOf(press: HTMLElement): string {
  return press.getAttribute(KEY_ATTRIBUTE) ?? "";
}

function describedAs(press: HTMLElement): string {
  const named = press.getAttribute("aria-describedby");
  if (named === null) return press.getAttribute("aria-description") ?? "";
  return named
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

function chosen(root: HTMLElement): string[] {
  return presses(root)
    .filter((press) => describedAs(press).split(", ")[0] === SELECTED)
    .map(keyOf);
}

function pressOf(root: HTMLElement, key: string): HTMLElement {
  const found = presses(root).find((press) => keyOf(press) === key);
  if (found === undefined) throw new Error(`No row keyed ${key}`);
  return found;
}

function click(root: HTMLElement, key: string, held: MouseEventInit = {}): void {
  const press = pressOf(root, key);
  act(() => {
    press.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, ...held }));
    press.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...held }));
  });
}

function focus(root: HTMLElement, key: string): void {
  const press = pressOf(root, key);
  act(() => press.focus());
}

function press(name: string, held: KeyboardEventInit = {}): void {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...held }),
    );
  });
}

function heardBehind(): { heard: string[]; stop: () => void } {
  const heard: string[] = [];
  const hear = (event: KeyboardEvent) => {
    if (event.key === "Escape") heard.push(event.key);
  };
  document.addEventListener("keydown", hear);
  return { heard, stop: () => document.removeEventListener("keydown", hear) };
}

function release(root: HTMLElement): void {
  if (chosen(root).length === 0) return;
  focus(root, available(root)[0] ?? "");
  press("Escape");
  expect(chosen(root)).toEqual([]);
}

export function selectableListBehavior(
  which: SelectableSurfaceName,
  surface: SelectableSurface,
): void {
  describe(`${surface.part === undefined ? which : `${which} ${surface.part}`} chooses rows`, () => {
    let standing: SelectableDrawn | undefined;

    beforeAll(async () => {
      standing = await surface.mount();
    });

    afterAll(() => standing?.unmount());

    function drawn(): { root: HTMLElement; opened: () => readonly string[]; rows: string[] } {
      if (standing === undefined) throw new Error("The surface was not drawn");
      release(standing.root);
      const rows = available(standing.root);
      expect(
        rows.length,
        "the surface draws at least four rows that can be chosen",
      ).toBeGreaterThan(3);
      return { root: standing.root, opened: standing.opened, rows };
    }

    test("⌘A chooses every visible row", () => {
      const { root, rows } = drawn();
      focus(root, rows[0] ?? "");
      press("a", { metaKey: true });
      expect(chosen(root)).toEqual(rows);
    });

    test("⌘-click puts a row in and takes it out again, opening none", () => {
      const { root, opened, rows } = drawn();
      const before = [...opened()];
      const [, one = "", two = ""] = rows;
      click(root, one, { metaKey: true });
      click(root, two, { metaKey: true });
      expect(chosen(root)).toEqual([one, two]);
      click(root, one, { metaKey: true });
      expect(chosen(root)).toEqual([two]);
      expect(opened()).toEqual(before);
    });

    test("⇧-click chooses the run from the row last pressed", () => {
      const { root, rows } = drawn();
      const [, one = "", two = "", three = ""] = rows;
      click(root, one);
      click(root, three, { shiftKey: true });
      expect(chosen(root)).toEqual([one, two, three]);
    });

    test("⇧↓ and ⇧↑ grow and shrink the run from the row in hand", () => {
      const { root, rows } = drawn();
      const [first = "", second = "", third = ""] = rows;
      focus(root, first);
      press("ArrowDown", { shiftKey: true });
      expect(chosen(root)).toEqual([first, second]);
      expect(document.activeElement).toBe(pressOf(root, second));
      press("ArrowDown", { shiftKey: true });
      expect(chosen(root)).toEqual([first, second, third]);
      press("ArrowUp", { shiftKey: true });
      expect(chosen(root)).toEqual([first, second]);
    });

    test("Esc lets the selection go and goes no further; with none chosen it is left to the page", () => {
      const { root, rows } = drawn();
      focus(root, rows[0] ?? "");
      press("a", { metaKey: true });
      const behind = heardBehind();
      try {
        press("Escape");
        expect(chosen(root)).toEqual([]);
        expect(behind.heard).toEqual([]);
        press("Escape");
        expect(behind.heard).toEqual(["Escape"]);
      } finally {
        behind.stop();
      }
    });

    test("a plain click opens its row and chooses nothing", () => {
      const { root, opened, rows } = drawn();
      const [, one = ""] = rows;
      click(root, one);
      expect(opened().at(-1)).toBe(one);
      expect(chosen(root)).toEqual([]);
    });
  });
}
