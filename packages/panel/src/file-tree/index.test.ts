// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { FILE_MARK, type FileMark, type FileTreeHandle } from "./contract.js";
import { fileTree } from "./index.js";

/**
 * index.test.ts -- a change set's tree draws at each file's row's end what
 * its mark carries past what became of it: how many review threads stand on
 * it, the lines it adds and removes, and a Viewed toggle, ticked once the
 * file is viewed; a folder's row says nothing more. A press on the toggle
 * is the toggle's alone, the row neither opening its file nor taking the
 * keyboard, while a press anywhere else on the row opens the file. The
 * tree is the bundle's own, Pierre drawing it in jsdom; synthetic paths.
 */

const PATHS = ["src/seats.ts", "src/plan.md", "README.md"] as const;

let mounted: { host: HTMLElement; handle: FileTreeHandle } | undefined;

afterEach(() => {
  mounted?.handle.unmount();
  mounted = undefined;
  document.body.innerHTML = "";
});

/** Lets the tree's listing and Pierre's drawing land. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

/** The tree mounted over the change set's files alone, every folder open, marked as given, with what it opened and marked. */
async function mountMarked(marks: readonly FileMark[]) {
  const opened: string[] = [];
  const viewed: string[] = [];
  const host = document.body.appendChild(document.createElement("div"));
  const handle = fileTree.mount(host, {
    readFolder: () => Promise.resolve({ entries: [], truncated: false }),
    onOpen: (path) => opened.push(path),
    onViewed: (path) => viewed.push(path),
  });
  mounted = { host, handle };
  await settle();
  handle.only(PATHS);
  handle.mark(marks);
  await settle();
  return { handle, opened, viewed };
}

/** The row the tree drew for a path, through its shadow root. */
function row(path: string): HTMLElement {
  for (const container of mounted?.host.querySelectorAll("file-tree-container") ?? []) {
    const found = container.shadowRoot?.querySelector<HTMLElement>(`[data-item-path="${path}"]`);
    if (found !== null && found !== undefined && container.closest("[hidden]") === null) {
      return found;
    }
  }
  return assert.fail(`the tree draws ${path}`);
}

/** The words at the end of a row, part by part. */
function parts(path: string): string[] {
  const run = row(path).querySelector('[data-item-section="decoration"] > span');
  return [...(run?.children ?? [])].map((part) => part.textContent ?? "");
}

/** A row's Viewed toggle, the last part of its run. */
function toggle(path: string): HTMLElement {
  const run = row(path).querySelector('[data-item-section="decoration"] > span');
  const part = run?.children[4];
  return part instanceof HTMLElement ? part : assert.fail(`${path} draws a Viewed toggle`);
}

const MARKS: readonly FileMark[] = [
  {
    path: "src/seats.ts",
    status: FILE_MARK.MODIFIED,
    lines: { additions: 12, deletions: 4 },
    threads: 2,
    viewed: false,
  },
  {
    path: "src/plan.md",
    status: FILE_MARK.ADDED,
    lines: { additions: 30, deletions: 0 },
    threads: 0,
    viewed: true,
  },
  { path: "README.md", status: FILE_MARK.DELETED },
];

test("a file's row ends in its threads, its lines, and its Viewed toggle; a folder's and a bare mark's say nothing more", async () => {
  await mountMarked(MARKS);

  assert.deepEqual(parts("src/seats.ts"), ["", "2", "+12", "−4", ""]);
  assert.deepEqual(parts("src/plan.md"), ["", "", "+30", "", "Viewed"]);
  assert.match(
    row("src/seats.ts").querySelector("[title]")?.getAttribute("title") ?? "",
    /2 comments/u,
  );
  assert.deepEqual(parts("README.md"), []);
  assert.deepEqual(parts("src/"), []);
});

test("a press on a row's Viewed toggle marks its file and opens nothing; a press on the rest of the row opens it", async () => {
  const { opened, viewed } = await mountMarked(MARKS);

  toggle("src/seats.ts").dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  assert.deepEqual(viewed, ["src/seats.ts"]);
  assert.deepEqual(opened, []);

  row("src/seats.ts").click();
  assert.deepEqual(opened, ["src/seats.ts"]);
  assert.deepEqual(viewed, ["src/seats.ts"]);
});

test("marks handed again redraw the rows, a file marked viewed since ticked", async () => {
  const { handle } = await mountMarked(MARKS);

  handle.mark(
    MARKS.map((mark) => ({ ...mark, viewed: mark.viewed === undefined ? undefined : true })),
  );
  await settle();

  assert.equal(parts("src/seats.ts")[4], "Viewed");
});

test("a mark that does not say whether its file is viewed draws no toggle", async () => {
  await mountMarked([{ path: "src/seats.ts", status: FILE_MARK.MODIFIED, threads: 1 }]);

  assert.deepEqual(parts("src/seats.ts"), ["", "1", "", ""]);
});
