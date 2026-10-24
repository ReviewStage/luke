/**
 * file-view-menu.test.ts -- the end of a File tab's bar as the developer meets it: View settings offering the settings a File tab's lines follow, its wrap, numbers, minimized notes, syntax theme, and type, each drawn at once, and a ⋯ of actions alone, its Copy path copying the file's path. Synthetic files only.
 */

// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TaskFileRequest } from "@luke/features/task-wire";
import { TASK_CALL_FAILURE, type TasksFileAnswer } from "@luke/features/tasks-view";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { copyingInto, fakeAppPlatform } from "../testing/app-platform.js";
import { handSettings } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { installScrollTo, wholeFileDrawn, wholeFileRoot } from "../testing/whole-file.js";
import { WHOLE_TEXT } from "./file-tab-model.js";
import { FileView, FileViewBar, useFileViewEnd } from "./file-view.js";
import { WholeFile } from "./whole-file.js";

const PATH = "src/billing/plan.ts";
const HEAD = "0123456789abcdef0123456789abcdef01234567";

const roots: Root[] = [];

beforeEach(() => {
  // View settings opens its syntax theme on the window's appearance, here the dark one.
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("dark") }));
  installScrollIntoView();
  fakeAppBridge({});
  handSettings();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** A File tab's file as the tab draws it, in the look it reads. */
function DrawnLines(): React.JSX.Element {
  return createElement(WholeFile, {
    name: PATH,
    text: "const seats = 3;\n",
    revision: "abc123",
    lit: undefined,
    notes: [],
    findFrom: 1,
  });
}

/** How the drawn file stands: its numbers, its wrap, and the type its scroller names. */
function drawnLines(container: HTMLElement) {
  const scroller =
    container.querySelector<HTMLElement>(".whole-file > .luke-scroll-area") ??
    assert.fail("the file is drawn");
  const pre =
    wholeFileRoot(container)?.querySelector("pre") ?? assert.fail("the file's lines are drawn");
  return {
    numbers: String(!pre.hasAttribute("data-disable-line-numbers")),
    wrap: String(pre.getAttribute("data-overflow") === "wrap"),
    font: scroller.style.getPropertyValue("--diffs-font-family"),
    size: scroller.style.getPropertyValue("--diffs-font-size"),
    lineHeight: scroller.style.getPropertyValue("--diffs-line-height"),
    features: scroller.style.getPropertyValue("--diffs-font-features"),
  };
}

/** A File tab's bar with the end its tab hands it. */
function Bar(): React.JSX.Element {
  const end = useFileViewEnd({
    path: PATH,
    ready: true,
    readText: () => Promise.resolve({ kind: WHOLE_TEXT.READ, text: "" }),
  });
  return createElement(FileViewBar, { lead: null, onGitHub: undefined, ...end });
}

/** Draws the bar's end beside the look the tab's lines follow. */
function mount(): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement("div", null, createElement(Bar), createElement(DrawnLines)),
      ),
    ),
  );
  return container;
}

/** Presses the button of a name in the bar. */
function press(container: HTMLElement, name: string): void {
  const button =
    container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`) ??
    assert.fail(`the bar offers ${name}`);
  act(() => button.click());
}

test("View settings on a File tab offers its lines' wrap, numbers, minimized notes, syntax theme, and type, and each is drawn on its lines at once", async () => {
  const container = mount();
  await wholeFileDrawn(container);
  press(container, "View settings");
  const popover = document.querySelector<HTMLElement>('[role="dialog"]') ?? assert.fail();

  assert.deepEqual(
    [...popover.querySelectorAll("h3")].map((heading) => heading.textContent),
    ["Lines", "Text"],
  );
  assert.deepEqual(
    [...popover.querySelectorAll('[role="switch"], [role="radiogroup"], [aria-haspopup]')].map(
      // A pop-up's name ends with the value it names, which is not the row's.
      (control) => control.getAttribute("aria-label")?.split(": ")[0],
    ),
    [
      "Word wrap",
      "Line numbers",
      "Minimize inline comments",
      "Syntax theme",
      "For dark mode",
      "Font",
      "Font size",
      "Line height",
      "Ligatures",
    ],
  );
  assert.deepEqual(drawnLines(container), {
    numbers: "true",
    wrap: "true",
    font: "var(--luke-font-mono)",
    size: "11.5px",
    lineHeight: "1.6",
    features: "'liga' 0, 'calt' 0",
  });

  const switches = (name: string) =>
    [...popover.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find(
      (each) => each.getAttribute("aria-label") === name,
    );
  await act(async () => switches("Line numbers")?.click());
  await act(async () => switches("Ligatures")?.click());
  await vi.waitFor(() => assert.equal(drawnLines(container).numbers, "false"));
  assert.equal(drawnLines(container).features, "'liga' 1, 'calt' 1");
});

test("a File tab's ⋯ holds its actions alone, and Copy path copies the file's path from the repository's root", async () => {
  const copied: string[] = [];
  fakeAppPlatform(copyingInto(copied));
  const container = mount();
  press(container, "File actions");

  const items = [...document.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')];
  assert.deepEqual(
    items.map((item) => item.textContent),
    ["Copy file name", "Copy path", "Copy file contents", "Download file"],
  );
  await act(async () => items[1]?.click());
  assert.deepEqual(copied, [PATH]);
});

test("Copy file contents copies the text the tab draws, read at its commit, rather than reading the branch again", async () => {
  installScrollTo();
  const copied: string[] = [];
  fakeAppPlatform(copyingInto(copied));
  const asked: TaskFileRequest[] = [];
  // The service: the head's commit from the first line, the text at it, and newer text once the branch moves on.
  const readFile = (request: TaskFileRequest): Promise<TasksFileAnswer> => {
    asked.push(request);
    if (request.raw !== true) {
      return Promise.resolve({
        file: {
          path: PATH,
          repository: "acme/relay",
          branch: "main",
          commit: HEAD,
          firstLine: 1,
          lineCount: 1,
          lines: ["x"],
        },
      });
    }
    const text = request.ref === HEAD ? "const seats = 3;\n" : "const seats = 4;\n";
    return Promise.resolve({
      text: { path: PATH, repository: "acme/relay", branch: "main", text },
    });
  };
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(FileView, {
          taskId: "task-1",
          repository: null,
          file: { path: PATH, range: undefined, opened: 1 },
          snippet: undefined,
          shownCode: [],
          readFile,
          readFolder: () => Promise.resolve({ failure: TASK_CALL_FAILURE.UNANSWERED }),
          readWhole: () => Promise.resolve({ failure: TASK_CALL_FAILURE.UNANSWERED }),
          openGitHub: () => undefined,
          treeOpen: false,
          onToggleTree: () => undefined,
          onBrowse: () => undefined,
          history: { canGoBack: false, canGoForward: false, onStep: () => undefined },
          onFoldNote: () => undefined,
        }),
      ),
    ),
  );
  await wholeFileDrawn(container);
  press(container, "File actions");
  const copy = [...document.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')].find(
    (item) => item.textContent === "Copy file contents",
  );
  await act(async () => copy?.click());

  assert.deepEqual(copied, ["const seats = 3;\n"]);
  assert.equal(asked.length, 2, "nothing more is read for the copy");
});
