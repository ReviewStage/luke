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
import { laterWorker } from "./later-worker.js";

/**
 * later-worker.test.ts -- a worker handed to Pierre's pool before its
 * script has landed: what it is posted reaches the worker once it starts,
 * in order, what the worker says is heard, a script that never lands fails
 * it as a worker that cannot load, and one ended first starts nothing. The
 * worker is stood in for at the door it is started through, the thread
 * boundary.
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

/** A worker stood in for: it keeps what it is posted, and answers each of Pierre's requests as Pierre's own worker does. */
class StandInWorker extends EventTarget implements Worker {
  onmessage: Worker["onmessage"] = null;
  onmessageerror: Worker["onmessageerror"] = null;
  onerror: Worker["onerror"] = null;
  readonly posted: unknown[] = [];
  terminated = false;

  constructor(readonly script: string) {
    super();
  }

  postMessage(message: { readonly type?: string; readonly id?: string }): void {
    this.posted.push(message);
    if (message.id === undefined) return;
    queueMicrotask(() => {
      const data = { type: "success", id: message.id, requestType: message.type, sentAt: 0 };
      this.dispatchEvent(new MessageEvent("message", { data }));
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

/** A script that lands when the test says. */
function pendingScript() {
  let land: (text: string | undefined) => void = () => undefined;
  let refuse: (error: Error) => void = () => undefined;
  const script = new Promise<string | undefined>((resolve, reject) => {
    land = resolve;
    refuse = reject;
  });
  return { script, land, refuse };
}

/** The error the stand-in raised, once it raises one. */
function nextError(worker: Worker): Promise<ErrorEvent> {
  return new Promise((resolve) => {
    worker.addEventListener("error", (event) => resolve(event as ErrorEvent), { once: true });
  });
}

/** Lets every settled promise's callbacks run. */
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

let started: Highlighting | undefined;

afterEach(() => {
  started?.pool?.terminate();
  started = undefined;
});

test("what is posted before the script lands reaches the worker in order once it starts", async () => {
  const { script, land } = pendingScript();
  const workers: StandInWorker[] = [];
  const worker = laterWorker(script, (text) => {
    const each = new StandInWorker(text);
    workers.push(each);
    return each;
  });
  worker.postMessage({ n: 1 });
  worker.postMessage({ n: 2 });
  await settle();
  assert.equal(workers.length, 0, "no worker starts before its script lands");

  land("the worker's script");
  await script;
  await settle();
  worker.postMessage({ n: 3 });
  assert.equal(workers.length, 1);
  assert.equal(workers[0]?.script, "the worker's script");
  assert.deepEqual(workers[0]?.posted, [{ n: 1 }, { n: 2 }, { n: 3 }]);
});

test("what the started worker says is heard from the stand-in", async () => {
  let real: StandInWorker | undefined;
  const worker = laterWorker(Promise.resolve("script"), (text) => {
    real = new StandInWorker(text);
    return real;
  });
  const heard = new Promise<unknown>((resolve) => {
    worker.addEventListener("message", (event) => resolve((event as MessageEvent).data));
  });
  worker.postMessage({ type: "initialize", id: "1" });
  assert.deepEqual(await heard, {
    type: "success",
    id: "1",
    requestType: "initialize",
    sentAt: 0,
  });
  worker.terminate();
  assert.equal(real?.terminated, true);
});

test("a script the build did not carry, one that fails to land, or a start that throws fails as a worker that cannot load", async () => {
  const unstarted = () => {
    throw new Error("No worker is started without a script.");
  };
  const none = laterWorker(Promise.resolve(undefined), unstarted);
  assert.equal((await nextError(none)).type, "error");

  const { script, refuse } = pendingScript();
  const refused = laterWorker(script, unstarted);
  const failure = nextError(refused);
  refuse(new Error("The chunk failed to load."));
  assert.match((await failure).message, /chunk failed to load/);

  const throwing = laterWorker(Promise.resolve("script"), () => {
    throw new Error("No worker from this blob.");
  });
  assert.match((await nextError(throwing)).message, /No worker from this blob/);
});

test("a stand-in ended before its script lands starts no worker", async () => {
  const { script, land } = pendingScript();
  let starts = 0;
  const worker = laterWorker(script, (text) => {
    starts += 1;
    return new StandInWorker(text);
  });
  worker.terminate();
  land("script");
  await script;
  await settle();
  assert.equal(starts, 0);
});

test("a pool whose workers' script lands after it starts highlights in the pool", async () => {
  const { script, land } = pendingScript();
  started = startHighlighting(
    () => laterWorker(script, (text) => new StandInWorker(text)),
    LOOK,
    1000,
  );
  land("script");
  assert.equal(await started.settled, HIGHLIGHT_MODE.POOL);
  assert.equal(started.pool?.isWorkingPool(), true);
});
