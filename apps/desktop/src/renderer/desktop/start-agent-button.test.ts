// @vitest-environment jsdom

import assert from "node:assert/strict";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { focusByKeyboard, layWindowStyles, ringOf } from "#testing/focus-ring";
import { codingAgentsControl } from "#testing/tasks-control";
import { StartAgentButton } from "./start-agent-button";

/**
 * start-agent-button.test.ts -- Start, unavailable or busy starting, still
 * takes the keyboard so its hover can say why, and its ring is drawn at full
 * strength while its words fade, as an unavailable button's do. Laid out in
 * the window's own stylesheets (`#testing/focus-ring`); a control whose start
 * is unavailable, and one whose start is under way.
 */

/** How strongly an element is drawn: its opacity and every box's around it, multiplied. */
function strength(element: Element): number {
  let drawn = 1;
  for (let box: Element | null = element; box !== null; box = box.parentElement) {
    drawn *= Number.parseFloat(getComputedStyle(box).opacity || "1");
  }
  return drawn;
}

/** Start drawn over `control`, answering its main part and a way to take it down. */
async function drawnStart(control: ReturnType<typeof codingAgentsControl>) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () =>
    root.render(onRegistry(AtomRegistry.make(), createElement(StartAgentButton, { control }))),
  );
  const main = container.querySelector<HTMLElement>('button[aria-label="Start a coding agent"]');
  assert.ok(main, "Start stands");
  return {
    main,
    remove: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

for (const [state, control] of [
  ["unavailable", codingAgentsControl()],
  [
    "busy starting",
    codingAgentsControl({
      start: {
        available: true,
        reason: undefined,
        busy: true,
        note: undefined,
        onPress: () => undefined,
      },
    }),
  ],
] as const) {
  test(`Start, ${state}, keeps the keyboard's ring at full strength and fades its words instead`, async () => {
    const styles = await layWindowStyles();
    const { main, remove } = await drawnStart(control);
    assert.equal(main.getAttribute("aria-disabled"), "true", "it says it is unavailable");

    focusByKeyboard(main);
    assert.ok(ringOf(main), "it takes the keyboard and rings");
    assert.equal(strength(main), 1, "nothing fades the ring");
    const drawn = getComputedStyle(main);
    assert.notEqual(
      drawn.getPropertyValue("-webkit-text-fill-color") || drawn.color,
      drawn.color,
      "its words fade as an unavailable button's do",
    );

    remove();
    styles.remove();
  });
}
