// @vitest-environment jsdom
// use-disclosure.test.ts -- something closed stays drawn through its exit and goes once the exit is done; opening again keeps it.

import assert from "node:assert/strict";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { installExits, uninstallExits } from "#testing/exits";
import { useDisclosure } from "./use-disclosure";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  uninstallExits();
});

/** The exit a leaving card runs, as a stylesheet keyed on `data-leaving` would. */
const LEAVING_CARD = ".card[data-leaving]";

/** A card someone else opens and closes, drawn while the disclosure says so. */
function Card({ open }: { open: boolean }): ReactNode {
  const card = useDisclosure(open);
  if (!card.mounted) return null;
  return createElement(
    "section",
    { ref: card.ref, className: "card", "data-leaving": card.leaving ? "" : undefined },
    "Call",
  );
}

/** The card mounted, with a way to open or close it. */
function mounted(open: boolean) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const draw = (next: boolean) => act(() => root.render(createElement(Card, { open: next })));
  draw(open);
  return { draw, card: () => container.querySelector(".card") };
}

/** Lets the promises settled so far run. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 4; tick += 1) await Promise.resolve();
  });
}

test("a closed card is drawn leaving until its exit is done, then taken out", async () => {
  const exits = installExits(LEAVING_CARD);
  const card = mounted(false);
  assert.equal(card.card(), null);

  card.draw(true);
  assert.equal(card.card()?.hasAttribute("data-leaving"), false);

  card.draw(false);
  assert.equal(card.card()?.hasAttribute("data-leaving"), true, "closed, it is drawn leaving");
  await settle();
  assert.ok(card.card(), "its exit still running, it stays");

  act(() => exits[0]?.finish());
  await settle();
  assert.equal(card.card(), null);
});

test("opening a card again while it leaves keeps it, and the exit cut short takes nothing away", async () => {
  const exits = installExits(LEAVING_CARD);
  const card = mounted(true);
  card.draw(false);
  card.draw(true);
  assert.equal(card.card()?.hasAttribute("data-leaving"), false);

  act(() => {
    exits[0]?.cancel();
  });
  await settle();
  assert.ok(card.card());
});

test("a card whose element runs no exit is taken out the moment it closes", () => {
  const card = mounted(true);
  card.draw(false);
  assert.equal(card.card(), null);
});
