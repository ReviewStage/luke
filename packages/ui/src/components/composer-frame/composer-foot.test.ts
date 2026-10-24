// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { ComposerFoot } from "./composer-foot.js";

/**
 * composer-foot.test.ts -- a message box's foot takes no send while the box
 * is empty, says its one note, shows its counter from four fifths of the
 * limit, offers a remedy beside its note and a mend under it, stands Stop
 * in the send's place, and keeps a call's status beside the send and beside
 * a strip.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Draws a foot with `props` and hands back its root, to draw it again, and what it was drawn into. */
function draw(props: React.ComponentProps<typeof ComposerFoot>): {
  container: HTMLElement;
  redraw: (next: React.ComponentProps<typeof ComposerFoot>) => void;
} {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(ComposerFoot, props)));
  return {
    container,
    redraw: (next) => act(() => root.render(createElement(ComposerFoot, next))),
  };
}

/** The button named `name`, which the test fails without. */
function button(container: HTMLElement, name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (each) => each.getAttribute("aria-label") === name || each.textContent === name,
  );
  if (found === undefined) throw new Error(`no button named ${name}`);
  return found;
}

/** Whether a button takes no press, as a reader is told it. */
function unavailable(element: HTMLButtonElement): boolean {
  return element.disabled || element.getAttribute("aria-disabled") === "true";
}

test("the send takes no press while the box is empty, and sends once it holds words", () => {
  const sent: string[] = [];
  const onSend = () => sent.push("sent");
  const { container, redraw } = draw({ send: { label: "Send", empty: true, onSend } });
  act(() => button(container, "Send").click());
  expect(unavailable(button(container, "Send"))).toBe(true);
  expect(sent).toEqual([]);

  redraw({ send: { label: "Send", empty: false, onSend } });
  act(() => button(container, "Send").click());
  expect(unavailable(button(container, "Send"))).toBe(false);
  expect(sent).toEqual(["sent"]);
});

test("a send still out is named by its busy words and takes no second press", () => {
  const sent: string[] = [];
  const { container } = draw({
    send: {
      label: "Send",
      empty: false,
      busy: true,
      busyLabel: "Sending",
      onSend: () => sent.push("sent"),
    },
  });
  act(() => button(container, "Sending").click());
  expect(sent).toEqual([]);
});

test("the note line says a cut paste as it lands", () => {
  const words = "Only the first 4,000 characters were pasted.";
  const { container, redraw } = draw({ send: { label: "Send", empty: false } });
  expect(container.querySelector('[role="alert"]')).toBeNull();

  redraw({ send: { label: "Send", empty: false }, note: { words } });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(words);
});

test("a refused send's note offers Retry, which tries again", () => {
  const tries: string[] = [];
  const { container } = draw({
    send: { label: "Send", empty: false },
    note: { words: "The message could not be sent.", onRetry: () => tries.push("again") },
  });
  act(() => button(container, "Retry").click());
  expect(tries).toEqual(["again"]);
});

test("a note's remedy mends what Retry cannot, and a send in words says what it settles", () => {
  const mended: string[] = [];
  const settled: string[] = [];
  const { container } = draw({
    send: { label: "Got it", empty: false, inWords: true, onSend: () => settled.push("nod") },
    note: {
      words: "The agent is archived.",
      remedy: { label: "Unarchive", onClick: () => mended.push("back") },
    },
  });
  act(() => button(container, "Unarchive").click());
  act(() => button(container, "Got it").click());
  expect(mended).toEqual(["back"]);
  expect(settled).toEqual(["nod"]);
  expect(button(container, "Got it").textContent).toBe("Got it");
});

test("a note's mend stands under its line, as a closed agent's Continue does", () => {
  const { container } = draw({
    send: { label: "Send", empty: true },
    note: {
      words: "The agent takes no more messages.",
      mends: createElement("span", { className: "mend" }, "Continue in new agent"),
    },
  });
  const note = container.querySelector(".luke-composer-foot-note");
  expect(note?.querySelector('[role="alert"]')?.textContent).toBe(
    "The agent takes no more messages.",
  );
  expect(note?.querySelector(".mend")?.textContent).toBe("Continue in new agent");
});

test("Stop stands in the send's place and stops, and while its stop is out it is named by its busy words and takes no second press", () => {
  const stops: string[] = [];
  const send = { label: "Send", empty: true };
  const onStop = () => stops.push("stop");
  const { container, redraw } = draw({ send, stop: { label: "Stop", onStop } });
  expect(() => button(container, "Send")).toThrow();
  act(() => button(container, "Stop").click());
  expect(stops).toEqual(["stop"]);

  redraw({ send, stop: { label: "Stop", onStop, busy: true, busyLabel: "Stopping…" } });
  act(() => button(container, "Stopping…").click());
  expect(button(container, "Stopping…").getAttribute("aria-busy")).toBe("true");
  expect(stops).toEqual(["stop"]);

  redraw({ send: { label: "Send", empty: false } });
  expect(button(container, "Send")).toBeDefined();
  expect(() => button(container, "Stop")).toThrow();
});

test("the counter shows once the words reach four fifths of the limit", () => {
  const send = { label: "Send", empty: false };
  const { container, redraw } = draw({ send, counter: { length: 3199, limit: 4000 } });
  expect(container.textContent).not.toContain("/4,000");

  redraw({ send, counter: { length: 3200, limit: 4000 } });
  expect(container.textContent).toContain("3,200/4,000");
});

test("a call's status stands beside the send, and beside a strip in the bar's place", () => {
  const call = createElement("span", null, "On a call · 2:14");
  const { container, redraw } = draw({ send: { label: "Send", empty: false }, call });
  expect(container.textContent).toContain("On a call · 2:14");
  expect(button(container, "Send")).toBeDefined();

  redraw({
    send: { label: "Send", empty: false },
    call,
    tools: createElement("span", null, "Attach"),
    strip: createElement("span", null, "Listening"),
  });
  expect(container.textContent).toContain("On a call · 2:14");
  expect(container.textContent).toContain("Listening");
  expect(container.textContent).not.toContain("Attach");
  expect(() => button(container, "Send")).toThrow();
});
