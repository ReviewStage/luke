// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  DIFF_FONT,
  DIFF_INDICATORS,
  DIFF_LAYOUT,
  DIFF_LINE_HEIGHT,
  INLINE_DIFF,
} from "@luke/settings/diff-view";
import { afterEach, beforeAll, test, vi } from "vitest";
import type { DiffLook, FileViewHandle, FileViewProps } from "./contract.js";
import { diffView } from "./index.js";

/**
 * whole-file.test.ts -- a whole file drawn by the diff bundle with no diff,
 * as a File tab draws one (`mountFile`), a patch drawn alone with notes
 * under its lines (`mount`), and a list's notes and scrolls (`mountList`): Pierre draws them in jsdom on the window's own
 * thread, since no worker text was built in, and the tests read what it drew
 * in the shadow root and what the view's own elements hold.
 */

const LOOK: DiffLook = {
  layout: DIFF_LAYOUT.UNIFIED,
  indicators: DIFF_INDICATORS.BARS,
  inlineDiff: INLINE_DIFF.WORD_ALT,
  backgrounds: true,
  lineNumbers: true,
  wrap: false,
  themes: { dark: "github-dark-default", light: "github-light-default" },
  font: DIFF_FONT.SF_MONO,
  fontSize: "11.5",
  lineHeight: DIFF_LINE_HEIGHT.NORMAL,
  ligatures: false,
};

/** The motion token saying how a scroller a component moves itself gets there, `auto` where motion is held still. */
const SCROLL_GLIDE = "--luke-scroll-glide";

const TEXT = "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n";

/** The element each note was drawn in, by its key, as the view keeps them. */
let kept = new Map<string, HTMLElement>();
let mounted: Array<{ unmount: () => void }> = [];

afterEach(() => {
  for (const each of mounted) each.unmount();
  mounted = [];
  kept = new Map();
  document.body.replaceChildren();
  document.documentElement.style.removeProperty(SCROLL_GLIDE);
  vi.restoreAllMocks();
});

/** The view's element for a note, made the first time it is asked for. */
function noteElement(key: string): HTMLElement {
  const held = kept.get(key);
  if (held !== undefined) return held;
  const element = document.createElement("div");
  element.textContent = `note ${key}`;
  kept.set(key, element);
  return element;
}

function props(overrides: Partial<FileViewProps> = {}): FileViewProps {
  return {
    name: "src/seats.ts",
    text: TEXT,
    revision: "abc123",
    look: LOOK,
    annotations: [],
    renderAnnotation: noteElement,
    ...overrides,
  };
}

/** A file mounted under a host of its own, and the host. */
function mountFile(drawn: FileViewProps): { host: HTMLElement; handle: FileViewHandle } {
  const host = document.createElement("div");
  document.body.append(host);
  const handle = diffView.mountFile(host, drawn);
  mounted.push(handle);
  return { host, handle };
}

/** The shadow root Pierre drew the file in. */
function drawnRoot(host: HTMLElement): ShadowRoot {
  const root = host.querySelector("diffs-container")?.shadowRoot;
  assert.ok(root, "the file is drawn in a shadow root");
  return root;
}

/** Waits for Pierre's next frame, where it draws what it was handed. */
function nextFrame(): Promise<void> {
  return new Promise((done) => requestAnimationFrame(() => done()));
}

/** The numbers of the rows of code drawn, in order. */
function drawnLines(root: ShadowRoot, selector = "[data-line]"): number[] {
  return [...root.querySelectorAll(selector)].map((row) => Number(row.getAttribute("data-line")));
}

// Note that Pierre draws nothing until its highlighter has loaded, once for the run, so the tests wait for it here rather than each on its first frame.
beforeAll(async () => {
  const { host, handle } = mountFile(props());
  for (let frame = 0; frame < 300; frame += 1) {
    if (host.querySelector("diffs-container")?.shadowRoot?.querySelector("[data-line]")) break;
    await nextFrame();
  }
  handle.unmount();
  mounted = [];
  document.body.replaceChildren();
});

test("a whole file is drawn numbered from its first line, with no empty line after its final newline", async () => {
  const { host } = mountFile(props());
  await nextFrame();
  const root = drawnRoot(host);
  assert.deepEqual(drawnLines(root), [1, 2, 3, 4]);
  assert.equal(root.querySelector('[data-line="2"]')?.textContent, "const b = 2;");
});

test("the file's numbers are left out of the find and of what a screen reader reads", async () => {
  const { host } = mountFile(props());
  await nextFrame();
  const container = host.querySelector("diffs-container");
  assert.equal(container?.getAttribute("data-find-shadow"), "[data-gutter]");
  const gutters = [...drawnRoot(host).querySelectorAll("[data-gutter]")];
  assert.ok(gutters.length > 0);
  assert.ok(gutters.every((gutter) => gutter.getAttribute("aria-hidden") === "true"));
});

test("the lit lines are lit, others take their place as they change, and none stand once let go", async () => {
  const { host, handle } = mountFile(props({ lit: { startLine: 2, endLine: 3 } }));
  await nextFrame();
  const root = drawnRoot(host);
  assert.deepEqual(drawnLines(root, "[data-line][data-selected-line]"), [2, 3]);
  handle.update(props({ lit: { startLine: 4, endLine: 4 } }));
  await nextFrame();
  assert.deepEqual(drawnLines(root, "[data-line][data-selected-line]"), [4]);
  handle.update(props());
  await nextFrame();
  assert.deepEqual(drawnLines(root, "[data-line][data-selected-line]"), []);
});

test("each note is drawn in the view's own element under its line, and moves as the notes change", async () => {
  const { host, handle } = mountFile(props({ annotations: [{ key: "n1", line: 2 }] }));
  await nextFrame();
  const slotted = (key: string) => kept.get(key)?.parentElement?.getAttribute("slot");
  assert.equal(slotted("n1"), "annotation-2");
  assert.ok(drawnRoot(host).querySelector('slot[name="annotation-2"]'));
  handle.update(
    props({
      annotations: [
        { key: "n1", line: 2 },
        { key: "n2", line: 4 },
      ],
    }),
  );
  await nextFrame();
  assert.equal(slotted("n2"), "annotation-4");
  assert.ok(drawnRoot(host).querySelector('slot[name="annotation-4"]'));
});

test("a file whose text changes draws its new lines", async () => {
  const { host, handle } = mountFile(props());
  await nextFrame();
  handle.update(props({ text: "let only = true;\n", revision: "def456" }));
  await nextFrame();
  const root = drawnRoot(host);
  assert.deepEqual(drawnLines(root), [1]);
  assert.equal(root.querySelector('[data-line="1"]')?.textContent, "let only = true;");
});

test("no lines are picked until the reader picks some", async () => {
  const { handle } = mountFile(props({ lit: { startLine: 2, endLine: 2 } }));
  await nextFrame();
  assert.equal(handle.pickedLines(), undefined);
});

test("lines picked by pressing their numbers are the reader's pick, until the view lights others", async () => {
  const { host, handle } = mountFile(props({ lit: { startLine: 1, endLine: 1 } }));
  await nextFrame();
  const press = (line: number, shiftKey = false) => {
    const number = drawnRoot(host).querySelector(`[data-column-number="${line}"]`);
    assert.ok(number);
    const at = {
      bubbles: true,
      composed: true,
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      shiftKey,
    };
    number.dispatchEvent(new PointerEvent("pointerdown", at));
    document.dispatchEvent(new PointerEvent("pointerup", at));
  };
  press(3);
  press(2, true);
  assert.deepEqual(handle.pickedLines(), { startLine: 2, endLine: 3 });
  handle.update(props({ lit: { startLine: 4, endLine: 4 } }));
  assert.equal(handle.pickedLines(), undefined);
});

test("lines picked in one file are no pick once another file takes its place", async () => {
  const { host, handle } = mountFile(props());
  await nextFrame();
  const number = drawnRoot(host).querySelector('[data-column-number="2"]');
  assert.ok(number);
  const at = { bubbles: true, composed: true, button: 0, pointerId: 1, pointerType: "mouse" };
  number.dispatchEvent(new PointerEvent("pointerdown", at));
  document.dispatchEvent(new PointerEvent("pointerup", at));
  assert.deepEqual(handle.pickedLines(), { startLine: 2, endLine: 2 });
  handle.update(props({ name: "src/other.ts", text: "let other = 1;\nlet more = 2;\n" }));
  assert.equal(handle.pickedLines(), undefined);
});

test("a patch drawn alone draws each note in the view's own element under its line", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const patch =
    "--- a/seats.ts\n+++ b/seats.ts\n@@ -10,2 +10,2 @@\n const kept = 1;\n-const gone = 2;\n+const come = 2;\n";
  const handle = diffView.mount(host, {
    patch,
    look: LOOK,
    excerpt: true,
    annotations: [{ key: "t1", side: "additions", line: 11 }],
    renderAnnotation: noteElement,
  });
  mounted.push(handle);
  await nextFrame();
  assert.equal(kept.get("t1")?.parentElement?.getAttribute("slot"), "annotation-additions-11");
});

test("a list draws each file's notes in the view's own element for that file and note", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const asked: Array<{ path: string; key: string }> = [];
  const patch =
    "--- a/src/seats.ts\n+++ b/src/seats.ts\n@@ -10,2 +10,2 @@\n const kept = 1;\n-const gone = 2;\n+const come = 2;\n";
  const handle = diffView.mountList(host, {
    files: [
      {
        path: "src/seats.ts",
        patch,
        collapsed: false,
        annotations: [{ key: "t1", side: "additions", line: 11 }],
        lead: false,
        expandable: false,
      },
    ],
    look: LOOK,
    renderHeader: () => document.createElement("div"),
    renderAnnotation: (path, key) => {
      asked.push({ path, key });
      return noteElement(key);
    },
    onTopFile: () => undefined,
  });
  mounted.push(handle);
  await nextFrame();
  await nextFrame();
  assert.deepEqual(asked.at(-1), { path: "src/seats.ts", key: "t1" });
});

test("a list is written with no style as markup, which the panel's policy would refuse", async () => {
  // Note that each spy calls through, so Pierre draws as it would, and only what it wrote is read.
  const writers = [
    vi.spyOn(Element.prototype, "innerHTML", "set"),
    vi.spyOn(ShadowRoot.prototype, "innerHTML", "set"),
  ];
  const inserted = vi.spyOn(Element.prototype, "insertAdjacentHTML");
  const host = document.createElement("div");
  document.body.append(host);
  const patch =
    "--- a/src/seats.ts\n+++ b/src/seats.ts\n@@ -10,2 +10,2 @@\n const kept = 1;\n-const gone = 2;\n+const come = 2;\n";
  const handle = diffView.mountList(host, {
    files: [
      {
        path: "src/seats.ts",
        patch,
        collapsed: false,
        annotations: [],
        lead: false,
        expandable: false,
      },
    ],
    look: LOOK,
    renderHeader: () => document.createElement("div"),
    renderAnnotation: noteElement,
    onTopFile: () => undefined,
  });
  mounted.push(handle);
  await nextFrame();
  await nextFrame();
  const written = [
    ...writers.flatMap((writer) => writer.mock.calls.map(([html]) => String(html))),
    ...inserted.mock.calls.map(([, html]) => html),
  ];
  const code = written.filter((html) => html.includes("data-line"));
  assert.ok(code.length > 0, "the list's lines are written as markup");
  for (const html of code) assert.doesNotMatch(html, /\sstyle="/);
});

/** A patch adding twenty lines to a file of a path's name. */
function addingPatch(path: string): string {
  const lines = Array.from({ length: 20 }, (_, at) => `+const line${at} = ${at};`).join("\n");
  return `--- a/${path}\n+++ b/${path}\n@@ -0,0 +1,20 @@\n${lines}\n`;
}

/**
 * A list of eight files scrolled to its sixth, and every top its scroller
 * was moved to on the way there. Note that jsdom lays nothing out and moves
 * no scroller, so the list stands 400 pixels tall, near enough to its sixth
 * file for Pierre to glide there, and its scroller records each move.
 */
async function scrolledTops(): Promise<number[]> {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 600, 400),
  );
  const host = document.createElement("div");
  document.body.append(host);
  let top = 0;
  const tops: number[] = [];
  Object.defineProperties(host, {
    scrollTop: { get: () => top, set: (next: number) => (top = next) },
    scrollTo: {
      value: (to: ScrollToOptions) => {
        top = to.top ?? top;
        tops.push(top);
      },
    },
  });
  const paths = Array.from({ length: 8 }, (_, at) => `src/f${at}.ts`);
  const handle = diffView.mountList(host, {
    files: paths.map((path) => ({
      path,
      patch: addingPatch(path),
      collapsed: false,
      annotations: [],
      lead: false,
      expandable: false,
    })),
    look: LOOK,
    renderHeader: () => document.createElement("div"),
    renderAnnotation: noteElement,
    onTopFile: () => undefined,
  });
  mounted.push(handle);
  await nextFrame();
  handle.reveal("src/f5.ts");
  for (const _ of [1, 2, 3, 4]) await nextFrame();
  return tops;
}

test("a list scrolled to a file glides there", async () => {
  const tops = await scrolledTops();
  assert.ok(tops.length > 1, "the list passes through the files before it");
  assert.ok((tops[0] ?? 0) < (tops.at(-1) ?? 0));
});

test("a list scrolled to a file where motion is held still gets there at once", async () => {
  // Note that reduced motion and a capture run hold the glide at the token, which jsdom's stylesheet-free document leaves to the test.
  document.documentElement.style.setProperty(SCROLL_GLIDE, "auto");
  const tops = await scrolledTops();
  assert.equal(tops.length, 1, "the list moves once, to the file");
  assert.ok((tops[0] ?? 0) > 0);
});
