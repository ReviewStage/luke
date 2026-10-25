// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TasksFileAnswer } from "@luke/features/tasks-view";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { FindScope } from "../find-in-tab.js";
import { DESKTOP_LINKS, fakeAppPlatform } from "../testing/app-platform.js";
import { handSettings } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { installScrollTo, wholeFileDrawn, wholeFileLines } from "../testing/whole-file.js";
import { FileTab, type ReadFileWindow } from "./file-tab.js";

/**
 * file-tab-wait.test.ts -- a File tab says it is reading its file until the
 * file's lines are drawn, never standing blank between the diff bundle
 * landing and Pierre drawing the lines, as a first file the window opens
 * does while its highlighting first loads. A file of its own, because the
 * bundle and its highlighting load once a process, so only the first File
 * tab a process opens meets the gap. Synthetic repository.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PATH = "src/seats.ts";
const TEXT = "const seats = 3;\nconst invited = 0;\nexport { seats };\n";

let root: Root | undefined;

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("dark") }));
  // jsdom paints no highlights and lays nothing out, as the find and Pierre's scroll would ask.
  vi.stubGlobal("CSS", { highlights: new Map() });
  vi.stubGlobal("Highlight", Set);
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  installScrollIntoView();
  installScrollTo();
  handSettings();
  fakeAppPlatform({ ...DESKTOP_LINKS });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** The service, as the tab reads through it: the file's first line, then its whole text. */
const read: ReadFileWindow = (request) => {
  const place = { path: PATH, repository: "acme/relay", branch: "main" };
  const answer: TasksFileAnswer =
    request.raw === true
      ? { text: { ...place, text: TEXT } }
      : {
          file: {
            ...place,
            commit: "0123456789abcdef0123456789abcdef01234567",
            firstLine: 1,
            lineCount: 3,
            lines: ["const seats = 3;"],
          },
        };
  return Promise.resolve(answer);
};

/** Whether the page says it is reading the file. */
function reading(): boolean {
  return [...document.querySelectorAll('[role="status"]')].some((status) =>
    status.textContent?.includes("Reading the file"),
  );
}

test("a File tab says it is reading the file until its lines are drawn, never standing blank once the bundle lands", async () => {
  // Each state the page passes through as it changes: whether it says it is reading, and how many lines it draws.
  const states: { reading: boolean; lines: number }[] = [];
  const observer = new MutationObserver(() =>
    states.push({ reading: reading(), lines: wholeFileLines(document.body).length }),
  );
  observer.observe(document.body, { subtree: true, childList: true });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          FindScope,
          { active: true, subject: { task: "task-1", tab: { file: PATH } } },
          createElement(FileTab, {
            file: { path: PATH, range: undefined, opened: 1 },
            snippet: undefined,
            notes: {
              notes: [],
              folded: [],
              onFold: () => undefined,
              taskId: "task-1",
              agentLabel: () => undefined,
            },
            readFile: read,
            onRead: () => undefined,
          }),
        ),
      ),
    ),
  );
  await wholeFileDrawn(container);
  await act(async () => undefined);
  observer.disconnect();

  const waited = states.findIndex((state) => state.reading);
  assert.notEqual(waited, -1, "the tab said it was reading");
  assert.deepEqual(
    states.slice(waited).filter((state) => !state.reading && state.lines === 0),
    [],
    "no moment stands with neither the wait nor a line",
  );
  assert.equal(reading(), false);
  assert.equal(wholeFileLines(container).length, 3);
});
