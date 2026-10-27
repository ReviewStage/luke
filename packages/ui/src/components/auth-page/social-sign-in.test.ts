// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { SIGN_IN_UNFINISHED, SocialSignInCard } from "./social-sign-in.js";

/**
 * social-sign-in.test.ts -- the card offers a button for every provider, a press names its provider, one opening holds the rest, and a failure is said in the alert region.
 */

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

function buttons(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll("button")];
}

test("a press on a provider's button names that provider", () => {
  const pressed: string[] = [];
  const container = mount(
    createElement(SocialSignInCard, {
      title: "Sign in",
      pending: undefined,
      onPress: (provider: string) => pressed.push(provider),
    }),
  );
  expect(buttons(container).map((each) => each.textContent)).toEqual([
    "Continue with Google",
    "Continue with GitHub",
  ]);
  act(() => buttons(container)[1]?.click());
  expect(pressed).toEqual(["github"]);
});

test("one opening holds the other choice and is marked busy", () => {
  const container = mount(
    createElement(SocialSignInCard, {
      title: "Sign in",
      pending: "google",
      onPress: () => undefined,
    }),
  );
  const [google, github] = buttons(container);
  expect(google?.getAttribute("aria-busy")).toBe("true");
  expect(github?.disabled).toBe(true);
});

test("a sign-in that could not start is said in the alert region", () => {
  const container = mount(
    createElement(SocialSignInCard, {
      title: "Sign in",
      pending: undefined,
      failed: true,
      onPress: () => undefined,
    }),
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(SIGN_IN_UNFINISHED);
});
