// @vitest-environment jsdom

import assert from "node:assert/strict";
import { Effect } from "effect";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { MarkdownField } from "./markdown-field.js";

/**
 * The Markdown field as a member meets it: Write and Preview are tabs over
 * the one panel that shows the words or how they read, named by the tab
 * shown, and the formatting presses stand only while writing.
 */

const roots: Root[] = [];

beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The field over words its own state holds, as an owner holds them. */
function HeldField({ start }: { start: string }): React.JSX.Element {
  const [value, setValue] = useState(start);
  return createElement(MarkdownField, {
    label: "Comment",
    placeholder: "Leave a comment",
    value,
    onChange: setValue,
    busy: false,
  });
}

function mount(start: string): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(HeldField, { start })));
  return container;
}

/** The tab named `label` of the field's mode tabs. */
function tab(field: HTMLElement, label: string): HTMLButtonElement {
  const tabs =
    field.querySelector<HTMLElement>('[role="tablist"][aria-label="Comment view"]') ??
    assert.fail("Write and Preview are tabs");
  const found = [...tabs.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (each) => each.textContent === label,
  );
  return found ?? assert.fail(`no ${label} tab`);
}

/** The panel `label` controls, which must stand and be named by it. */
function panelOf(field: HTMLElement, label: string): HTMLElement {
  const named = tab(field, label);
  const panel =
    document.getElementById(named.getAttribute("aria-controls") ?? "") ??
    assert.fail(`${label} controls no panel`);
  assert.equal(panel.getAttribute("role"), "tabpanel");
  assert.equal(panel.getAttribute("aria-labelledby"), named.id, `the panel is named by ${label}`);
  return panel;
}

function bold(field: HTMLElement): HTMLButtonElement | null {
  return field.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Bold"]');
}

test("Write is the tab shown at first, its panel the words with the formatting presses beside the tabs", () => {
  const field = mount("Looks **good**");

  assert.equal(tab(field, "Write").getAttribute("aria-selected"), "true");
  assert.equal(tab(field, "Preview").getAttribute("aria-selected"), "false");
  assert.equal(panelOf(field, "Write").querySelector("textarea")?.value, "Looks **good**");
  assert.notEqual(bold(field), null);
});

test("Preview shows how the words read in the panel it names, without the formatting presses, and Write brings the words back", async () => {
  const field = mount("Looks **good**");

  await act(async () => tab(field, "Preview").click());

  assert.equal(tab(field, "Preview").getAttribute("aria-selected"), "true");
  const preview = panelOf(field, "Preview");
  assert.equal(preview.querySelector("textarea"), null);
  assert.equal(preview.textContent, "Looks good", "the words read as Markdown, not as written");
  assert.equal(bold(field), null, "the formatting presses stand only while writing");

  act(() => tab(field, "Write").click());

  assert.equal(panelOf(field, "Write").querySelector("textarea")?.value, "Looks **good**");
  assert.notEqual(bold(field), null);
});
