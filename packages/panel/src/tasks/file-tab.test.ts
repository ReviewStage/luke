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
import { LinkWorkspaceProvider } from "../copy-link-item.js";
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
import type { FileNotes } from "./file-note.js";
import { FileTab, type ReadFileWindow } from "./file-tab.js";
import { OpenLinkProvider } from "./use-open-link.js";
import type { OpenFile } from "./use-side-panel.js";

/**
 * file-tab.test.ts -- a File tab as the developer meets it, its file drawn by
 * the real diff bundle: read whole, at the head's commit or the one the tab
 * is pinned to; Luke's note under the last line of its range, lighting its
 * lines under the pointer, or put away behind a chip while Minimize inline
 * comments is on, which I turns; and ⌘F counting every match in the file and
 * in the notes' words. Synthetic repository.
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
const NOTE = "Seats are counted before the invite goes out";

const roots: Root[] = [];

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("dark") }));
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
              lines: [[{ text: "const seats = 3;" }]],
            },
          };
    return Promise.resolve(answer);
  };
}

const NOTES = [
  { callId: "call-1", shownAt: 1_760_000_000_000, startLine: 3, endLine: 4, note: NOTE },
];

function notes(shown: FileNotes["notes"] = NOTES): FileNotes {
  return {
    notes: shown,
    folded: [],
    onFold: () => undefined,
    taskId: "task-1",
  };
}

/** Draws the latest tab mounted again with Luke's notes as `shown`, as a note he adds does. */
let draw: (shown: FileNotes["notes"]) => void = () => undefined;

/** A File tab opened on `file`, in a find's scope, drawn once its file is. */
async function tab(file: OpenFile, read: ReadFileWindow): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  draw = (shown) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          createElement(
            OpenLinkProvider,
            { value: () => undefined },
            createElement(
              LinkWorkspaceProvider,
              { value: "acme" },
              createElement(
                FindScope,
                { active: true, subject: { task: "task-1", tab: { file: PATH } } },
                createElement(FileTab, {
                  file,
                  snippet: undefined,
                  notes: notes(shown),
                  readFile: read,
                  onRead: () => undefined,
                }),
              ),
            ),
          ),
        ),
      ),
    );
  draw(NOTES);
  await wholeFileDrawn(container);
  return container;
}

/** The element the note is drawn in, under its line. */
function noteSlot(container: HTMLElement): Element {
  return container.querySelector("[data-whole-file-note]") ?? assert.fail("the note is drawn");
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

test("the lines a File tab was opened on are lit, and Luke's note stands under the last line of its range, lighting its own lines under the pointer", async () => {
  const container = await tab(
    { path: PATH, range: { startLine: 1, endLine: 1 }, opened: 1 },
    service([]),
  );

  assert.deepEqual(litLines(container), ["1"]);
  assert.equal(noteSlot(container).parentElement?.getAttribute("slot"), "annotation-4");
  assert.match(noteSlot(container).textContent ?? "", /Seats are counted/);
  assert.ok(
    noteSlot(container).querySelector('button[aria-label="Note actions"]'),
    "its ⋯ stands at rest, the page's links reaching it under its line",
  );

  const note = noteSlot(container).querySelector(".file-note") ?? assert.fail("the card is drawn");
  act(() => note.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  await vi.waitFor(() => assert.deepEqual(litLines(container), ["3", "4"]));

  act(() => note.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
  await vi.waitFor(() => assert.deepEqual(litLines(container), ["1"]));
});

test("with Minimize inline comments on, Luke's note stands behind a chip with his mark, which shows it, and I in the tab turns the setting", async () => {
  handSettings({ diffMinimizeComments: true });
  const container = await tab({ path: PATH, range: undefined, opened: 1 }, service([]));
  const chip = () => noteSlot(container).querySelector<HTMLElement>(".diff-thread-chip");

  assert.equal(chip()?.getAttribute("aria-label"), "Luke's note on lines 3–4, show");
  assert.ok(chip()?.querySelector(".transcript-luke-mark"));
  act(() => chip()?.click());
  assert.equal(chip()?.getAttribute("aria-label"), "Luke's note on lines 3–4, hide");

  const section = container.querySelector<HTMLElement>(".file-tab") ?? assert.fail();
  await act(async () => {
    section.dispatchEvent(new KeyboardEvent("keydown", { key: "i", code: "KeyI", bubbles: true }));
  });
  assert.equal(chip(), null, "the note stands as its card again");

  await act(async () => {
    section.dispatchEvent(new KeyboardEvent("keydown", { key: "i", code: "KeyI", bubbles: true }));
  });
  assert.equal(chip()?.getAttribute("aria-label"), "Luke's note on lines 3–4, show");
});

/** Types into the find bar's field as the keyboard does, which React hears as an input. */
function typeFind(text: string): void {
  const field = document.querySelector<HTMLInputElement>(
    'search.find-bar input[aria-label="Find"]',
  );
  assert.ok(field, "the find bar stands open");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** What the find bar's tally says. */
function findTally(): string | null | undefined {
  return document.querySelector('search[aria-label="Find"] [aria-live="polite"]')?.textContent;
}

test("⌘F over a File tab counts every match in the file and in Luke's notes, from its text, and steps through them", async () => {
  await tab({ path: PATH, range: undefined, opened: 1 }, service([]));
  act(() => {
    runAppCommand(APP_COMMAND.FIND);
  });
  typeFind("seat");

  // Four on the lines (seats, seat, seats, and the export's seat), and one in the note.
  assert.equal(findTally(), "1 of 5");
  act(() => {
    runAppCommand(APP_COMMAND.FIND_NEXT);
  });
  assert.equal(findTally(), "2 of 5");
});

test("a note Luke adds while ⌘F stands open over a File tab joins the count at once, the find kept at its match", async () => {
  const container = await tab({ path: PATH, range: undefined, opened: 1 }, service([]));
  act(() => {
    runAppCommand(APP_COMMAND.FIND);
  });
  typeFind("seat");
  act(() => {
    runAppCommand(APP_COMMAND.FIND_NEXT);
  });
  assert.equal(findTally(), "2 of 5");

  draw([
    ...NOTES,
    {
      callId: "call-2",
      shownAt: 1_760_000_100_000,
      startLine: 6,
      endLine: 6,
      note: "The seat is exported",
    },
  ]);
  await wholeFileDrawn(container);

  assert.equal(findTally(), "2 of 6");
});

test("⌘F counts a note's words as its card shows them: a link by its words and never its address, a code span as written", async () => {
  const container = await tab({ path: PATH, range: undefined, opened: 1 }, service([]));
  draw([
    {
      callId: "call-1",
      shownAt: 1_760_000_000_000,
      startLine: 3,
      endLine: 4,
      note: "See [the docs](https://example.com/seat) and `seat**s`",
    },
  ]);
  await wholeFileDrawn(container);
  act(() => {
    runAppCommand(APP_COMMAND.FIND);
  });
  typeFind("seat");

  // Four on the lines, and one in the note's code span; none in the link's address.
  assert.equal(findTally(), "1 of 5");
  typeFind("seat**s");
  assert.equal(findTally(), "1 of 1");
});

test("a note's card drawing new words of its own while ⌘F stands open, as its age moves on, is counted again", async () => {
  const container = await tab({ path: PATH, range: undefined, opened: 1 }, service([]));
  act(() => {
    runAppCommand(APP_COMMAND.FIND);
  });
  typeFind("seat");
  assert.equal(findTally(), "1 of 5");

  // The card's own words change with no draw of the tab's, as its age does each minute.
  const words =
    noteSlot(container).querySelector(".file-note-words") ??
    assert.fail("the note's words are drawn");
  act(() => words.append(document.createTextNode(" One more seat.")));

  await vi.waitFor(() => assert.equal(findTally(), "1 of 6"));
});
