// @vitest-environment jsdom

import { act, cloneElement, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import { SkillChip } from "./skill-chip.js";

/**
 * skill-chip.test.ts -- a chosen skill's pill is no Tab stop; a press opens
 * its file where the place can, before the press reaches a hint wrapping it,
 * and where it cannot, the pill says so by not opening.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

function mount(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container.querySelector<HTMLElement>(".luke-skill-chip") ?? expect.unreachable();
}

test("a press opens the skill's file, then reaches the hint wrapping the pill, which is no Tab stop", () => {
  const done: string[] = [];
  const chip = mount(
    cloneElement(
      createElement(SkillChip, { label: "/testing", onOpen: () => done.push("opened") }),
      { onClick: () => done.push("hint") },
    ),
  );

  act(() => chip.click());

  expect(done).toEqual(["opened", "hint"]);
  expect(chip.textContent).toBe("/testing");
  expect(chip.tabIndex).toBe(-1);
  expect(chip.hasAttribute("data-opens")).toBe(true);
});

test("a pill whose place cannot open its file opens nothing", () => {
  const chip = mount(createElement(SkillChip, { label: "/orchestrate" }));

  expect(chip.hasAttribute("data-opens")).toBe(false);
});
