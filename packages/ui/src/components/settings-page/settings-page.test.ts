// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { Button } from "../button/button.js";
import { SettingsRow } from "../settings-row/settings-row.js";
import {
  SETTINGS_LINE_KIND,
  SettingsLine,
  SettingsSection,
} from "../settings-section/settings-section.js";
import { SettingsPage } from "./settings-page.js";

/**
 * settings-page.test.ts -- the page's title is its one `h1`, each headed
 * section under it is a region its `h2` names, what acts on the whole
 * page stands in the page's head beside the title, and the page holds its
 * sections back, busy, while it is pending or a loading line stands in them.
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

/** Whether the page holds its sections back, as it does while a read is out. */
function heldBack(container: HTMLElement): boolean {
  return container.querySelector('[aria-busy="true"]') !== null;
}

/** A page whose one section reads its rows until `read`, a loading line standing in their place. */
function ReadingPage({ read }: { read: boolean }): React.JSX.Element {
  return createElement(SettingsPage, {
    title: "Workspace",
    children: createElement(SettingsSection, {
      title: "Members",
      children: read
        ? createElement(SettingsRow, {
            label: "Ada",
            children: () => createElement(Button, { children: "Remove" }),
          })
        : createElement(SettingsLine, {
            kind: SETTINGS_LINE_KIND.LOADING,
            children: "Loading the members",
          }),
    }),
  });
}

test("a loading line holds the page's sections back until its read lands", async () => {
  const container = await render(createElement(ReadingPage, { read: false }));
  expect(heldBack(container)).toBe(true);
  await act(async () => roots[0]?.render(createElement(ReadingPage, { read: true })));
  expect(heldBack(container)).toBe(false);
  expect(container.textContent).toContain("Ada");
});

test("a pending page holds its sections back, and one with nothing out does not", async () => {
  const pending = await render(
    createElement(SettingsPage, { title: "Voice", pending: true, children: section("Microphone") }),
  );
  const settled = await render(
    createElement(SettingsPage, { title: "Voice", children: section("Microphone") }),
  );
  expect(heldBack(pending)).toBe(true);
  expect(heldBack(settled)).toBe(false);
});
