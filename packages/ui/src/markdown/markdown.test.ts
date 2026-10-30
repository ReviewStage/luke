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
 * a document draws real headings and no root of its own; a line draws its
 * inline Markdown and its blocks' words as one run with no root; a
 * transcript's line draws its blocks' words on one line; a step a place
 * hands in draws with the values it was handed, however many places hand
 * the same step; a note follows a new address rewriter; a task box a
 * reader may tick is named by its item, asks with its item's place, and
 * flips back when the change is not saved; and one a reader may not tick is
 * the same box, read-only. Synthetic words.
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

test("a line draws its inline Markdown, and its blocks' words as one run, with no root or block of its own", () => {
  const html = markup({
    look: MARKDOWN_LOOK.INLINE,
    words: "Open **Domains**\n\n- add `a.example`\n- [ ] wait\n\n```\nverify\n```",
  });
  assert.equal(
    html,
    "Open <strong>Domains</strong>\n\nadd <code>a.example</code>\n wait\n\n<code>verify\n</code>",
  );
});

test("a transcript's line draws its blocks' words as one paragraph: no other block or break, a fence as its code", () => {
  const { container } = drawn({
    look: MARKDOWN_LOOK.TRANSCRIPT_LINE,
    words: "Open **Domains**  \nnow\n\n- add `a.example`\n- wait\n\n```\nverify\nit\n```",
  });
  assert.equal(container.querySelectorAll("p").length, 1);
  assert.equal(container.querySelector("ul, li, pre, br"), null);
  assert.equal(container.textContent, "Open Domains now add a.example wait verify it");
  assert.deepEqual(
    [...container.querySelectorAll("code")].map((node) => node.textContent),
    ["a.example", "verify it"],
  );
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

test("a task box a reader cannot tick is the shared box, named by its item, ticked as written, and a press leaves it", async () => {
  const { container } = drawn({
    look: MARKDOWN_LOOK.NOTE,
    words: "- [x] Write the migration\n- [ ] Wire the row",
  });
  const boxes = [...container.querySelectorAll<HTMLElement>('[role="checkbox"]')];
  assert.deepEqual(
    boxes.map((box) => [box.getAttribute("aria-label"), box.getAttribute("aria-checked")]),
    [
      ["Write the migration", "true"],
      ["Wire the row", "false"],
    ],
  );
  const first = boxes[0];
  assert.ok(first !== undefined, "each task item draws a box");
  await act(async () => first.click());
  assert.equal(first.getAttribute("aria-checked"), "true", "a press changes nothing");
});
