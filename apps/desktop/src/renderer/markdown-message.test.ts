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

test("a message typed partway is drawn as far as it has reached, its tags closed and the caret at the end", () => {
  const words = "Invite **any member** by email.\n\n- first\n- second";
  const draw = (upTo: number, caret = true) =>
    renderToStaticMarkup(createElement(MarkdownMessage, { words, reveal: { upTo, caret } }));
  const caret = '<span class="markdown-caret" aria-hidden="true"></span>';
  assert.equal(
    draw("Invite **any".length),
    `<div class="markdown"><p>Invite <strong>any${caret}</strong></p></div>`,
  );
  assert.equal(
    draw(words.indexOf("- second") + "- sec".length),
    `<div class="markdown"><p>Invite <strong>any member</strong> by email.</p>\n<ul>\n<li>first</li>\n<li>sec${caret}</li></ul></div>`,
  );
  // A unit the typing has not reached yet is cut without a caret, and one reached to its end is whole.
  assert.equal(draw("Invite ".length, false), '<div class="markdown"><p>Invite </p></div>');
  assert.equal(draw(words.length, false), render(words));
  // A caret waiting at the end of a whole message stands after its last word.
  assert.equal(
    draw(words.length),
    render(words).replace("<li>second</li>", `<li>second${caret}</li>`),
  );
});
