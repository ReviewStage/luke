import { act } from "react";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * selectable-list.ts -- the behaviour every list that opts into selection owes, written once and run against each: ⌘A chooses every visible row, ⌘-click puts one in or out, ⇧-click chooses the run from the anchor, ⇧↑↓ grow it, Esc lets it go, and a plain click opens its row and chooses nothing.
 *
 * `SELECTABLE_SURFACE` names every surface that passes `selection` to a
 * `List` or stands its rows in a `SelectionRegion`, with its source and the
 * test that runs this contract on it. `selectable-lists.test.ts` reads the
 * source tree for any file that passes `selection` and fails on one not
 * named here, so a new selectable list cannot ship with its keys half-wired.
 *
 * A surface hands over what it drew and what it opened; the rows, who is
 * chosen, and the keys are read off the DOM as a reader meets them: a row
 * that can be chosen wears its key (`data-select-key`) on its press, and a
 * chosen one is described as "Selected". A surface is drawn once for its
 * tests, which keeps each surface's run quick, and each test begins by
 * letting any selection go, so none depends on another.
 */

/** Every surface whose rows are chosen, by where it stands and where its contract runs. */
export const SELECTABLE_SURFACE = {
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

/** A surface as drawn: the box that holds its rows, the keys of the rows its owner was asked to open, latest last, and what takes it down. */
interface SelectableDrawn {
  readonly root: HTMLElement;
  readonly opened: () => readonly string[];
  readonly unmount: () => void;
}

/** A surface the contract runs on. */
export interface SelectableSurface {
  /** Which part of the surface this is, where a source draws more than one list. */
  readonly part?: string;
  /** Draws the surface with at least four rows that can be chosen, and answers once they stand; called once, its `unmount` called after the last test. */
  readonly mount: () => Promise<SelectableDrawn> | SelectableDrawn;
}

/** The attribute a row's press wears in a list that chooses rows, naming its key. */
const KEY_ATTRIBUTE = "data-select-key";

/** What a chosen row's press is described as. */
const SELECTED = "Selected";

/** Every press of `root` that carries a key, in the order drawn, the unavailable ones too. */
function presses(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`[${KEY_ATTRIBUTE}]`)];
}

/** The keys of the rows that can be chosen, in the order drawn. */
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

/** The keys of the rows chosen now, in the order drawn. */
function chosen(root: HTMLElement): string[] {
  return presses(root)
    .filter((press) => press.getAttribute("aria-description") === SELECTED)
    .map(keyOf);
}

/** The press of the row keyed `key`, as drawn now. */
function pressOf(root: HTMLElement, key: string): HTMLElement {
  const found = presses(root).find((press) => keyOf(press) === key);
  if (found === undefined) throw new Error(`No row keyed ${key}`);
  return found;
}

/** Clicks the row keyed `key` with `held` modifiers, as the pointer would. */
function click(root: HTMLElement, key: string, held: MouseEventInit = {}): void {
  const press = pressOf(root, key);
  act(() => {
    press.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, ...held }));
    press.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...held }));
  });
}

/** Puts the focus on the row keyed `key`. */
function focus(root: HTMLElement, key: string): void {
  const press = pressOf(root, key);
  act(() => press.focus());
}

/** Presses `name` on whatever holds the focus. */
function press(name: string, held: KeyboardEventInit = {}): void {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...held }),
    );
  });
}

/** The Esc presses that reach the document past the surface, listening until `stop` is called. */
function heardBehind(): { heard: string[]; stop: () => void } {
  const heard: string[] = [];
  const hear = (event: KeyboardEvent) => {
    if (event.key === "Escape") heard.push(event.key);
  };
  document.addEventListener("keydown", hear);
  return { heard, stop: () => document.removeEventListener("keydown", hear) };
}

/** Lets any selection of `root` go, as Esc does from its first row. */
function release(root: HTMLElement): void {
  if (chosen(root).length === 0) return;
  focus(root, available(root)[0] ?? "");
  press("Escape");
  expect(chosen(root)).toEqual([]);
}

/** Registers the contract's tests for `which`, drawn as `surface` draws it. */
export function selectableListBehaviour(
  which: SelectableSurfaceName,
  surface: SelectableSurface,
): void {
  describe(`${surface.part === undefined ? which : `${which} ${surface.part}`} chooses rows`, () => {
    let standing: SelectableDrawn | undefined;

    beforeAll(async () => {
      standing = await surface.mount();
    });

    afterAll(() => standing?.unmount());

    /** The surface and the keys of its first rows that can be chosen, after any selection has gone. */
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
