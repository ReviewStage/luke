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

test("raw HTML in the words is escaped, never markup", () => {
  const markup = render("<img src=x onerror=alert(1)> and <b>bold</b>");
  assert.doesNotMatch(markup, /<img/);
  assert.doesNotMatch(markup, /<b>/);
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
