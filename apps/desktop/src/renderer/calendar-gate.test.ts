import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CalendarGate, type CalendarGateControl } from "./calendar-gate";

function render(control: Partial<CalendarGateControl>, review?: ReactNode): string {
  return renderToStaticMarkup(
    createElement(CalendarGate, {
      control: { onSkip: () => undefined, onDone: () => undefined, ...control },
      ...(review !== undefined ? { review } : undefined),
      onQuit: () => undefined,
    }),
  );
}

const stillSource = { connecting: false, onConnect: () => undefined };
const REVIEW = createElement("div", { className: "review-stand-in" }, "the settings block");

test("unconnected, the gate offers exactly the sources the build can", () => {
  // React escapes the apostrophe in "Mac's", so the label is matched around it.
  const both = render({ apple: stillSource, google: stillSource });
  assert.match(both, /Use this Mac/);
  assert.match(both, /Connect Google Calendar/);
  assert.doesNotMatch(both, />Done</);

  const appleOnly = render({ apple: stillSource });
  assert.match(appleOnly, /Use this Mac/);
  assert.doesNotMatch(appleOnly, /Connect Google Calendar/);

  const googleOnly = render({ google: stillSource });
  assert.doesNotMatch(googleOnly, /Use this Mac/);
  assert.match(googleOnly, /Connect Google Calendar/);
});

test("the gate carries no prose of its own; the label stands in for readers", () => {
  const markup = render({ apple: stillSource });
  assert.match(markup, /aria-label="Connect a calendar"/);
  assert.doesNotMatch(markup, /Quiet during meetings/);
});

test("connected, the handed-in review replaces the ask, and Done answers it", () => {
  const markup = render({ apple: stillSource, google: stillSource }, REVIEW);
  assert.match(markup, /review-stand-in/);
  assert.match(markup, /calendar-gate-done[^>]*>Done/);
  // The rows inside the review carry the connects now; the ask half's
  // buttons leave with the question they asked.
  assert.doesNotMatch(markup, /Use this Mac/);
  assert.doesNotMatch(markup, /Connect Google Calendar/);
});

test("a connect under way holds the buttons, never the quit", () => {
  const markup = render({ apple: { ...stillSource, connecting: true }, google: stillSource });
  const disabled = markup.match(/disabled=""/g) ?? [];
  assert.equal(disabled.length, 3);
  assert.doesNotMatch(markup, /sign-in-quit[^>]*disabled/);
});

test("the skip stands only while the question does; connected, Done is the answer", () => {
  const asking = render({ google: stillSource });
  assert.match(asking, /calendar-gate-skip[^>]*>Set up later/);
  assert.match(asking, /sign-in-quit[^>]*>Quit Luke/);

  const reviewing = render({ google: stillSource }, REVIEW);
  assert.doesNotMatch(reviewing, /Set up later/);
  assert.match(reviewing, /sign-in-quit[^>]*>Quit Luke/);
});
