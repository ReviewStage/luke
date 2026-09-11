import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
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

test("a single tilde is a character, not strikethrough", () => {
  // Both halves of the one option this build sets on GitHub's dialect: two
  // home-directory paths in one sentence do not strike the words between
  // them, and the doubled tilde agents actually write still does.
  assert.equal(
    render("Copy ~/.ssh/config to ~/backup, ~not struck~"),
    '<div class="markdown"><p>Copy ~/.ssh/config to ~/backup, ~not struck~</p></div>',
  );
});
