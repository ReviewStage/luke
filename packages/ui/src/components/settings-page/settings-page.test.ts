// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { Button } from "../button/button.js";
import { SettingsRow } from "../settings-row/settings-row.js";
import { SettingsSection } from "../settings-section/settings-section.js";
import { SettingsPage } from "./settings-page.js";

/**
 * settings-page.test.ts -- the page's title is its one `h1`, each headed
 * section under it is a region its `h2` names, and what acts on the whole
 * page stands in the page's head beside the title.
 */

const roots: Root[] = [];

/** A section headed `title` holding one row whose control is a button. */
function section(title: string): React.JSX.Element {
  return createElement(SettingsSection, {
    key: title,
    title,
    children: createElement(SettingsRow, {
      label: `${title} setting`,
      children: () => createElement(Button, { children: "Change" }),
    }),
  });
}

/** Draws `element` into a fresh container in the document. */
async function render(element: React.JSX.Element): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => root.render(element));
  return container;
}

/** The text of the element `id` names, as a region's accessible name reads it. */
function named(id: string | null): string | undefined {
  return id === null ? undefined : (document.getElementById(id)?.textContent ?? undefined);
}

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

test("the title is the page's one h1 and each section a region its h2 names", async () => {
  const container = await render(
    createElement(SettingsPage, {
      title: "Voice",
      children: [section("Microphone"), section("Speaker")],
    }),
  );
  const titles = container.querySelectorAll("h1");
  expect([...titles].map((title) => title.textContent)).toEqual(["Voice"]);
  const regions = [...container.querySelectorAll("section[aria-labelledby]")];
  expect(regions.map((region) => named(region.getAttribute("aria-labelledby")))).toEqual([
    "Microphone",
    "Speaker",
  ]);
  for (const region of regions) {
    expect(region.querySelector("h2")?.textContent).toBe(
      named(region.getAttribute("aria-labelledby")),
    );
  }
});

test("the page's actions stand in its head beside its title", async () => {
  const container = await render(
    createElement(SettingsPage, {
      title: "Voice",
      actions: createElement(Button, { children: "Reset" }),
      children: section("Microphone"),
    }),
  );
  const head = container.querySelector("header");
  const button = [...(head?.querySelectorAll("button") ?? [])].find(
    (element) => element.textContent === "Reset",
  );
  expect(head?.querySelector("h1")?.textContent).toBe("Voice");
  expect(button).toBeDefined();
});

test("a page with no actions holds only its title in its head", async () => {
  const container = await render(
    createElement(SettingsPage, { title: "Voice", children: section("Microphone") }),
  );
  const head = container.querySelector("header");
  expect(head?.textContent).toBe("Voice");
  expect(head?.querySelector("button")).toBeNull();
});
