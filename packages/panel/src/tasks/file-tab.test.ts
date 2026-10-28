// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TaskFileRequest } from "@luke/features/task-wire";
import type { TasksFileAnswer } from "@luke/features/tasks-view";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { FindScope } from "../find-in-tab.js";
import { DESKTOP_LINKS, fakeAppPlatform } from "../testing/app-platform.js";
import { handSettings } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import {
  installScrollTo,
  wholeFileDrawn,
  wholeFileLines,
  wholeFileRoot,
} from "../testing/whole-file.js";
import { FileTab, type ReadFileWindow } from "./file-tab.js";
import type { OpenFile } from "./use-side-panel.js";

/**
 * file-tab.test.ts -- a File tab as the developer meets it, its file drawn by
 * the real diff bundle: read whole, at the head's commit or the one the tab
 * is pinned to, the lines it was opened on lit; and ⌘F counting every match
 * in the file. Synthetic repository.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const PINNED = "89abcdef0123456789abcdef0123456789abcdef";
const PATH = "src/seats.ts";
const TEXT = [
  "const seats = 3;",
  "const invited = 0;",
  "function seat() {",
  "  return seats;",
  "}",
  "export { seat };",
  "",
].join("\n");

const roots: Root[] = [];

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("dark"),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  // jsdom paints no highlights; the find's are kept as a browser keeps them.
  vi.stubGlobal("CSS", { highlights: new Map() });
  vi.stubGlobal("Highlight", Set);
  // jsdom lays nothing out, so a range has no box to scroll to.
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  installScrollIntoView();
  installScrollTo();
  handSettings();
  fakeAppPlatform({ ...DESKTOP_LINKS });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** The service, as the tab reads through it: the file's first line at the head's commit, and its whole text raw; every read written down. */
function service(asked: TaskFileRequest[]): ReadFileWindow {
  return (request) => {
    asked.push(request);
    const answer: TasksFileAnswer =
      request.raw === true
        ? { text: { path: PATH, repository: "acme/relay", branch: "main", text: TEXT } }
        : {
            file: {
              path: PATH,
              repository: "acme/relay",
              branch: "main",
              commit: HEAD,
              firstLine: 1,
              lineCount: 6,
              lines: ["const seats = 3;"],
            },
          };
    return Promise.resolve(answer);
  };
}

/** A File tab opened on `file`, in a find's scope, drawn once its file is. */
async function tab(file: OpenFile, read: ReadFileWindow): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          FindScope,
          { active: true, subject: { task: "task-1", tab: { file: PATH } } },
          createElement(FileTab, { file, readFile: read, onRead: () => undefined }),
        ),
      ),
    ),
  );
  await wholeFileDrawn(container);
  return container;
}

/** The lines the file draws lit. */
function litLines(container: HTMLElement): (string | null)[] {
  return [
    ...(wholeFileRoot(container)?.querySelectorAll("[data-line][data-selected-line]") ?? []),
  ].map((row) => row.getAttribute("data-line"));
}

test("a File tab reads its file's first line for the commit the head stands at, then the whole text at that commit, and draws every line", async () => {
  const asked: TaskFileRequest[] = [];
  const container = await tab({ path: PATH, range: undefined, opened: 1 }, service(asked));

  assert.deepEqual(asked, [
    { path: PATH, firstLine: 1, lastLine: 1 },
    { path: PATH, firstLine: 1, lastLine: 1, raw: true, ref: HEAD },
  ]);
  assert.deepEqual(wholeFileLines(container), [
    "1 const seats = 3;",
    "2 const invited = 0;",
    "3 function seat() {",
    "4   return seats;",
    "5 }",
    "6 export { seat };",
  ]);
});

test("a File tab pinned to a commit reads the whole text there in one read", async () => {
  const asked: TaskFileRequest[] = [];
  const read = service(asked);
  // The tab's door pins every read to the commit, as the File view's does.
  await tab({ path: PATH, range: undefined, opened: 1, commit: PINNED }, (request) =>
    read({ ...request, ref: PINNED }),
  );

  assert.deepEqual(asked, [{ path: PATH, firstLine: 1, lastLine: 1, raw: true, ref: PINNED }]);
});

test("the lines a File tab was opened on are lit", async () => {
  const container = await tab(
    { path: PATH, range: { startLine: 1, endLine: 1 }, opened: 1 },
    service([]),
  );

  assert.deepEqual(litLines(container), ["1"]);
});

/** Types into the find bar's field as the keyboard does, which React hears as an input. */
function typeFind(text: string): void {
  const field = document.querySelector<HTMLInputElement>('.find-bar input[aria-label="Find"]');
  assert.ok(field, "the find bar stands open");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** What the find bar's tally says. */
function findTally(): string | null | undefined {
  return document.querySelector('[role="search"][aria-label="Find"] .luke-search-field-tally')
    ?.textContent;
}

test("⌘F over a File tab counts every match in the file, from its text, and steps through them", async () => {
  await tab({ path: PATH, range: undefined, opened: 1 }, service([]));
  act(() => {
    runAppCommand(APP_COMMAND.FIND);
  });
  typeFind("seat");

  // Four on the lines: seats, seat, seats, and the export's seat.
  assert.equal(findTally(), "1 of 4");
  act(() => {
    runAppCommand(APP_COMMAND.FIND_NEXT);
  });
  assert.equal(findTally(), "2 of 4");
});
