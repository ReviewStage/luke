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
import type { DiffLook } from "./contract.js";
import { HIGHLIGHT_MODE, type Highlighting, startHighlighting } from "./highlight-pool.js";

/**
 * highlight-pool.test.ts -- a list's files are highlighted in Pierre's pool
 * of workers where a worker starts, and on the window's own thread where
 * none can: with no door to start one, a door that throws, or a worker
 * that fails as it loads. The workers are stood in for at the door, the
 * process boundary, each answering Pierre's start as the real worker does
 * or failing it.
 */

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

/** A request the pool sends a worker, as much of it as a stand-in reads. */
interface Request {
  readonly type: string;
  readonly id: string;
}

/** A worker stood in for: it answers the pool's start as Pierre's own worker does, or fails as it loads. */
class StandInWorker extends EventTarget implements Worker {
  onmessage: Worker["onmessage"] = null;
  onmessageerror: Worker["onmessageerror"] = null;
  onerror: Worker["onerror"] = null;

  constructor(private readonly loads: boolean) {
    super();
  }

  postMessage(message: Request): void {
    queueMicrotask(() => {
      if (!this.loads) {
        this.dispatchEvent(new Event("error", { cancelable: true }));
        return;
      }
      if (message.type !== "initialize") return;
      const data = { type: "success", id: message.id, requestType: "initialize", sentAt: 0 };
      this.dispatchEvent(new MessageEvent("message", { data }));
    });
  }

  terminate(): void {}
}

let started: Highlighting | undefined;

afterEach(() => {
  started?.pool?.terminate();
  started = undefined;
});

test("a list with no door to start a worker through highlights on the window's own thread", async () => {
  started = startHighlighting(undefined, LOOK, 1000);
  assert.equal(started.pool, undefined);
  assert.equal(await started.settled, HIGHLIGHT_MODE.MAIN_THREAD);
});

test("a list whose workers start highlights in the pool", async () => {
  started = startHighlighting(() => new StandInWorker(true), LOOK, 1000);
  assert.equal(await started.settled, HIGHLIGHT_MODE.POOL);
  assert.equal(started.pool?.isWorkingPool(), true);
});

test("a list whose door throws, or whose worker fails as it loads, highlights on the window's own thread", async () => {
  const throwing = startHighlighting(
    () => {
      throw new Error("No worker from this blob.");
    },
    LOOK,
    1000,
  );
  started = throwing;
  assert.equal(await throwing.settled, HIGHLIGHT_MODE.MAIN_THREAD);
  assert.equal(throwing.pool?.isWorkingPool(), false);

  const failing = startHighlighting(() => new StandInWorker(false), LOOK, 1000);
  started = failing;
  assert.equal(await failing.settled, HIGHLIGHT_MODE.MAIN_THREAD);
  assert.equal(failing.pool?.isWorkingPool(), false);
});
