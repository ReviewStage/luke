import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { MarkdownMessage } from "./markdown-message";

function render(words: string, className?: string, highlight?: readonly string[]): string {
  return renderToStaticMarkup(
    createElement(MarkdownMessage, {
      words,
      ...(className === undefined ? undefined : { className }),
      ...(highlight === undefined ? undefined : { highlight }),
    }),
  );
}

test("a single tilde is a character, not strikethrough", () => {
  // Both halves of the one option this build sets on GitHub's dialect: two
  // home-directory paths in one sentence do not strike the words between
  // them, and the doubled tilde agents actually write still does.
  assert.equal(
    render("Copy ~/.ssh/config to ~/backup, ~not struck~"),
    '<div class="markdown"><p>Copy ~/.ssh/config to ~/backup, ~not struck~</p></div>',
  );
});

test("a search's words are marked where they land, in code as in prose, case-blind, and nothing marks without one", () => {
  assert.equal(
    render("Checkout is ready.", "conversation-words", ["ready"]),
    '<div class="markdown conversation-words"><p>Checkout is <mark class="row-match">ready</mark>.</p></div>',
  );
  assert.equal(
    render("Run `pnpm test` now", undefined, ["test", "run"]),
    '<div class="markdown"><p><mark class="row-match">Run</mark> <code>pnpm <mark class="row-match">test</mark></code> now</p></div>',
  );
  // Two words landing on one stretch read as one mark, the way a session row's do.
  assert.equal(
    render("Checkout", undefined, ["check", "out"]),
    '<div class="markdown"><p><mark class="row-match">Checkout</mark></p></div>',
  );
  assert.equal(
    render("Checkout is ready.", undefined, []),
    '<div class="markdown"><p>Checkout is ready.</p></div>',
  );
  assert.equal(
    render("Checkout is ready.", undefined, ["zeta"]),
    '<div class="markdown"><p>Checkout is ready.</p></div>',
  );
});
