// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import { MARKDOWN_LOOK, Markdown, type MarkdownProps, markdownStep } from "./markdown.js";

/**
 * markdown.test.ts -- the one renderer as a place meets it: a note draws its
 * headings as paragraphs, its pictures as their words, and raw HTML as text;
 * a document draws real headings and no root of its own; a step a place
 * hands in draws with the values it was handed, however many places hand
 * the same step; a note follows a new address rewriter; and a task box a
 * reader may tick is named by its item, asks with its item's place, and
 * flips back when the change is not saved. Synthetic words.
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

/** The markup some words draw as. */
function markup(props: MarkdownProps): string {
  return renderToStaticMarkup(createElement(Markdown, props));
}

/** Words drawn into the page, with the root that redraws them. */
function drawn(props: MarkdownProps): { container: HTMLElement; root: Root } {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Markdown, props)));
  return { container, root };
}

/** A step that writes what a function it closes over answers on every paragraph, as a place's drawer would be read. */
function stamp(answer: () => string) {
  return (tree: { children: { type: string; properties?: Record<string, unknown> }[] }) => {
    for (const child of tree.children) {
      if (child.type === "element" && child.properties !== undefined) {
        child.properties.dataStamp = answer();
      }
    }
  };
}

test("a note draws its headings as paragraphs at their level, its pictures as their words, and raw HTML as text", () => {
  const html = markup({
    look: MARKDOWN_LOOK.NOTE,
    words: "## Goal\n\n![a plan](https://example.com/a.png) and <b>bold</b>",
  });
  assert.equal(
    html,
    '<div class="luke-markdown luke-prose"><p class="luke-markdown-heading" data-level="2">Goal</p>\n<p>a plan and &lt;b&gt;bold&lt;/b&gt;</p></div>',
  );
});

test("a document draws real headings and no root of its own", () => {
  const html = markup({ look: MARKDOWN_LOOK.DOCUMENT, words: "## What we collect\n\nWords." });
  assert.equal(html, "<h2>What we collect</h2>\n<p>Words.</p>");
});

test("one step handed by two places draws with each place's own value", () => {
  const first = markup({
    look: MARKDOWN_LOOK.NOTE,
    words: "Words.",
    rehypePlugins: [markdownStep(stamp, () => "first")],
  });
  const second = markup({
    look: MARKDOWN_LOOK.NOTE,
    words: "Words.",
    rehypePlugins: [markdownStep(stamp, () => "second")],
  });
  assert.match(first, /data-stamp="first"/u);
  assert.match(second, /data-stamp="second"/u);
});

test("a note follows a new address rewriter for the same words", () => {
  const words = "[the spec](https://example.com/spec)";
  const { container, root } = drawn({
    look: MARKDOWN_LOOK.NOTE,
    words,
    urlTransform: (url) => url,
  });
  assert.equal(container.querySelector("a")?.getAttribute("href"), "https://example.com/spec");
  act(() =>
    root.render(
      createElement(Markdown, { look: MARKDOWN_LOOK.NOTE, words, urlTransform: () => "" }),
    ),
  );
  assert.equal(container.querySelector("a")?.getAttribute("href"), "");
});

test("a task box is named by its item, asks with its item's place in the words, and flips back when the change is not saved", async () => {
  const asked: number[] = [];
  const words = "Steps:\n\n- [ ] Write the migration\n- [ ] Wire the row";
  const { container } = drawn({
    look: MARKDOWN_LOOK.NOTE,
    words,
    onTask: (at) => {
      asked.push(at);
      return Promise.resolve(false);
    },
  });
  const boxes = [...container.querySelectorAll<HTMLElement>('[role="checkbox"]')];
  assert.deepEqual(
    boxes.map((box) => box.getAttribute("aria-label")),
    ["Write the migration", "Wire the row"],
  );
  const second = boxes[1];
  assert.ok(second !== undefined, "each task item draws a box");
  await act(async () => second.click());
  assert.deepEqual(asked, [words.indexOf("- [ ] Wire")]);
  assert.equal(
    second.getAttribute("aria-checked"),
    "false",
    "a change not saved flips the box back",
  );
});
