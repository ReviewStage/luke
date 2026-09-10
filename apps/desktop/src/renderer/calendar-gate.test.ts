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

test("a connect under way holds the buttons, never the quit", () => {
  const markup = render({ apple: { ...stillSource, connecting: true }, google: stillSource });
  const disabled = markup.match(/disabled=""/g) ?? [];
  assert.equal(disabled.length, 3);
});
