// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { RECORDING_CURSOR_SOURCE, RECORDING_CURSOR_STOP } from "./sandbox-recorder.js";

/**
 * recording-cursor.test.ts -- the agent's pointer as the recorder draws it into
 * a page: one host on the document's root, hidden from the accessibility
 * tree and taking no pointer events, drawn once however often it is added,
 * and gone with its listeners once the recording stops. What it draws stands
 * in a closed shadow root, which the frames show and the page cannot reach.
 */

const hosts = () =>
  document.documentElement.querySelectorAll(":scope > [data-luke-recording-cursor]");

const run = (source: string) => {
  // The page runs the source as the recorder hands it over, as a script of its own.
  // biome-ignore lint/security/noGlobalEval: the source is the recorder's own constant, run as the browser runs it.
  window.eval(source);
};

afterEach(() => {
  run(RECORDING_CURSOR_STOP);
});

test("the pointer is one hidden host on the page's root, however often it is added", () => {
  run(RECORDING_CURSOR_SOURCE);
  run(RECORDING_CURSOR_SOURCE);

  const [host, ...more] = [...hosts()];
  assert.ok(host instanceof HTMLElement);
  assert.equal(more.length, 0);
  assert.equal(host.getAttribute("aria-hidden"), "true");
  assert.equal(host.style.pointerEvents, "none");
  assert.equal(host.parentElement, document.documentElement, "it stands outside the page's body");
});

test("a page that drops the host has it back at the agent's next move, and a stop takes it out for good", () => {
  run(RECORDING_CURSOR_SOURCE);
  const [host] = [...hosts()];
  assert.ok(host);

  host.remove();
  window.dispatchEvent(new MouseEvent("mousemove", { clientX: 120, clientY: 80 }));
  assert.equal(hosts().length, 1, "the next move draws it again");

  run(RECORDING_CURSOR_STOP);
  window.dispatchEvent(new MouseEvent("mousemove", { clientX: 140, clientY: 90 }));
  window.dispatchEvent(new MouseEvent("mousedown", { clientX: 140, clientY: 90 }));
  assert.equal(hosts().length, 0, "nothing listens once the recording stopped");
});
