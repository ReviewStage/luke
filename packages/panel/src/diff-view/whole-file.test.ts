// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  DIFF_FONT,
  DIFF_INDICATORS,
  DIFF_LAYOUT,
  DIFF_LINE_HEIGHT,
  INLINE_DIFF,
} from "@luke/settings/diff-view";
import { afterEach, test } from "vitest";
import type { DiffLook, FileViewHandle, FileViewProps } from "./contract.js";
import { diffView } from "./index.js";

/**
 * whole-file.test.ts -- a whole file drawn by the diff bundle with no diff,
 * as a File tab draws one (`mountFile`), and a patch drawn alone with notes
 * under its lines (`mount`): Pierre draws them in jsdom on the window's own
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

const TEXT = "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n";

/** The element each note was drawn in, by its key, as the view keeps them. */
let kept = new Map<string, HTMLElement>();
let mounted: Array<{ unmount: () => void }> = [];

afterEach(() => {
  for (const each of mounted) each.unmount();
  mounted = [];
  kept = new Map();
  document.body.replaceChildren();
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
