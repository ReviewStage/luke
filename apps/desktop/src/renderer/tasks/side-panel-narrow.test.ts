// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CHANGED_FILE_STATUS,
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import { layContainersAt } from "#testing/container-width";
import { codingAgentsControl } from "#testing/tasks-control";
import { AgentChangesTab } from "./agent-changes-tab";

/**
 * The side panel's Changes tab at its narrowest, 280px, where it has no room
 * for its tree beside the diff: the tree is drawn over the diff only once
 * asked, by a press, a peek, or the pointer at the tab's edge, and Escape or
 * a press on the diff puts it away. jsdom lays nothing out, so the window's
 * stylesheets are laid once for a panel that wide
 * (`#testing/container-width`) and what is drawn is read through them.
 */

/** The plan the tab stands on. */
const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

const AGENT: CodingAgentSummary = {
  id: "1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d2c",
  planId: TASK,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Expiry job",
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
};

const PULL_REQUEST = {
  number: 42,
  title: "Expire invitations",
  url: "https://github.com/acme/relay/pull/42",
  state: PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.PASSING,
  additions: 2,
  deletions: 1,
  changedFiles: 1,
};

const roots: Root[] = [];

/** Draws `element` into the document, its reads let land, answering the box it was drawn in. */
async function mounted(element: ReactElement): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), element)));
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  return container;
}

/** Lets go of every tab drawn. */
function unmountTabs(): void {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
}

/** An agent's Changes tab over its pull request's one file, a line removed and two added, with the tree beside every Changes tab held open as the panel holds it. */
function drawChangesTab(): Promise<HTMLElement> {
  const control = codingAgentsControl({
    agents: [AGENT],
    agentIds: [AGENT.id],
    models: [],
    pullRequests: new Map([[AGENT.id, PULL_REQUEST]]),
    readChanges: () =>
      Promise.resolve({
        pullRequest: {
          url: PULL_REQUEST.url,
          truncated: false,
          files: [
            {
              path: "src/invites/expiry.ts",
              previousPath: null,
              status: CHANGED_FILE_STATUS.MODIFIED,
              additions: 2,
              deletions: 1,
              omitted: null,
              patch:
                "@@ -1,2 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;\n",
            },
          ],
          reviewers: [],
          comments: [],
        },
      }),
  });
  return mounted(
    createElement(AgentChangesTab, {
      agentId: AGENT.id,
      control,
      shown: true,
      repository: "acme/relay",
      tree: { open: true, onToggle: () => undefined },
    }),
  );
}

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

/** The tree's toggles the stylesheet shows, each standing in the box that names its place. */
function drawnToggles(tab: HTMLElement): HTMLButtonElement[] {
  return [...tab.querySelectorAll(".file-tree-toggle")]
    .filter(drawn)
    .flatMap((place) => [...place.querySelectorAll("button")]);
}

test("a Changes tab draws no tree beside the diff, its count under the diff, until the tree's toggle opens it over the diff for this tab alone", async () => {
  const tab = await drawChangesTab();
  // The tree, where it is drawn at all.
  const treeDrawn = () => {
    const tree = tab.querySelector('[aria-label="Changed files"]');
    return tree !== null && drawn(tree);
  };
  const toggles = () => drawnToggles(tab);
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
  const toggle = () => drawnToggles(tab)[0] ?? assert.fail("a toggle is drawn");
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
  const toggle = drawnToggles(tab)[0] ?? assert.fail("a toggle is drawn");
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
