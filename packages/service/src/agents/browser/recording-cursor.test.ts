// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { RECORDING_CURSOR_SOURCE, RECORDING_CURSOR_STOP } from "./recording-cursor.js";

const hosts = () =>
  document.documentElement.querySelectorAll(":scope > [data-ui-recording-cursor]");

const run = (source: string) => {
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
  vi.spyOn(field, "getBoundingClientRect").mockReturnValue(new DOMRect(40, 120, 300, 32));
  const [host] = [...hosts()];
  assert.ok(host);
  host.remove();

  field.focus();

  assert.equal(hosts().length, 1, "the focus moved the pointer, which stands in the page again");
  field.remove();
});

test("a key a viewer could not see shows as key caps, and a key that only types text never does", () => {
  const attach = vi.spyOn(Element.prototype, "attachShadow");
  run(RECORDING_CURSOR_SOURCE);
  const shadow = attach.mock.results[0]?.value;
  assert.ok(shadow instanceof ShadowRoot);
  const field = document.createElement("input");
  field.type = "password";
  document.body.append(field);
  const press = (init: KeyboardEventInit) =>
    field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));

  for (const key of "hunter2") press({ key });
  press({ key: "A", code: "KeyA", shiftKey: true });
  press({ key: "Shift", shiftKey: true });
  press({ key: "Enter", code: "Enter" });
  press({ key: "k", code: "KeyK", metaKey: true });

  const caps = [...shadow.querySelectorAll(".k span")].map((cap) => cap.textContent);
  assert.deepEqual(caps, ["", "K"]);
  field.remove();
});
