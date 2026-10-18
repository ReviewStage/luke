// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { MARK_PROVIDER } from "../../marks/provider-mark.js";
import {
  PROVIDER_BUTTON_SIZE,
  ProviderButton,
  type ProviderButtonSize,
} from "./provider-button.js";

/**
 * provider-button.test.ts -- a provider's button is named "Continue with"
 * the provider in either size and begins its sign-in when pressed; pending,
 * it is named for the act in progress, says it is busy, and refuses another
 * press; disabled, it refuses the press; and the way in taken last is
 * described by its pill without the pill joining its name.
 */

const SIZES = Object.values(PROVIDER_BUTTON_SIZE);

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Draws `element` into a fresh container on the page. */
function mount(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** GitHub's button in `size`, counting its presses into `presses`. */
function gitHub(
  size: ProviderButtonSize,
  presses: string[],
  props: Partial<Parameters<typeof ProviderButton>[0]> = {},
): React.ReactElement {
  return createElement(ProviderButton, {
    provider: MARK_PROVIDER.GITHUB,
    name: "GitHub",
    size,
    pendingLabel: "Opening GitHub",
    onPress: () => presses.push("github"),
    ...props,
  });
}

/** The one button drawn, and the name a reader hears for it. */
function only(container: HTMLElement) {
  const buttons = Array.from(container.querySelectorAll("button"));
  expect(buttons).toHaveLength(1);
  const button = buttons[0];
  if (button === undefined) throw new Error("no button is drawn");
  return { button, name: button.getAttribute("aria-label") ?? button.textContent };
}

test("a provider's button is named for its provider and begins its sign-in when pressed", () => {
  for (const size of SIZES) {
    const presses: string[] = [];
    const { button, name } = only(mount(gitHub(size, presses)));
    expect(name).toBe("Continue with GitHub");
    act(() => button.click());
    expect(presses).toEqual(["github"]);
  }
});

test("a pending button is named for the act in progress, says it is busy, and refuses a press", () => {
  for (const size of SIZES) {
    const presses: string[] = [];
    const { button, name } = only(mount(gitHub(size, presses, { pending: true })));
    expect(name).toBe("Opening GitHub");
    expect(button.getAttribute("aria-busy")).toBe("true");
    act(() => button.click());
    expect(presses).toEqual([]);
  }
});

test("a disabled button refuses its press", () => {
  for (const size of SIZES) {
    const presses: string[] = [];
    const { button } = only(mount(gitHub(size, presses, { disabled: true })));
    expect(button.disabled).toBe(true);
    act(() => button.click());
    expect(presses).toEqual([]);
  }
});

test("the way in taken last is described as Last used, outside its name", () => {
  for (const size of SIZES) {
    const container = mount(gitHub(size, [], { lastUsed: true }));
    const { button, name } = only(container);
    const described = document.getElementById(button.getAttribute("aria-describedby") ?? "");
    expect(described?.textContent).toBe("Last used");
    expect(name).toBe("Continue with GitHub");
  }
});

test("a button not used last has no description", () => {
  for (const size of SIZES) {
    const { button } = only(mount(gitHub(size, [])));
    expect(button.hasAttribute("aria-describedby")).toBe(false);
  }
});
