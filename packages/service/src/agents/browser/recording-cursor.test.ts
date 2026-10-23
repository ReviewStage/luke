// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { RECORDING_CURSOR_SOURCE, RECORDING_CURSOR_STOP } from "./sandbox-recorder.js";

/**
 * recording-cursor.test.ts -- the agent's pointer as the recorder draws it into
 * a page: one host on the document's root, hidden from the accessibility
 * tree and taking no pointer events, drawn once however often it is added,
 * and gone with its listeners once the recording stops. What it draws stands
 * in a closed shadow root, which the frames show and the page cannot reach,
 * so these read what the page can: the host, and whether input brings it
 * back.
 */

const hosts = () =>
  document.documentElement.querySelectorAll(":scope > [data-luke-recording-cursor]");

const run = (source: string) => {
  // The page runs the source as the recorder hands it over, as a script of its own.
  // biome-ignore lint/security/noGlobalEval: the source is the recorder's own constant, run as the browser runs it.
  window.eval(source);
};

afterEach(() => {
  vi.restoreAllMocks();
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

test("a stop finds the pointer's listeners though the page removed its host first, and nothing draws it back", () => {
  run(RECORDING_CURSOR_SOURCE);
  const [host] = [...hosts()];
  assert.ok(host);

  host.remove();
  run(RECORDING_CURSOR_STOP);
  window.dispatchEvent(new MouseEvent("mousemove", { clientX: 60, clientY: 40 }));

  assert.equal(hosts().length, 0);
  run(RECORDING_CURSOR_SOURCE);
  assert.equal(hosts().length, 1, "a later recording draws it afresh");
});

test("typing into a field by ref, which focuses it with no mouse, draws the pointer back in the page", () => {
  run(RECORDING_CURSOR_SOURCE);
  const field = document.createElement("input");
  document.body.append(field);
  // jsdom lays nothing out, so the field stands where a page would draw it.
  vi.spyOn(field, "getBoundingClientRect").mockReturnValue(new DOMRect(40, 120, 300, 32));
  const [host] = [...hosts()];
  assert.ok(host);
  host.remove();

  field.focus();

  assert.equal(hosts().length, 1, "the focus moved the pointer, which stands in the page again");
  field.remove();
});
