// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { Button } from "../button/button.js";
import { SettingsRow } from "../settings-row/settings-row.js";
import {
  SETTINGS_SKELETON_CONTROL,
  SettingsRowsSkeleton,
  SettingsSection,
} from "../settings-section/settings-section.js";
import { TOOLBAR_LOOK } from "../toolbar/toolbar.js";
import { SettingsPage } from "./settings-page.js";

const roots: Root[] = [];

const MEMBER_ROW = { described: false, controls: [SETTINGS_SKELETON_CONTROL.BUTTON] };

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

async function render(element: React.JSX.Element): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => root.render(element));
  return container;
}

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
  const head = container.querySelector("h1")?.closest("header");
  const button = [...(head?.querySelectorAll("button") ?? [])].find(
    (element) => element.textContent === "Reset",
  );
  expect(head?.querySelector("h1")?.textContent).toBe("Voice");
  expect(button).toBeDefined();
});

test("on a phone the bar names the page and ends with its actions, and the page opens on its description", async () => {
  const container = await render(
    createElement(SettingsPage, {
      title: "Voice",
      description: "Kept on this Mac",
      look: TOOLBAR_LOOK.PHONE,
      lead: createElement(Button, { children: "Settings" }),
      actions: createElement(Button, { children: "Reset" }),
      children: section("Microphone"),
    }),
  );
  const bar = container.querySelector('header[data-look="phone"]');
  expect([...(bar?.querySelectorAll("button") ?? [])].map((each) => each.textContent)).toEqual([
    "Settings",
    "Reset",
  ]);
  expect(container.querySelectorAll("h1").length).toBe(1);
  expect(bar?.querySelector("h1")?.textContent).toBe("Voice");
  expect(container.querySelector(".ui-settings-page-head")?.textContent).toBe("Kept on this Mac");
});

test("a page with no actions holds only its title in its head", async () => {
  const container = await render(
    createElement(SettingsPage, { title: "Voice", children: section("Microphone") }),
  );
  const head = container.querySelector("h1")?.closest("header");
  expect(head?.textContent).toBe("Voice");
  expect(head?.querySelector("button")).toBeNull();
});

function ReadingPage({ read }: { read: boolean }): React.JSX.Element {
  return createElement(SettingsPage, {
    title: "Workspace",
    children: [
      section("General"),
      createElement(SettingsSection, {
        key: "Members",
        title: "Members",
        children: read
          ? createElement(SettingsRow, {
              label: "Ada",
              children: () => createElement(Button, { children: "Remove" }),
            })
          : createElement(SettingsRowsSkeleton, {
              label: "Loading the members",
              rows: [MEMBER_ROW, MEMBER_ROW],
            }),
      }),
    ],
  });
}

function busy(container: HTMLElement): readonly (string | null)[] {
  return [...container.querySelectorAll('[aria-busy="true"]')].map((each) =>
    each.getAttribute("role"),
  );
}

test("a page draws every section while one still reads, its placeholder alone busy, and the rows land in its place", async () => {
  const container = await render(createElement(ReadingPage, { read: false }));
  expect(busy(container)).toEqual(["status"]);
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Loading the members");
  expect(container.querySelector("button")?.textContent).toBe("Change");
  await act(async () => roots[0]?.render(createElement(ReadingPage, { read: true })));
  expect(busy(container)).toEqual([]);
  expect(container.textContent).toContain("Ada");
});
