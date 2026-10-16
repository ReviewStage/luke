import { createElement } from "react";
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { SearchIcon } from "../../face/glyphs.js";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { PROFILE, surfaceAttributes, THEME } from "../../tokens/surface.js";
import { EmptyState } from "./empty-state.js";

/**
 * empty-state.browser.test.ts -- an empty place says its heading and its
 * line to a reader, its glyph not at all, at a contrast every theme holds;
 * its one way on is a button named by its words; and it stands a little
 * above its room's middle, scrolling inside a room too short for it and
 * wrapping inside one too narrow.
 */

const LINE = "This task doesn't exist, or you don't have access to it.";

for (const surface of [
  surfaceAttributes(PROFILE.DESKTOP, THEME.DARK),
  surfaceAttributes(PROFILE.DESKTOP, THEME.LIGHT),
  surfaceAttributes(PROFILE.WEB, THEME.DARK),
  surfaceAttributes(PROFILE.WEB, THEME.LIGHT),
]) {
  test(`an empty place says its heading and line, and offers its way on, at ${surface["data-luke-profile"]} ${surface["data-luke-theme"]}`, async () => {
    const pressed: string[] = [];
    const { container } = await mount(
      createElement(EmptyState, {
        icon: createElement(SearchIcon),
        title: "Not found",
        action: { label: "Close task", onClick: () => pressed.push("close") },
        children: LINE,
      }),
      surface,
    );
    await expect.element(page.getByRole("heading", { name: "Not found" })).toBeInTheDocument();
    await expect.element(page.getByText(LINE)).toBeVisible();
    await page.getByRole("button", { name: "Close task" }).click();
    expect(pressed).toEqual(["close"]);
    expect(container.querySelector("svg")?.closest("[aria-hidden='true']")).not.toBeNull();
    expect(await accessibilityViolations(container)).toEqual([]);
  });
}

test("an empty place with a line alone draws no heading and no button", async () => {
  const { container } = await mount(
    createElement(EmptyState, { icon: createElement(SearchIcon), children: "No agents at work" }),
  );
  expect(container.textContent).toBe("No agents at work");
  expect(container.querySelector("h1, h2, h3, h4, h5, h6, button")).toBeNull();
});

test("the state stands a little above its room's middle, and scrolls inside a room too short for it", async () => {
  function room(height: number): React.JSX.Element {
    return createElement(
      "div",
      { style: { display: "flex", flexDirection: "column", height: `${height}px` } },
      createElement(EmptyState, {
        icon: createElement(SearchIcon),
        title: "Not found",
        action: { label: "Close task", onClick: () => undefined },
        children: LINE,
      }),
    );
  }
  const { container: tall } = await mount(room(800));
  const tallRoom = tall.firstElementChild?.getBoundingClientRect();
  const tallBody = tall.querySelector(".luke-empty-state-body")?.getBoundingClientRect();
  if (tallRoom === undefined || tallBody === undefined) throw new Error("not drawn");
  const above = tallBody.top - tallRoom.top;
  const below = tallRoom.bottom - tallBody.bottom;
  expect(above).toBeGreaterThan(0);
  expect(above).toBeLessThan(below);

  const { container: short } = await mount(room(80));
  const state = short.querySelector(".luke-empty-state");
  if (!(state instanceof HTMLElement)) throw new Error("not drawn");
  expect(state.getBoundingClientRect().height).toBeLessThanOrEqual(80);
  expect(state.scrollHeight).toBeGreaterThan(state.clientHeight);
});

test("in a pane narrower than its measure, the state and its way on stand inside the pane", async () => {
  const { container } = await mount(
    createElement(
      "div",
      { style: { display: "flex", flexDirection: "column", width: "200px", height: "400px" } },
      createElement(EmptyState, {
        icon: createElement(SearchIcon),
        title: "Nothing needs you",
        action: { label: "Show all items in the Inbox", onClick: () => undefined },
        children: "Every question an agent asked has been answered, and every review is done.",
      }),
    ),
  );
  const room = container.firstElementChild?.getBoundingClientRect();
  const body = container.querySelector(".luke-empty-state-body")?.getBoundingClientRect();
  if (room === undefined || body === undefined) throw new Error("not drawn");
  expect(body.left).toBeGreaterThanOrEqual(room.left);
  expect(body.right).toBeLessThanOrEqual(room.right);
});
