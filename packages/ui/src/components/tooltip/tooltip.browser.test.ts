import { type CSSProperties, createElement, Fragment, type ReactNode, useState } from "react";
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { TooltipCard, TooltipPill } from "./tooltip.js";

/**
 * tooltip.browser.test.ts -- a pill hangs centred under the control it
 * describes and turns above it where the window ends; a card hung beside a
 * control at the window's end turns before its start; and a card's presses
 * go no further than the card, a press on one of its buttons choosing it.
 */

/** A control at `place`, with the hint `hint` draws for it once it is laid out. */
function Hinted({
  place,
  hint,
}: {
  place: CSSProperties;
  hint: (anchor: HTMLElement) => ReactNode;
}): React.JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return createElement(
    Fragment,
    null,
    createElement(
      "button",
      {
        ref: setAnchor,
        type: "button",
        "aria-describedby": "hint",
        style: { position: "fixed", ...place },
      },
      "Archive",
    ),
    anchor === null ? null : hint(anchor),
  );
}

/** The pill describing an Archive button at `place`. */
function pillAt(place: CSSProperties) {
  return createElement(Hinted, {
    place,
    hint: (anchor) =>
      createElement(TooltipPill, {
        id: "hint",
        anchor,
        instant: true,
        label: "Archive plan",
        shortcut: createElement("kbd", null, "⌘E"),
      }),
  });
}

/** The rectangles of the Archive button and its hint, once the hint is placed. */
async function drawn(): Promise<{ control: DOMRect; hint: DOMRect; side: string | null }> {
  const hint = page.getByRole("tooltip");
  await expect.element(hint).toHaveAttribute("data-placed", "true");
  return {
    control: page.getByRole("button", { name: "Archive" }).element().getBoundingClientRect(),
    hint: hint.element().getBoundingClientRect(),
    side: hint.element().getAttribute("data-side"),
  };
}

test("a pill hangs centred under the control it describes, its chord after its name", async () => {
  const { container } = await mount(pillAt({ top: 40, left: 200 }));
  const { control, hint, side } = await drawn();
  expect(side).toBe("below");
  expect(hint.top).toBeGreaterThan(control.bottom);
  expect(Math.abs(hint.left + hint.width / 2 - (control.left + control.width / 2))).toBeLessThan(1);
  await expect
    .element(page.getByRole("button", { name: "Archive" }))
    .toHaveAccessibleDescription("Archive plan ⌘E");
  expect(await accessibilityViolations(container)).toEqual([]);
});

test("a pill turns above its control where the window ends below it, and stays inside the window at its side", async () => {
  await mount(pillAt({ bottom: 2, left: 0 }));
  const { control, hint, side } = await drawn();
  expect(side).toBe("above");
  expect(hint.bottom).toBeLessThan(control.top);
  expect(hint.left).toBeGreaterThan(0);
});

test("a card beside a control at the window's end turns before its start, and its presses stop at the card", async () => {
  const pressed: string[] = [];
  const card = (anchor: HTMLElement) =>
    createElement(TooltipCard, {
      id: "hint",
      anchor,
      instant: true,
      beside: true,
      onPress: () => pressed.push("card"),
      onChoice: () => pressed.push("choice"),
      children: [
        createElement("p", { key: "note" }, "Archived plans stay searchable."),
        createElement("button", { key: "open", type: "button" }, "Open archive"),
      ],
    });
  await mount(
    createElement(
      "div",
      { onPointerDown: () => pressed.push("row") },
      createElement(Hinted, { place: { top: 40, right: 0 }, hint: card }),
    ),
  );
  const { control, hint, side } = await drawn();
  expect(side).toBe("start");
  expect(hint.right).toBeLessThan(control.left);
  await page.getByText("Archived plans stay searchable.").click();
  await page.getByRole("button", { name: "Open archive" }).click();
  expect(pressed).toEqual(["card", "card", "choice"]);
});
