// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { CONFIRM_STAGE, type ConfirmStage } from "./confirm-state";
import { ConfirmSwap } from "./confirm-swap";

/**
 * The in-place confirm as a reader meets it: the question it asks is drawn
 * beside its two answers and names the group they stand in, so a sighted hand
 * reads what Cancel and the red verb answer rather than guessing it.
 */

const ignore = () => undefined;
const mounted: Root[] = [];
const QUESTION = "Delete the account dean@example.com? This cannot be undone.";

function mount(stage: ConfirmStage): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  act(() =>
    root.render(
      createElement(ConfirmSwap, {
        confirm: {
          question: QUESTION,
          stage,
          verb: "Delete account",
          running: "Deleting account",
          onKeep: ignore,
          onAct: ignore,
        },
        children: createElement("button", { type: "button" }, "Delete"),
      }),
    ),
  );
  return container;
}

/** A group's name, read the way assistive technology reads it: its label, or the words it points at. */
function groupName(group: Element): string | undefined {
  const label = group.getAttribute("aria-label");
  if (label !== null) return label;
  const ids = group.getAttribute("aria-labelledby");
  return ids
    ?.split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

afterEach(() => {
  act(() => {
    for (const root of mounted.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

test("an asked confirm draws its question beside its answers, and the question names them", () => {
  const container = mount(CONFIRM_STAGE.ASKING);
  const group =
    container.querySelector<HTMLFieldSetElement>('fieldset[data-drawn="true"]') ??
    assert.fail("no question asked");
  assert.ok(group.textContent?.includes(QUESTION), `the group draws "${group.textContent}"`);
  assert.equal(groupName(group), QUESTION);
});
