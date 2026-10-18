/**
 * error-state.test.ts -- a failure is one alert saying its sentence and its
 * Retry; Retry is a button the keyboard can stand on and a press of it
 * tries again; a failure with no Retry says its sentence alone; among rows
 * it offers the remedy, Retry, Remove, and Dismiss in that order, each
 * press doing its own; the glyph that marks it as a fault says nothing to a
 * reader.
 */

// @vitest-environment jsdom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { ERROR_STATE_PLACEMENT, ErrorState } from "./error-state.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LINE = "The inbox could not be read.";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Draws `element` into the page and answers the one alert it says. */
function mountAlert(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  const alerts = container.querySelectorAll<HTMLElement>('[role="alert"]');
  expect(alerts).toHaveLength(1);
  const [alert] = alerts;
  if (alert === undefined) throw new Error("no alert");
  return alert;
}

for (const placement of Object.values(ERROR_STATE_PLACEMENT)) {
  test(`a ${placement} failure is one alert with its sentence and Retry, whose press tries again`, () => {
    const pressed: string[] = [];
    const alert = mountAlert(
      createElement(ErrorState, {
        placement,
        onRetry: () => pressed.push("retry"),
        children: LINE,
      }),
    );
    const buttons = alert.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    const [retry] = buttons;
    expect(alert.textContent).toBe(`${LINE}Retry`);
    expect(retry?.textContent).toBe("Retry");
    act(() => retry?.click());
    expect(pressed).toEqual(["retry"]);
  });
}

test("Retry is a button the keyboard can stand on", () => {
  const alert = mountAlert(createElement(ErrorState, { onRetry: () => undefined, children: LINE }));
  const retry = alert.querySelector("button");
  expect(retry?.disabled).toBe(false);
  act(() => retry?.focus());
  expect(document.activeElement).toBe(retry);
});

test("a failure with no Retry says its sentence alone, and offers no button", () => {
  const alert = mountAlert(createElement(ErrorState, { children: LINE }));
  expect(alert.textContent).toBe(LINE);
  expect(alert.querySelector("button")).toBeNull();
});

for (const placement of Object.values(ERROR_STATE_PLACEMENT)) {
  test(`a ${placement} failure's glyph marks it without saying anything to a reader`, () => {
    const alert = mountAlert(createElement(ErrorState, { placement, children: LINE }));
    const glyphs = [...alert.querySelectorAll("svg")];
    expect(glyphs).toHaveLength(1);
    expect(glyphs.every((glyph) => glyph.closest("[aria-hidden='true']") !== null)).toBe(true);
    expect(alert.textContent).toBe(LINE);
  });
}

test("a failure among rows offers its remedy, Retry, Remove, and Dismiss in that order, each press doing its own", () => {
  const pressed: string[] = [];
  const alert = mountAlert(
    createElement(ErrorState, {
      remedy: { label: "Connect GitHub", onClick: () => pressed.push("remedy") },
      onRetry: () => pressed.push("retry"),
      onRemove: () => pressed.push("remove"),
      onDismiss: () => pressed.push("dismiss"),
      children: LINE,
    }),
  );
  const buttons = [...alert.querySelectorAll("button")];
  expect(buttons.map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual([
    "Connect GitHub",
    "Retry",
    "Remove",
    "Dismiss",
  ]);
  expect(alert.textContent).toBe(`${LINE}Connect GitHubRetryRemove`);
  for (const button of buttons) act(() => button.click());
  expect(pressed).toEqual(["remedy", "retry", "remove", "dismiss"]);
});

test("a failure among rows offers only the presses it is given", () => {
  const pressed: string[] = [];
  const alert = mountAlert(
    createElement(ErrorState, { onDismiss: () => pressed.push("dismiss"), children: LINE }),
  );
  const buttons = [...alert.querySelectorAll("button")];
  expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(["Dismiss"]);
  expect(alert.textContent).toBe(LINE);
  act(() => buttons[0]?.click());
  expect(pressed).toEqual(["dismiss"]);
});
