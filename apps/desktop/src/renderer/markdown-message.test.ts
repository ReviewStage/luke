import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownMessage } from "./markdown-message";

function render(words: string, className?: string): string {
  return renderToStaticMarkup(
    createElement(MarkdownMessage, className === undefined ? { words } : { words, className }),
  );
}

test("plain words are one paragraph under the given class", () => {
  assert.equal(
    render("Checkout is ready.", "history-words"),
    '<div class="markdown history-words"><p>Checkout is ready.</p></div>',
  );
  assert.equal(render(""), '<div class="markdown"></div>');
});

test("inline styles draw as their elements", () => {
  const markup = render("Ran **all** tests with `pnpm test`, ~~twice~~ once.");
  assert.match(markup, /<strong>all<\/strong>/);
  assert.match(markup, /<code>pnpm test<\/code>/);
  assert.match(markup, /<del>twice<\/del>/);
});

test("a lone newline joins lines and a blank line separates paragraphs, as GitHub reads them", () => {
  assert.equal(
    render("one\ntwo\n\nthree"),
    '<div class="markdown"><p>one\ntwo</p>\n<p>three</p></div>',
  );
});

test("a link is drawn but is not a control", () => {
  const markup = render("See [the repo](https://example.com) and [run](custom://act).");
  assert.match(
    markup,
    /<span class="markdown-link" title="https:\/\/example.com">the repo<\/span>/,
  );
  assert.doesNotMatch(markup, /<a[\s>]/);
  assert.doesNotMatch(markup, /href=/);
  // The custom scheme never reaches the markup, not even as a title.
  assert.doesNotMatch(markup, /custom:/);
  assert.match(markup, / and run\.<\/p>/);
});

test("a single tilde is a character, not strikethrough", () => {
  assert.equal(
    render("Copy ~/.ssh/config to ~/backup, ~not struck~"),
    '<div class="markdown"><p>Copy ~/.ssh/config to ~/backup, ~not struck~</p></div>',
  );
});

test("raw HTML in the words is escaped, never markup", () => {
  const markup = render("<img src=x onerror=alert(1)> and <b>bold</b>");
  assert.doesNotMatch(markup, /<img/);
  assert.doesNotMatch(markup, /<b>/);
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("a heading is styled, not announced", () => {
  const markup = render("## Summary\n\nDone.");
  assert.match(markup, /<p class="markdown-heading" data-level="2">Summary<\/p>/);
  assert.doesNotMatch(markup, /<h2/);
});

test("fenced code, quotes, lists, tables, and rules compose around the paragraph", () => {
  const markup = render(
    [
      "Results:",
      "",
      "```ts",
      "const a = 1;",
      "```",
      "",
      "> noted",
      "",
      "3. three",
      "4. four",
      "",
      "- [x] done",
      "- [ ] todo",
      "",
      "| a | b |",
      "| :-- | --: |",
      "| 1 | 2 |",
      "",
      "---",
    ].join("\n"),
  );
  assert.match(markup, /<pre><code class="language-ts">const a = 1;\n<\/code><\/pre>/);
  assert.match(markup, /<blockquote>\n<p>noted<\/p>\n<\/blockquote>/);
  assert.match(markup, /<ol start="3">\n<li>three<\/li>\n<li>four<\/li>\n<\/ol>/);
  // The task box is the library's own disabled checkbox: nothing a press can change.
  assert.match(
    markup,
    /<li class="task-list-item"><input type="checkbox" disabled="" checked=""\/> done<\/li>/,
  );
  assert.match(
    markup,
    /<li class="task-list-item"><input type="checkbox" disabled=""\/> todo<\/li>/,
  );
  assert.match(
    markup,
    /<table><thead><tr><th style="text-align:left">a<\/th><th style="text-align:right">b<\/th>/,
  );
  assert.match(markup, /<td style="text-align:left">1<\/td><td style="text-align:right">2<\/td>/);
  assert.match(markup, /<hr\/><\/div>$/);
});
