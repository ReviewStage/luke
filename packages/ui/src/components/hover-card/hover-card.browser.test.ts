import { createElement, Fragment, type ReactNode, useState } from "react";
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { TooltipCard } from "../tooltip/tooltip.js";
import { HoverCard, HoverCardHead, HoverCardNote, HoverCardRule } from "./hover-card.js";

/**
 * hover-card.browser.test.ts -- a card hung from its control says its name,
 * the line under it, and its corner in its head, and its notes under it; a
 * row it lists under its rule is a button the pointer crosses onto the card
 * to press; and a name or a note on one line is marked to fade only where it
 * is cut short.
 */

/** A Plan button hanging `card` for itself once it is laid out, choosing it pushed onto `chosen`. */
function Carded({ card, chosen }: { card: ReactNode; chosen: string[] }): React.JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return createElement(
    Fragment,
    null,
    createElement(
      "button",
      {
        ref: setAnchor,
        type: "button",
        "aria-describedby": "card",
        style: { position: "fixed", top: 40, left: 40 },
      },
      "Plan",
    ),
    anchor === null
      ? null
      : createElement(TooltipCard, {
          id: "card",
          anchor,
          instant: true,
          onChoice: () => chosen.push("choice"),
          children: card,
        }),
  );
}

/** The hung card's element, once it is placed. */
async function hung(): Promise<HTMLElement> {
  const card = page.getByRole("tooltip");
  await expect.element(card).toHaveAttribute("data-placed", "true");
  return document.querySelector<HTMLElement>("[role='tooltip']") ?? expect.unreachable();
}

test("a card says its subject in its head and notes, and a row under its rule is pressed across the card", async () => {
  const chosen: string[] = [];
  const { container } = await mount(
    createElement(Carded, {
      chosen,
      card: createElement(HoverCard, {
        "data-plan": "launch",
        children: [
          createElement(HoverCardHead, {
            key: "head",
            glyph: createElement("svg", { "aria-hidden": true, viewBox: "0 0 16 16" }),
            name: "Teammate invitations",
            sub: "acme/relay",
            corner: "3h",
          }),
          createElement(HoverCardNote, {
            key: "note",
            children: "Expire an invitation after a week.",
          }),
          createElement(HoverCardRule, { key: "rule" }),
          createElement("button", { key: "open", type: "button" }, "Open Invite flow"),
        ],
      }),
    }),
  );
  const card = await hung();
  expect(card.querySelector("[data-plan='launch']")).not.toBeNull();
  const head = card.querySelector(".luke-hover-card-head");
  expect(head?.querySelector(".luke-hover-card-glyph svg")).not.toBeNull();
  expect(head?.querySelector(".luke-hover-card-name")?.textContent).toBe("Teammate invitations");
  expect(head?.querySelector(".luke-hover-card-sub")?.textContent).toBe("acme/relay");
  expect(head?.querySelector(".luke-hover-card-corner")?.textContent).toBe("3h");
  expect(card.querySelector(".luke-hover-card-note")?.textContent).toBe(
    "Expire an invitation after a week.",
  );
  await expect
    .element(page.getByRole("button", { name: "Plan" }))
    .toHaveAccessibleDescription(/Teammate invitations/u);

  await page.getByRole("button", { name: "Plan" }).hover();
  await page.getByRole("button", { name: "Open Invite flow" }).click();
  expect(chosen).toEqual(["choice"]);
  expect(await accessibilityViolations(container)).toEqual([]);
});

test("a name or a note on one line is marked to fade where it is cut short, and only there", async () => {
  await mount(
    createElement(Carded, {
      chosen: [],
      card: createElement(HoverCard, {
        children: [
          createElement(HoverCardHead, {
            key: "head",
            oneLine: true,
            name: "A task standing in for a title, far too long for the one line a card gives it",
            corner: "12m",
          }),
          createElement(HoverCardNote, {
            key: "note",
            oneLine: true,
            children: "Reading the sweep",
          }),
        ],
      }),
    }),
  );
  const card = await hung();
  const name = card.querySelector(".luke-hover-card-name");
  const note = card.querySelector(".luke-hover-card-note");
  await expect.poll(() => name?.getAttribute("data-overflow")).toBe("true");
  expect(note?.getAttribute("data-overflow")).toBe("false");
});
