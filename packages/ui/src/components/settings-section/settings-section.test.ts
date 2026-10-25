// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { Button } from "../button/button.js";
import { SettingsRow, SettingsRowMark, SettingsRowValue } from "../settings-row/settings-row.js";
import {
  SETTINGS_ROW_MARK_WIDTH,
  SETTINGS_SECTION_FRAME,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
  type SettingsRowSkeletonShape,
  SettingsRowsSkeleton,
  SettingsSection,
  SettingsSectionsSkeleton,
} from "./settings-section.js";

/**
 * settings-section.test.ts -- a headed section is a region its heading
 * names, holding its rows; a section with no heading, or an empty one, draws
 * its rows with no heading and names no region; one with no card is still
 * the region its heading names; a line in the rows' place says its note;
 * placeholder rows and sections stand in the boxes of the ones that land,
 * shaped as they are; and they tell a reader what is still being read.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** A section headed `title` holding a row for each label, drawn into the page. */
function draw(title: string | undefined, labels: readonly string[]): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const rows = labels.map((label) =>
    createElement(SettingsRow, {
      key: label,
      label,
      children: () => createElement(Button, { children: `Change ${label}` }),
    }),
  );
  act(() => root.render(createElement(SettingsSection, { title, children: rows })));
  return container;
}

/** The name a section's `aria-labelledby` gives it, or nothing when it names none. */
function regionName(section: Element): string | undefined {
  const labelledBy = section.getAttribute("aria-labelledby");
  if (labelledBy === null) return undefined;
  return document.getElementById(labelledBy)?.textContent ?? undefined;
}

test("a headed section is a region named by its level-two heading", () => {
  const container = draw("Voice", ["Microphone", "Speaker"]);
  const section = container.querySelector("section");
  const heading = container.querySelector("h2");
  expect(heading?.textContent).toBe("Voice");
  expect(section === null ? undefined : regionName(section)).toBe("Voice");
});

test("a section holds every row it is handed, in order", () => {
  const container = draw("Voice", ["Microphone", "Speaker", "Push to talk"]);
  const section = container.querySelector("section");
  const buttons = [...(section?.querySelectorAll("button") ?? [])].map((b) => b.textContent);
  expect(buttons).toEqual(["Change Microphone", "Change Speaker", "Change Push to talk"]);
});

test("a section with no heading, or an empty one, draws no heading and names no region", () => {
  for (const title of [undefined, ""]) {
    const container = draw(title, ["Launch at login"]);
    const section = container.querySelector("section");
    expect(container.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
    expect(section === null ? "no section" : regionName(section)).toBeUndefined();
    expect(container.querySelector("button")?.textContent).toBe("Change Launch at login");
  }
});

test("a section with no card is still a region named by its heading, holding the control it is handed", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(SettingsSection, {
        title: "Prompt",
        frame: SETTINGS_SECTION_FRAME.NONE,
        children: createElement(Button, { children: "Write the prompt" }),
      }),
    ),
  );
  const section = container.querySelector("section");
  expect(section === null ? undefined : regionName(section)).toBe("Prompt");
  expect(section?.querySelector("button")?.textContent).toBe("Write the prompt");
});

/** Draws `element` into the page. */
function mount(element: React.JSX.Element): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** How many placeholder blocks stand in `within`, each hidden from a reader. */
const blocks = (within: Element) => within.querySelectorAll('[aria-hidden="true"]').length;

test("a line in the rows' place says its note", () => {
  const container = mount(
    createElement(SettingsSection, {
      title: "Members",
      children: createElement(SettingsLine, { children: "Nobody is invited yet." }),
    }),
  );
  expect(container.querySelector("section")?.textContent).toContain("Nobody is invited yet.");
});

/** The boxes a settings row or section is built of, in order: every class of the settings family, words and blocks aside. */
function boxes(within: Element): readonly string[] {
  return [...within.querySelectorAll("[class]")]
    .map((element) => element.getAttribute("class") ?? "")
    .filter((name) => /^luke-settings-(row|section)/.test(name));
}

/** A shape's placeholder rows, drawn bare, with no region of their own. */
function placeholderRows(rows: readonly SettingsRowSkeletonShape[]): HTMLElement {
  return mount(createElement(SettingsRowsSkeleton, { rows }));
}

test("a placeholder row stands in the boxes of the row that lands: no description where it has none", () => {
  const real = mount(
    createElement(SettingsRow, {
      label: "Delete account",
      children: () => createElement(Button, { children: "Delete account" }),
    }),
  );
  const placeholder = placeholderRows([
    { described: false, controls: [SETTINGS_SKELETON_CONTROL.BUTTON] },
  ]);
  expect(boxes(placeholder)).toEqual(boxes(real));
  expect(placeholder.querySelector('[role="status"]')).toBeNull();
});

test("a placeholder row stands a mark, a description, and a value column where the row that lands has them", () => {
  const real = mount(
    createElement(SettingsRow, {
      label: "Ada",
      description: "ada@example.com",
      leading: createElement(SettingsRowMark, { children: "A" }),
      children: () => [
        createElement(SettingsRowValue, { key: "role", children: "Admin" }),
        createElement(Button, { key: "more", children: "More" }),
      ],
    }),
  );
  const placeholder = placeholderRows([
    {
      described: true,
      mark: SETTINGS_ROW_MARK_WIDTH,
      controls: [SETTINGS_SKELETON_CONTROL.VALUE, SETTINGS_SKELETON_CONTROL.MORE],
    },
  ]);
  // The mark's own box is the page's to choose, so only the row's are compared.
  expect(boxes(placeholder)).toEqual(
    boxes(real).filter((name) => !name.split(/\s+/).includes("luke-settings-row-mark")),
  );
  expect(blocks(placeholder)).toBe(5);
});

test("placeholder rows tell a reader what is being read, a block for each word, mark, and control", () => {
  const container = mount(
    createElement(SettingsSection, {
      title: "Members",
      children: [
        createElement(SettingsRowsSkeleton, {
          key: "plain",
          label: "Loading the keys",
          rows: Array.from({ length: 3 }, () => ({
            described: true,
            controls: [SETTINGS_SKELETON_CONTROL.BUTTON],
          })),
        }),
        createElement(SettingsRowsSkeleton, {
          key: "marked",
          label: "Loading the members",
          rows: Array.from({ length: 2 }, () => ({
            described: false,
            mark: SETTINGS_ROW_MARK_WIDTH,
            controls: [SETTINGS_SKELETON_CONTROL.SWITCH, SETTINGS_SKELETON_CONTROL.MORE],
          })),
        }),
      ],
    }),
  );
  const [plain, marked] = [...container.querySelectorAll('[role="status"]')];
  expect([plain?.textContent, plain?.getAttribute("aria-busy")]).toEqual([
    "Loading the keys",
    "true",
  ]);
  expect(marked?.textContent).toBe("Loading the members");
  expect([plain && blocks(plain), marked && blocks(marked)]).toEqual([9, 8]);
});

test("placeholder sections stand in the boxes of the sections that land, headed only where they are", () => {
  const row = { described: false, controls: [SETTINGS_SKELETON_CONTROL.BUTTON] };
  const real = mount(
    createElement("div", {
      children: [
        createElement(SettingsSection, {
          key: "identity",
          children: createElement(SettingsRow, { label: "Acme" }),
        }),
        createElement(SettingsSection, {
          key: "members",
          title: "Members",
          children: [
            createElement(SettingsRow, { key: "ada", label: "Ada" }),
            createElement(SettingsRow, { key: "grace", label: "Grace" }),
          ],
        }),
      ],
    }),
  );
  const placeholder = mount(
    createElement(SettingsSectionsSkeleton, {
      label: "Loading your workspaces",
      sections: [
        { headed: false, rows: [row] },
        { headed: true, rows: [row, row] },
      ],
    }),
  );
  expect(boxes(placeholder)).toEqual(boxes(real));
});

test("placeholder sections are one status a reader hears, with no heading or named region of their own", () => {
  const container = mount(
    createElement(SettingsSectionsSkeleton, {
      label: "Loading the integrations",
      sections: [
        {
          headed: true,
          rows: [
            { described: true, controls: [] },
            { described: true, controls: [] },
          ],
        },
        { headed: false, rows: [{ described: false, controls: [SETTINGS_SKELETON_CONTROL.MORE] }] },
      ],
    }),
  );
  const regions = container.querySelectorAll('[role="status"]');
  expect([...regions].map((region) => region.textContent)).toEqual(["Loading the integrations"]);
  expect(container.querySelectorAll("h1, h2, h3, section[aria-labelledby]").length).toBe(0);
  expect(blocks(container)).toBe(1 + 2 * 2 + 2);
});
