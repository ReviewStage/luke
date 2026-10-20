// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  DIFF_FONT,
  DIFF_INDICATORS,
  DIFF_LAYOUT,
  DIFF_LINE_HEIGHT,
  INLINE_DIFF,
} from "@luke/settings/diff-view";
import type { Element } from "hast";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { ColourRequest, DiffLook } from "./contract.js";
import { diffView } from "./index.js";

/**
 * colour-pool.test.ts -- a file's colouring answered through the kept pool of
 * workers: each answer is read back whole, however many files were coloured
 * before it, since the pool lets go of a result once it is read. The workers
 * are stood in for at the door, the process boundary, each answering a file's
 * request with one line in two colours.
 */

interface RenderOptions {
  readonly theme?: unknown;
  readonly useTokenTransformer?: boolean;
  readonly tokenizeMaxLineLength?: number;
}

interface Request {
  readonly type: string;
  readonly id: string;
  readonly renderOptions?: RenderOptions;
}

const LOOK: DiffLook = {
  layout: DIFF_LAYOUT.UNIFIED,
  indicators: DIFF_INDICATORS.BARS,
  inlineDiff: INLINE_DIFF.WORD_ALT,
  backgrounds: true,
  lineNumbers: true,
  wrap: false,
  themes: { dark: "github-dark", light: "github-light" },
  font: DIFF_FONT.SF_MONO,
  fontSize: "11.5",
  lineHeight: DIFF_LINE_HEIGHT.NORMAL,
  ligatures: false,
};

/** The render options the pool last told the stand-in workers, which a file's answer echoes as the options it was rendered in. */
let options: RenderOptions = {};

/** A line of one token, as Pierre's worker writes it. */
const LINE: Element = {
  type: "element",
  tagName: "div",
  properties: { "data-line": 1 },
  children: [
    {
      type: "element",
      tagName: "span",
      properties: { style: "--diffs-token-dark:#ff79c6;--diffs-token-light:#859900" },
      children: [{ type: "text", value: "const" }],
    },
  ],
};

const THEME_STYLES =
  "--diffs-dark:#F8F8F2;--diffs-dark-bg:#282A36;--diffs-light:#657B83;--diffs-light-bg:#FDF6E3";

class StandInWorker extends EventTarget implements Worker {
  onmessage: Worker["onmessage"] = null;
  onmessageerror: Worker["onmessageerror"] = null;
  onerror: Worker["onerror"] = null;

  postMessage(message: Request): void {
    if (message.renderOptions !== undefined) options = message.renderOptions;
    queueMicrotask(() => {
      const answer =
        message.type === "file"
          ? { result: { code: [LINE], themeStyles: THEME_STYLES }, options }
          : {};
      const data = { type: "success", id: message.id, requestType: message.type, ...answer };
      this.dispatchEvent(new MessageEvent("message", { data }));
    });
  }

  terminate(): void {}
}

beforeEach(() => {
  vi.stubGlobal("DIFF_HIGHLIGHT_WORKER", "// stood in");
  vi.stubGlobal("Worker", StandInWorker);
  URL.createObjectURL = () => "blob:stood-in";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function request(name: string): ColourRequest {
  return { name, lines: ["const"], look: LOOK };
}

test("every file coloured through the pool is answered, however many were coloured before it", async () => {
  for (let file = 0; file < 40; file += 1) {
    const coloured = await diffView.colourLines(request(`file-${file}.ts`));
    assert.deepEqual(coloured?.lines, [
      [{ text: "const", color: "#ff79c6", lightColor: "#859900" }],
    ]);
    assert.deepEqual(coloured?.ground, { dark: "#282A36", light: "#FDF6E3" });
  }
});
