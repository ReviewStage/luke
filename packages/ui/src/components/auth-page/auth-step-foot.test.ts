// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { AuthStepFoot } from "./auth-step-foot.js";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

function mount(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

function buttonWords(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("button"), (each) => each.textContent ?? "");
}

test("the foot offers only what the step gives, each press reaching its own act", () => {
  const pressed: string[] = [];
  const first = mount(
    createElement(AuthStepFoot, {
      at: 1,
      total: 4,
      next: { label: "Continue", onPress: () => pressed.push("continue") },
    }),
  );
  expect(first.textContent).toContain("1 of 4");
  expect(buttonWords(first)).toEqual(["Continue"]);

  const optional = mount(
    createElement(AuthStepFoot, {
      at: 2,
      total: 4,
      onBack: () => pressed.push("back"),
      onSkip: () => pressed.push("skip"),
    }),
  );
  expect(buttonWords(optional)).toEqual(["Back", "Skip"]);
  for (const each of optional.querySelectorAll("button")) act(() => each.click());
  act(() => first.querySelector("button")?.click());
  expect(pressed).toEqual(["back", "skip", "continue"]);
});
