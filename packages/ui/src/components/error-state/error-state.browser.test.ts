import { createElement } from "react";
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { PROFILE, surfaceAttributes, THEME } from "../../tokens/surface.js";
import { ERROR_STATE_PLACEMENT, ErrorState, type ErrorStatePlacement } from "./error-state.js";

/**
 * error-state.browser.test.ts -- a failure is one alert saying its sentence
 * and its Retry, at a contrast every theme holds; Retry is the keyboard's
 * next stop and presses from the keyboard as from the pointer; a failure
 * with no Retry says its sentence alone; and a centred one stands its Retry
 * under its words, an inline one beside them.
 */

const LINE = "The inbox could not be read.";

for (const surface of [
  surfaceAttributes(PROFILE.DESKTOP, THEME.DARK),
  surfaceAttributes(PROFILE.DESKTOP, THEME.LIGHT),
  surfaceAttributes(PROFILE.WEB, THEME.DARK),
  surfaceAttributes(PROFILE.WEB, THEME.LIGHT),
]) {
  test(`a failure is announced as one alert with its sentence and Retry, at ${surface["data-luke-profile"]} ${surface["data-luke-theme"]}`, async () => {
    const { container } = await mount(
      createElement(ErrorState, { onRetry: () => undefined, children: LINE }),
      surface,
    );
    const alert = page.getByRole("alert");
    await expect.element(alert).toHaveTextContent(`${LINE}Retry`);
    await expect.element(alert.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(await accessibilityViolations(container)).toEqual([]);
  });
}

test("Retry is the keyboard's next stop, and Enter and Space press it as the pointer does", async () => {
  const pressed: string[] = [];
  await mount(
    createElement(
      "div",
      null,
      createElement("button", { type: "button" }, "Before"),
      createElement(ErrorState, {
        placement: ERROR_STATE_PLACEMENT.CENTRED,
        onRetry: () => pressed.push("retry"),
        children: LINE,
      }),
    ),
  );
  const retry = page.getByRole("button", { name: "Retry" });
  await page.getByRole("button", { name: "Before" }).click();
  await userEvent.keyboard("{Tab}");
  await expect.element(retry).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await userEvent.keyboard(" ");
  await retry.click();
  expect(pressed).toEqual(["retry", "retry", "retry"]);
});

test("a failure with no Retry says its sentence alone, and offers no button", async () => {
  const { container } = await mount(createElement(ErrorState, { children: LINE }));
  await expect.element(page.getByRole("alert")).toHaveTextContent(LINE);
  expect(container.querySelector("button")).toBeNull();
});

test("an inline failure stands Retry's glyph beside its words, a centred one Retry under them", async () => {
  async function standing(placement: ErrorStatePlacement) {
    const { container } = await mount(
      createElement(
        "div",
        { style: { width: "480px" } },
        createElement(ErrorState, { placement, onRetry: () => undefined, children: LINE }),
      ),
    );
    const words = container.querySelector(".luke-error-state-words")?.getBoundingClientRect();
    const retry = container.querySelector("button svg")?.getBoundingClientRect();
    if (words === undefined || retry === undefined) throw new Error("not drawn");
    return { words, retry };
  }
  const inline = await standing(ERROR_STATE_PLACEMENT.INLINE);
  expect(inline.retry.left).toBeGreaterThanOrEqual(inline.words.right);
  expect(inline.retry.top).toBeLessThan(inline.words.bottom);
  const centred = await standing(ERROR_STATE_PLACEMENT.CENTRED);
  expect(centred.retry.top).toBeGreaterThanOrEqual(centred.words.bottom);
});
