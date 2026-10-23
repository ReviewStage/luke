// @vitest-environment jsdom

import { LANDING_TONE } from "@luke/features/landing-outcome";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { MARK_PROVIDER } from "../../marks/provider-mark.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { AuthMark } from "./auth-mark.js";
import { AuthPage } from "./auth-page.js";

/**
 * auth-page.test.ts -- the page is one main landmark holding one card named
 * by its title, its artwork hidden from a reader; what went wrong is
 * announced from an alert region that stood before it arrived; a page with
 * nothing to say past its title says its title alone; its mark wears a badge
 * only once the flow has ended, which leaves the title the region's name;
 * and the way on is one link under the words.
 */

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

/** A sign-in page whose provider choice fails to start when pressed. */
function SignIn(): React.JSX.Element {
  const [failure, setFailure] = useState<string | undefined>(undefined);
  return createElement(AuthPage, {
    mark: createElement("svg", { width: 52, height: 52 }),
    title: "Sign in to Luke",
    error: failure,
    footnote: "You can close this window after Luke confirms the sign-in.",
    children: createElement(Button, {
      variant: BUTTON_VARIANT.OUTLINE,
      onClick: () => setFailure("Sign-in could not start."),
      children: "Continue with GitHub",
    }),
  });
}

test("the card is a region in the page's main landmark named by its title, its artwork hidden", () => {
  const container = mount(createElement(SignIn));
  const card = container.querySelector("main > section");
  const title = container.querySelector("h1");
  expect(title?.textContent).toBe("Sign in to Luke");
  expect(card?.getAttribute("aria-labelledby")).toBe(title?.id);
  expect(container.querySelector("svg")?.closest('[aria-hidden="true"]')).not.toBeNull();
  expect(card?.textContent).toContain("Continue with GitHub");
  expect(card?.textContent).toContain("You can close this window");
});

test("what went wrong is announced from an alert region that stood empty before it", () => {
  const container = mount(createElement(SignIn));
  const alert = container.querySelector('[role="alert"]');
  expect(alert?.textContent).toBe("");
  act(() => container.querySelector("button")?.click());
  expect(container.querySelector('[role="alert"]')).toBe(alert);
  expect(alert?.textContent).toBe("Sign-in could not start.");
});

test("a page with nothing to say past its title says its title alone", () => {
  const container = mount(
    createElement(AuthPage, { title: "Continuing to Luke…", description: "", footnote: null }),
  );
  expect(container.querySelector("main")?.textContent).toBe("Continuing to Luke…");
  expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
});

/** The glyphs a page's hidden artwork draws: the mark's, and its badge's where it wears one. */
function artworkGlyphs(container: HTMLElement): number {
  return container.querySelectorAll('[aria-hidden="true"] svg').length;
}

test("a page still on its way draws its mark with no badge", () => {
  const working = mount(
    createElement(AuthPage, {
      mark: createElement(AuthMark, { provider: MARK_PROVIDER.GITHUB }),
      title: "Connecting GitHub…",
    }),
  );
  expect(artworkGlyphs(working)).toBe(1);

  const ended = mount(
    createElement(AuthPage, {
      mark: createElement(AuthMark, {
        provider: MARK_PROVIDER.GITHUB,
        tone: LANDING_TONE.FAILED,
      }),
      title: "Luke could not reach GitHub",
    }),
  );
  expect(artworkGlyphs(ended)).toBe(2);
});

test("a badged page is still named by its title alone", () => {
  for (const tone of Object.values(LANDING_TONE)) {
    const container = mount(
      createElement(AuthPage, {
        mark: createElement(AuthMark, { tone }),
        title: "GitHub is connected",
        description: "You can close this tab.",
      }),
    );
    const region = container.querySelector("section");
    const name = document.getElementById(region?.getAttribute("aria-labelledby") ?? "");
    expect(name?.textContent).toBe("GitHub is connected");
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe("");
    container.remove();
  }
});

test("the way on is one link, named by its words, going where it says", () => {
  const pressed: string[] = [];
  const container = mount(
    createElement(AuthPage, {
      title: "Luke could not reach GitHub",
      description: "Try again in a moment.",
      action: {
        label: "Open Luke",
        href: "/app",
        onClick: (event) => {
          event.preventDefault();
          pressed.push(event.currentTarget.getAttribute("href") ?? "");
        },
      },
    }),
  );
  const links = Array.from(container.querySelectorAll("a"));
  expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["Open Luke", "/app"],
  ]);
  act(() => links[0]?.click());
  expect(pressed).toEqual(["/app"]);
});

test("a page with no way on draws no link", () => {
  const container = mount(createElement(AuthPage, { title: "Continuing to Luke…" }));
  expect(container.querySelector("a")).toBeNull();
});
