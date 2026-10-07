import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { type MarkdownEdit, MarkdownMessage } from "./markdown-message";

function render(words: string, className?: string): string {
  return renderToStaticMarkup(
    createElement(MarkdownMessage, {
      words,
      ...(className === undefined ? undefined : { className }),
    }),
  );
}

test("plain words are one paragraph under the given class", () => {
  assert.equal(
    render("Checkout is ready.", "voice-caption-text"),
    '<div class="markdown voice-caption-text"><p>Checkout is ready.</p></div>',
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

test("a message typed partway is drawn as far as it has reached, its tags closed and the caret at the end", () => {
  const words = "Invite **any member** by email.\n\n- first\n- second";
  const draw = (upTo: number, caret = true) =>
    renderToStaticMarkup(
      createElement(MarkdownMessage, {
        words,
        edit: { hidden: { from: upTo, to: words.length }, caret: caret ? upTo : undefined },
      }),
    );
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

test("a message mid-edit draws the caret where it stands, the words being typed in or erased left out, and a selection marked", () => {
  const words = "Invite **any member** by email.\n\n- first\n- second";
  const draw = (edit: MarkdownEdit) =>
    renderToStaticMarkup(createElement(MarkdownMessage, { words, edit }));
  const caret = '<span class="markdown-caret" aria-hidden="true"></span>';
  const list = "<ul>\n<li>first</li>\n<li>second</li>\n</ul>";
  // A caret in the middle of a paragraph, the words after it still drawn.
  assert.equal(
    draw({ caret: "Invite **any".length }),
    `<div class="markdown"><p>Invite <strong>any${caret} member</strong> by email.</p>\n${list}</div>`,
  );
  // Words hidden in the middle: the emphasis they straddle stays closed, and what follows still draws.
  const hidden = { from: "Invite **any".length, to: words.indexOf(" by") };
  assert.equal(
    draw({ hidden, caret: hidden.from }),
    `<div class="markdown"><p>Invite <strong>any${caret}</strong> by email.</p>\n${list}</div>`,
  );
  // A whole list item hidden is dropped with nothing left of it.
  const item = { from: words.indexOf("\n- second"), to: words.length };
  assert.equal(
    draw({ hidden: item }),
    `<div class="markdown"><p>Invite <strong>any member</strong> by email.</p>\n<ul>\n<li>first</li></ul></div>`,
  );
  // A selection across an emphasis's edge is marked on both sides of it.
  const mark = (text: string) => `<mark class="markdown-selection">${text}</mark>`;
  const selection = { from: "Invite ".length, to: words.indexOf(".") };
  assert.equal(
    draw({ selection, caret: selection.to }),
    `<div class="markdown"><p>Invite <strong>${mark("any member")}</strong>${mark(" by email")}${caret}.</p>\n${list}</div>`,
  );
});

test("a caret in a list item typed only as far as its marker stands inside the item", () => {
  const words = "- first\n- ";
  const caret = '<span class="markdown-caret" aria-hidden="true"></span>';
  assert.equal(
    renderToStaticMarkup(createElement(MarkdownMessage, { words, edit: { caret: words.length } })),
    `<div class="markdown"><ul>\n<li>first</li>\n<li>${caret}</li>\n</ul></div>`,
  );
});
