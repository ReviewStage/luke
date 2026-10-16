import { createElement } from "react";
import { expect, test } from "vitest";
import { commands, page } from "vitest/browser";
import { CompatSkeleton } from "../../compat.js";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { PROFILE, surfaceAttributes, THEME } from "../../tokens/surface.js";
import { Button } from "../button/button.js";
import { SKELETON_SHAPE, Skeleton, SkeletonRegion } from "./skeleton.js";

/**
 * skeleton.browser.test.ts -- a placeholder region says what it is reading
 * and hides its blocks from a reader; each shape stands the room of what it
 * stands for, at the profile's own dimensions; the blocks hold still for
 * reduced motion; and the compatibility twin is the same block.
 */

function boxOf(element: Element | null | undefined): DOMRect | undefined {
  return element?.getBoundingClientRect();
}

test("a region says what it is reading, busy, and its blocks say nothing", async () => {
  const { container } = await mount(
    createElement(SkeletonRegion, {
      label: "Reading your tasks",
      children: [
        createElement(Skeleton, { key: "a", width: "60%" }),
        createElement(Skeleton, { key: "b" }),
      ],
    }),
  );
  const region = page.getByRole("status");
  await expect.element(region).toHaveTextContent("Reading your tasks");
  await expect.element(region).toHaveAttribute("aria-busy", "true");
  for (const block of container.querySelectorAll(".luke-skeleton")) {
    expect(block.getAttribute("aria-hidden")).toBe("true");
  }
  expect(await accessibilityViolations(container)).toEqual([]);
});

for (const surface of [
  surfaceAttributes(PROFILE.DESKTOP, THEME.DARK),
  surfaceAttributes(PROFILE.WEB, THEME.LIGHT),
]) {
  test(`at ${surface["data-luke-profile"]} a control's block stands a control's room and a circle is round`, async () => {
    const { container } = await mount(
      createElement(
        "div",
        { style: { display: "flex", alignItems: "flex-start", gap: 8 } },
        createElement(Button, { children: "Save" }),
        createElement(
          "div",
          { style: { width: 120 } },
          createElement(Skeleton, { shape: SKELETON_SHAPE.CONTROL }),
        ),
        createElement(Skeleton, { shape: SKELETON_SHAPE.CIRCLE }),
      ),
      surface,
    );
    const button = boxOf(container.querySelector("button"));
    const [control, circle] = [...container.querySelectorAll(".luke-skeleton")].map(boxOf);
    expect(control?.height).toBe(button?.height);
    expect(circle?.width).toBe(circle?.height);
    expect(circle?.height).toBe(button?.height);
  });
}

test("a line is as wide as the share of its line it is given", async () => {
  const { container } = await mount(
    createElement("div", { style: { width: 200 } }, createElement(Skeleton, { width: "60%" })),
  );
  expect(boxOf(container.querySelector(".luke-skeleton"))?.width).toBe(120);
});

test("the blocks hold still for a visitor to the site who asked for reduced motion", async () => {
  const { container } = await mount(
    createElement(Skeleton),
    surfaceAttributes(PROFILE.WEB, THEME.LIGHT),
  );
  const block = container.querySelector(".luke-skeleton");
  await commands.emulateReducedMotion(true);
  expect(block && getComputedStyle(block).animationPlayState).toBe("paused");
});

test("the compatibility twin is the same block with its caller's class beside its own", async () => {
  const { container } = await mount(
    createElement(
      "div",
      null,
      createElement(Skeleton, { width: "40%" }),
      createElement(CompatSkeleton, { width: "40%", className: "tab-skeleton" }),
    ),
  );
  const [shared, twin] = container.querySelectorAll(".luke-skeleton");
  twin?.classList.remove("tab-skeleton");
  expect(twin?.outerHTML).toBe(shared?.outerHTML);
});
