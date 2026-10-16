// @vitest-environment jsdom

import assert from "node:assert/strict";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { APP_COMMAND } from "#shared/shortcuts";
import { layContainersAt } from "#testing/container-width";
import { onRegistry } from "#testing/copy-feedback";
import { runAppCommand } from "./app-commands";
import { FindScope } from "./find-in-tab";

/**
 * find-bar-width.test.ts -- the ⌘F bar in a tab as narrow as a column gets:
 * where the tab is too narrow for the bar's own width, the bar spans it,
 * inset alike at both sides, and its field takes what the buttons leave,
 * so the bar never reaches past the tab's start over the sidebar. jsdom
 * lays nothing out, so each width is the stylesheets' container queries
 * resolved for a tab that wide (`#testing/container-width`). Synthetic.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.restoreAllMocks();
});

/** The bar summoned in a tab `width` pixels wide, and its field's well. */
function summonedAt(width: number): { bar: HTMLElement; well: HTMLElement } {
  layContainersAt({ "find-scope": width });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(FindScope, {
          active: true,
          subject: { agent: "agent-1" },
          children: createElement("p", null, "Invites expire after seven days."),
        }),
      ),
    ),
  );
  act(() => runAppCommand(APP_COMMAND.FIND));
  const bar = container.querySelector<HTMLElement>("search.find-bar") ?? assert.fail("it opens");
  const well = bar.querySelector<HTMLElement>(".find-bar-well") ?? assert.fail("it has a field");
  return { bar, well };
}

test("in a tab a 280px column wide the bar spans the tab from inset to inset, its field taking what the buttons leave", () => {
  const { bar, well } = summonedAt(280);
  assert.notEqual(getComputedStyle(bar).left, "auto");
  assert.notEqual(getComputedStyle(bar).right, "auto");
  assert.equal(getComputedStyle(well).minWidth, "0px");
  assert.notEqual(getComputedStyle(well).width, "240px");
});

test("in a tab narrower than 300px the tally gives the field its room, said to a reader rather than drawn", () => {
  const { bar } = summonedAt(240);
  const field = bar.querySelector<HTMLInputElement>("input") ?? assert.fail("it has a field");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, "zz");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const tally = bar.querySelector<HTMLElement>(".find-bar-tally") ?? assert.fail("it tallies");
  assert.equal(tally.getAttribute("aria-live"), "polite");
  assert.equal(getComputedStyle(tally).position, "absolute");
  assert.equal(getComputedStyle(tally).clipPath, "inset(50%)");
});

test("in a tab a 720px column wide the bar keeps its own width at the tab's end", () => {
  const { bar, well } = summonedAt(720);
  assert.equal(getComputedStyle(bar).left, "auto");
  assert.equal(getComputedStyle(well).width, "240px");
});
