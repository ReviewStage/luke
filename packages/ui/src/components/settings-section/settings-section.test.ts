// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { Button } from "../button/button.js";
import { SettingsRow } from "../settings-row/settings-row.js";
import {
  SETTINGS_LINE_KIND,
  SETTINGS_SECTION_FRAME,
  SettingsLine,
  SettingsSection,
} from "./settings-section.js";

/**
 * settings-section.test.ts -- a headed section is a region its heading
 * names, holding its rows; a section with no heading, or an empty one, draws
 * its rows with no heading and names no region; one with no card is still
 * the region its heading names; and a line in the rows' place says its note,
 * or tells a reader what is still being read.
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

test("a line in the rows' place says its note, and a loading line tells a reader what is being read", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(SettingsSection, {
        title: "Members",
        children: [
          createElement(SettingsLine, { key: "note", children: "Nobody is invited yet." }),
          createElement(SettingsLine, {
            key: "loading",
            kind: SETTINGS_LINE_KIND.LOADING,
            children: "Loading the members",
          }),
        ],
      }),
    ),
  );
  const section = container.querySelector("section");
  expect(section?.textContent).toContain("Nobody is invited yet.");
  expect(section?.querySelector('[role="status"]')?.textContent).toBe("Loading the members");
});
