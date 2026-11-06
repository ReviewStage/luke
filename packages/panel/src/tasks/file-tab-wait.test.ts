// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TaskFileRequest } from "@repo/features/task-wire";
import type { TasksFileAnswer } from "@repo/features/tasks-view";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { FindScope } from "../find-in-tab.js";
import { fakeActPort, readingFiles } from "../testing/app-bridge.js";
import { DESKTOP_LINKS, fakeAppPlatform } from "../testing/app-platform.js";
import { handSettings } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { installScrollTo, wholeFileDrawn, wholeFileLines } from "../testing/whole-file.js";
import { FileTab } from "./file-tab.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PATH = "src/seats.ts";
const TEXT = "const seats = 3;\nconst invited = 0;\nexport { seats };\n";

let root: Root | undefined;

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("dark"),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
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

const read = (request: TaskFileRequest): Promise<TasksFileAnswer> => {
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

function reading(): boolean {
  return [...document.querySelectorAll('[role="status"]')].some((status) =>
    status.textContent?.includes("Reading the file"),
  );
}

test("a File tab says it is reading the file until its lines are drawn, never standing blank once the bundle lands", async () => {
  const states: { reading: boolean; lines: number }[] = [];
  const observer = new MutationObserver(() =>
    states.push({ reading: reading(), lines: wholeFileLines(document.body).length }),
  );
  observer.observe(document.body, { subtree: true, childList: true });
  fakeActPort(readingFiles(read));
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
            place: { taskId: "task-1" },
            file: { path: PATH, range: undefined, opened: 1 },
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
