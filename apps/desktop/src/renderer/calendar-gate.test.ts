import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CalendarGate, type CalendarGateControl } from "./calendar-gate";

function render(control: Omit<CalendarGateControl, "onSkip">): string {
  return renderToStaticMarkup(
    createElement(CalendarGate, {
      control: { ...control, onSkip: () => undefined },
      onQuit: () => undefined,
    }),
  );
}

const stillSource = { connecting: false, onConnect: () => undefined };

test("the gate offers exactly the sources the build can", () => {
  // React escapes the apostrophe in "Mac's", so the label is matched around it.
  const both = render({ apple: stillSource, google: stillSource });
  assert.match(both, /Use this Mac/);
  assert.match(both, /Connect Google Calendar/);

  const appleOnly = render({ apple: stillSource });
  assert.match(appleOnly, /Use this Mac/);
  assert.doesNotMatch(appleOnly, /Connect Google Calendar/);

  const googleOnly = render({ google: stillSource });
  assert.doesNotMatch(googleOnly, /Use this Mac/);
  assert.match(googleOnly, /Connect Google Calendar/);
});

test("the gate says what connecting buys and what it will never read", () => {
  const markup = render({ apple: stillSource });
  assert.match(markup, /Quiet during meetings/);
  assert.match(markup, /never their titles or/);
});

test("either connect under way holds the connects and the skip, never the quit", () => {
  const markup = render({ apple: { ...stillSource, connecting: true }, google: stillSource });
  const disabled = markup.match(/disabled=""/g) ?? [];
  assert.equal(disabled.length, 3);
  assert.doesNotMatch(markup, /sign-in-quit[^>]*disabled/);
});

test("both ways out stay offered: the skip that answers, the quit that only leaves", () => {
  const markup = render({ google: stillSource });
  assert.match(markup, /calendar-gate-skip[^>]*>Set up later/);
  assert.match(markup, /sign-in-quit[^>]*>Quit Luke/);
});
