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
    render("Checkout is ready.", "conversation-words"),
    '<div class="markdown conversation-words"><p>Checkout is ready.</p></div>',
  );
  assert.equal(render(""), '<div class="markdown"></div>');
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
  // The task box is the same rule at the one other place words become an
  // element that could be pressed: it is drawn disabled, so nothing in a
  // message is a control.
  assert.match(render("- [ ] todo"), /<input type="checkbox" disabled=""\/>/);
});

test("raw HTML in the words is escaped, never markup", () => {
  const markup = render("<img src=x onerror=alert(1)> and <b>bold</b>");
  assert.doesNotMatch(markup, /<img/);
  assert.doesNotMatch(markup, /<b>/);
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("a single tilde is a character, not strikethrough", () => {
  // Both halves of the one option this build sets on GitHub's dialect: two
  // home-directory paths in one sentence do not strike the words between
  // them, and the doubled tilde agents actually write still does.
  assert.equal(
    render("Copy ~/.ssh/config to ~/backup, ~not struck~"),
    '<div class="markdown"><p>Copy ~/.ssh/config to ~/backup, ~not struck~</p></div>',
  );
  assert.match(render("Ran it ~~twice~~ once."), /<del>twice<\/del>/);
});

test("a heading is styled, not announced", () => {
  // The override this build draws headings through: a reader walking the
  // document's headings should meet the panel's, not a reply's.
  const markup = render("## Summary\n\nDone.");
  assert.match(markup, /<p class="markdown-heading" data-level="2">Summary<\/p>/);
  assert.doesNotMatch(markup, /<h2/);
});
