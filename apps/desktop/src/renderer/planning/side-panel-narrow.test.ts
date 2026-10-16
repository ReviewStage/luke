// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, beforeAll, test, vi } from "vitest";
import { layContainersAt } from "#testing/container-width";
import {
  drawChangesTab,
  drawFileNote,
  drawPageTab,
  drawSubagentRow,
  unmountTabs,
} from "#testing/side-panel-tabs";

/**
 * The side panel's tabs at its narrowest, 280px, where no tab has room for
 * a pane beside it or for every word of its bars: a Changes tab draws its
 * tree over the diff only once asked and numbers the diff on one side, a
 * note of Luke's says its age in a pill, a subagent's job takes two lines,
 * and a page's bar counts its versions. jsdom lays nothing out, so the
 * window's stylesheets are laid once for a panel that wide
 * (`#testing/container-width`) and what is drawn is read through them.
 * `side-panel-wide.test.ts` reads the same tabs in a wide panel.
 */

beforeAll(() => {
  layContainersAt({ "side-panel": 280 });
  // The first element read cascades the whole window once, which is left to the setup.
  getComputedStyle(document.documentElement);
  // Note that the setup is given longer than most, because jsdom takes seconds to lay the stylesheets.
}, 30_000);

afterEach(() => {
  unmountTabs();
  vi.restoreAllMocks();
});

/**
 * Whether the stylesheets draw the element itself, which is where every
 * rule read here hides one. Note that its boxes around are not read, as
 * `shown` reads them, because jsdom takes a tenth of a second to cascade
 * each element through the window's stylesheets.
 */
function drawn(element: Element): boolean {
  return getComputedStyle(element).display !== "none";
}

/** The diff's lines as drawn: each the numbers shown in its gutter, then its text. */
function diffLines(tab: HTMLElement): string[][] {
  return [...tab.querySelectorAll(".code-line[data-diff]")].map((line) => [
    ...[...line.querySelectorAll(".code-line-number")]
      .filter(drawn)
      .map((number) => number.textContent ?? ""),
    line.querySelector(".code-line-text")?.textContent ?? "",
  ]);
}

test("a Changes tab draws no tree beside the diff, its count under the diff, until the tree's toggle opens it over the diff for this tab alone", async () => {
  const tab = await drawChangesTab();
  // The tree, where it is drawn at all.
  const treeDrawn = () => {
    const tree = tab.querySelector('[aria-label="Changed files"]');
    return tree !== null && drawn(tree);
  };
  const toggles = () =>
    [...tab.querySelectorAll<HTMLButtonElement>(".file-tree-toggle")].filter(drawn);
  const count = () =>
    [...tab.querySelectorAll(".file-tree-foot")].filter(drawn).map((foot) => foot.textContent);

  assert.ok(!treeDrawn(), "the tree the panel holds open stands nowhere");
  assert.deepEqual(count(), ["1 file changed +2 −1"]);
  assert.deepEqual(
    toggles().map((button) => [
      button.getAttribute("aria-label"),
      button.getAttribute("aria-expanded"),
    ]),
    [["Show files", "false"]],
  );

  await act(async () => toggles()[0]?.click());

  assert.ok(treeDrawn(), "the tree stands over the diff");
  assert.deepEqual(
    toggles().map((button) => button.getAttribute("aria-label")),
    ["Hide files"],
  );

  act(() => {
    tab
      .querySelector(".file-tab")
      ?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  assert.ok(!treeDrawn(), "a press on the diff takes the tree down");
});

test("Escape pressed on the tree's toggle takes down the tree it opened over the diff, and goes no further", async () => {
  const tab = await drawChangesTab();
  const toggle = () =>
    [...tab.querySelectorAll<HTMLButtonElement>(".file-tree-toggle")].find(drawn) ??
    assert.fail("a toggle is drawn");
  const treeDrawn = () => {
    const tree = tab.querySelector('[aria-label="Changed files"]');
    return tree !== null && drawn(tree);
  };
  let escaped = false;
  const heard = () => {
    escaped = true;
  };
  document.addEventListener("keydown", heard);

  await act(async () => toggle().click());
  assert.ok(treeDrawn(), "the tree stands over the diff");
  act(() => {
    toggle().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  document.removeEventListener("keydown", heard);

  assert.ok(!treeDrawn(), "Escape takes the tree down");
  assert.equal(escaped, false, "the window hears no Escape of its own");
});

/** The pointer crossing from `from` onto `to` at a height in the window, as React hears a leave and an enter. */
function pointerCross(from: Element, to: Element, clientY = 0): void {
  act(() => {
    from.dispatchEvent(
      new PointerEvent("pointerout", { bubbles: true, relatedTarget: to, clientY }),
    );
    to.dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true, relatedTarget: from, clientY }),
    );
  });
}

/** A Changes tab's parts as the floating tree's tests read them. */
function changesParts(tab: HTMLElement) {
  const toggle =
    [...tab.querySelectorAll<HTMLButtonElement>(".file-tree-toggle")].find(drawn) ??
    assert.fail("a toggle is drawn");
  const body = tab.querySelector(".file-view-body") ?? assert.fail("the diff's body is drawn");
  const diff = body.firstElementChild ?? assert.fail("the diff is drawn");
  const tree = () => tab.querySelector('[aria-label="Changed files"]');
  const treeDrawn = () => {
    const found = tree();
    return found !== null && drawn(found);
  };
  return { toggle, body, diff, tree, treeDrawn };
}

test("the pointer resting on the tree's toggle floats the tree over the diff, and it goes once the pointer leaves for anywhere but down into the tree, or leaves the tree", async () => {
  const { toggle, diff, tree, treeDrawn } = changesParts(await drawChangesTab());
  // jsdom lays nothing out, so the toggle's foot stands at the window's top: above it is up, below it is down.
  pointerCross(diff, toggle);
  assert.ok(treeDrawn(), "the tree floats over the diff");
  assert.deepEqual(
    [toggle.getAttribute("aria-label"), toggle.getAttribute("aria-expanded")],
    ["Show files", "true"],
    "a peek still offers to show the files",
  );
  pointerCross(toggle, diff, -10);
  assert.ok(!treeDrawn(), "leaving the toggle sideways takes the tree down");

  pointerCross(diff, toggle);
  pointerCross(toggle, tree() ?? assert.fail("the tree is drawn"), 10);
  assert.ok(treeDrawn(), "the way down into the tree keeps it");
  pointerCross(tree() ?? assert.fail("the tree is drawn"), diff);
  assert.ok(!treeDrawn(), "leaving the tree takes it down");
});

test("the pointer at the tab's right edge floats the tree, though not with a button held, as a drag on the scrollbar there holds one", async () => {
  const { body, diff, treeDrawn } = changesParts(await drawChangesTab());
  vi.spyOn(body, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 280, 400));
  const move = (clientX: number, buttons: number) =>
    act(() => {
      diff.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX, buttons }));
    });

  move(200, 0);
  assert.ok(!treeDrawn(), "the middle of the diff floats nothing");
  move(277, 1);
  assert.ok(!treeDrawn(), "a drag at the edge floats nothing");
  move(277, 0);
  assert.ok(treeDrawn(), "resting at the edge floats the tree");
  move(120, 0);
  assert.ok(!treeDrawn(), "back over the diff, the tree goes");
});

test("a press of the toggle opens the tree with the keyboard in it, holds the keyboard there against Tab, and Escape puts it away and hands the keyboard back to the toggle", async () => {
  const tab = await drawChangesTab();
  const { toggle, tree, treeDrawn } = changesParts(tab);
  toggle.focus();
  await act(async () => toggle.click());
  const held = tree() ?? assert.fail("the tree is drawn");
  assert.ok(treeDrawn(), "the tree floats over the diff");
  assert.ok(held.contains(document.activeElement), "the keyboard lands in the tree");

  const outside =
    tab.querySelector<HTMLButtonElement>('button[aria-label="Open on GitHub"]') ??
    assert.fail("the bar offers GitHub");
  // jsdom walks no focus for Tab, so the walk out is the key, then the focus it lands.
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    outside.focus();
  });
  assert.ok(
    held.contains(document.activeElement),
    "Tab walks the keyboard no further than the tree",
  );

  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  assert.ok(!treeDrawn(), "Escape takes the tree down");
  assert.ok(document.activeElement === toggle, "the keyboard is back on the toggle");
});

test("a press of the toggle over a peek opens the tree with the keyboard in it, and the press that opened it is no press inside it when the next press, on the diff, puts it away", async () => {
  const { toggle, diff, tree, treeDrawn } = changesParts(await drawChangesTab());
  pointerCross(diff, toggle);
  act(() => {
    toggle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  await act(async () => toggle.click());
  assert.ok(
    (tree() ?? assert.fail("the tree is drawn")).contains(document.activeElement),
    "the keyboard lands in the tree",
  );
  act(() => {
    diff.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  assert.ok(!treeDrawn(), "the first press on the diff takes the tree down");
});

test("a Changes tab numbers its diff on the new side alone, a removed line by its tint", async () => {
  const tab = await drawChangesTab();
  assert.deepEqual(diffLines(tab), [
    ["", "@@ -1,2 +1,3 @@"],
    ["1", "const a = 1;"],
    ["", "const b = 2;"],
    ["2", "const b = 3;"],
    ["3", "const c = 4;"],
  ]);
});

test("a note of Luke's says its age in the link's pill, the link drawing its glyph alone and still named, so the header's parts never stand on one another", async () => {
  const note = await drawFileNote();
  const time = note.querySelector(".file-note-time") ?? assert.fail("the note's age is drawn");
  const link =
    note.querySelector<HTMLButtonElement>('button[aria-label="Show in Code"]') ??
    assert.fail("the link to the Code tab stands");

  assert.equal(drawn(time), false);
  assert.deepEqual(
    [...link.children].filter(drawn).map((part) => part.tagName.toLowerCase()),
    ["svg"],
  );
});

test("a subagent's job takes a second line before it is cut", async () => {
  const row = await drawSubagentRow();
  const job = row.querySelector(".subagent-job") ?? assert.fail("the job is drawn");
  assert.equal(getComputedStyle(job).whiteSpace, "normal");
});

test("a page's bar counts its versions without words, leaving its title the room", async () => {
  const tab = await drawPageTab();
  assert.deepEqual(
    [...tab.querySelectorAll(".page-view-version > *")]
      .filter(drawn)
      .map((part) => part.textContent),
    ["3/3"],
  );
});
