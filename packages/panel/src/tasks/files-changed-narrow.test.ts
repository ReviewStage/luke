// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CHANGED_FILE_STATUS,
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { ChangesTabReading } from "../testing/changes-tab.js";
import { layContainersAt } from "../testing/container-width.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { codingAgentsControl } from "../testing/tasks-control.js";

/**
 * files-changed-narrow.test.ts -- a phone's Files changed view: the side panel stands full screen at a phone's width, wide enough on the desktop for the tree beside the diff, but a narrow room gives the diff the whole width and floats the tree over it only once its toggle opens it, a file chosen there putting it away; the desktop's panel at that width keeps the tree beside the diff, as before.
 *
 * jsdom lays nothing out, so the window's stylesheets are laid once for a
 * panel that wide (`testing/container-width.ts`), the tab drawn in the
 * shell's room, and what is drawn is read through them.
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

/** Draws `element` into the shell's room, its reads let land, answering the box it was drawn in. */
async function mounted(element: ReactElement, room: ShellRoom): Promise<HTMLElement> {
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  shell.dataset.room = room;
  const container = shell.appendChild(document.createElement("div"));
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
function drawChangesTab(room: ShellRoom): Promise<HTMLElement> {
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
    createElement(ChangesTabReading, {
      agentId: AGENT.id,
      control,
      shown: true,
      repository: "acme/relay",
      tree: { open: true, onToggle: () => undefined },
    }),
    room,
  );
}

beforeAll(() => {
  layContainersAt({ "side-panel": 390, "pull-request-tab": 390 }, { touch: true });
  // The first element read cascades the whole window once, which is left to the setup.
  getComputedStyle(document.documentElement);
  // Note that the setup is given longer than most, because jsdom takes seconds to lay the stylesheets.
}, 30_000);

afterEach(() => {
  unmountTabs();
  vi.restoreAllMocks();
});

/** Whether the stylesheets draw the element itself, where every rule read here hides one. */
function drawn(element: Element): boolean {
  return getComputedStyle(element).display !== "none";
}

/** The tab's parts as these tests read them: the tree's toggle the stylesheet shows, and the tree where it is drawn. */
function parts(tab: HTMLElement) {
  const toggles = () =>
    [...tab.querySelectorAll(".file-tree-toggle")]
      .filter(drawn)
      .flatMap((place) => [...place.querySelectorAll("button")]);
  const tree = () => tab.querySelector('[aria-label="Changed files"]');
  const treeDrawn = () => {
    const found = tree();
    return found !== null && drawn(found);
  };
  const floats = () => {
    const found = tree();
    return found !== null && getComputedStyle(found).position === "absolute";
  };
  return { toggles, tree, treeDrawn, floats };
}

test("on a phone the diff has the whole width, the tree held open standing nowhere until its toggle opens it over the diff, and a press on the diff puts it away", async () => {
  const tab = await drawChangesTab(SHELL_ROOM.NARROW);
  const { toggles, treeDrawn, floats } = parts(tab);

  assert.ok(!treeDrawn(), "the tree the panel holds open stands nowhere beside the diff");
  assert.deepEqual(
    toggles().map((button) => button.getAttribute("aria-label")),
    ["Show files"],
  );

  await act(async () => toggles()[0]?.click());
  assert.ok(treeDrawn(), "the toggle opens the tree");
  assert.ok(floats(), "it stands over the diff, never beside it");

  act(() => {
    tab
      .querySelector(".file-tab")
      ?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  assert.ok(!treeDrawn(), "a press on the diff takes the tree down");
});

test("the desktop's side panel at the same width keeps the tree beside the diff, as the panel holds it", async () => {
  const tab = await drawChangesTab(SHELL_ROOM.WIDE);
  const { toggles, treeDrawn, floats } = parts(tab);
  assert.ok(treeDrawn(), "the tree stands");
  assert.ok(!floats(), "beside the diff");
  assert.deepEqual(
    toggles().map((button) => button.getAttribute("aria-label")),
    ["Hide files"],
  );
});
