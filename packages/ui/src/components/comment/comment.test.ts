// @vitest-environment jsdom

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { Comment } from "./comment.js";

const NOW = new Date(2026, 9, 14, 18, 0).getTime();
const AT = new Date(2026, 9, 14, 16, 0).getTime();

const PICTURE = "https://pictures.example/ada.png";

function drawn(props: Parameters<typeof Comment>[0]): string {
  return renderToStaticMarkup(createElement(Comment, props));
}

function wordsOf(markup: string, className: string): string | undefined {
  const page = new DOMParser().parseFromString(markup, "text/html");
  return page.querySelector(`.${className}`)?.textContent ?? undefined;
}

test("a comment names its writer, says how long ago, and holds its trailing slot and words", () => {
  const markup = drawn({
    author: { name: "Ada Lovelace", id: "user-ada" },
    at: AT,
    now: NOW,
    trailing: createElement("span", { "data-testid": "status" }, "Resolved"),
    children: "Rerunning the spec on WebKit.",
  });
  assert.equal(wordsOf(markup, "ui-comment-name"), "Ada Lovelace");
  assert.equal(wordsOf(markup, "ui-comment-time"), "2h");
  assert.match(markup, new RegExp(`<time[^>]*dateTime="${new Date(AT).toISOString()}"`, "u"));
  assert.equal(wordsOf(markup, "ui-comment-trailing"), "Resolved");
  assert.equal(wordsOf(markup, "ui-comment-body"), "Rerunning the spec on WebKit.");
});

test("with no picture the face stands the writer's letter, said once beside the name", () => {
  const markup = drawn({ author: { name: "Ada Lovelace" }, at: AT, now: NOW });
  assert.equal(wordsOf(markup, "ui-comment-face"), "A");
  assert.doesNotMatch(markup, /<img/u);
  assert.doesNotMatch(markup, /aria-label="Ada Lovelace"/u);
});

test("a glyph a condition left as nothing still leaves the writer's letter on the face", () => {
  for (const glyph of [null, false]) {
    const markup = drawn({ author: { name: "Ada Lovelace", glyph }, at: AT, now: NOW });
    assert.equal(wordsOf(markup, "ui-comment-face"), "A");
  }
});

test("with a picture the face asks for it", () => {
  const markup = drawn({ author: { name: "Ada Lovelace", picture: PICTURE }, at: AT, now: NOW });
  assert.match(markup, new RegExp(`<img[^>]*src="${PICTURE}"`, "u"));
});

test("a name the caller draws as its own ref stands in the name's place", () => {
  const markup = drawn({
    author: { name: "Ada Lovelace" },
    nameRef: createElement("span", { className: "person-chip" }, "Ada"),
    at: AT,
    now: NOW,
  });
  assert.match(markup, /class="person-chip">Ada<\/span>/u);
  assert.equal(wordsOf(markup, "ui-comment-name"), "Ada");
});

test("a draft not yet sent says no time", () => {
  const markup = drawn({ author: { name: "Ada Lovelace" }, children: "Draft" });
  assert.doesNotMatch(markup, /<time/u);
  assert.equal(wordsOf(markup, "ui-comment-time"), undefined);
});
