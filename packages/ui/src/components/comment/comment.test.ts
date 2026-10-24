// @vitest-environment jsdom

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { Comment } from "./comment.js";

/**
 * comment.test.ts -- a comment names its writer, says how long ago they
 * wrote, holds what the caller puts at its head's end and what they wrote
 * under it; its face stands the writer's letter where no picture is given,
 * and asks for the picture where one is; a draft not yet sent says no time.
 */

/** Oct 14, 2026, 6:00 PM, on the machine's own clock, and a comment two hours before it. */
const NOW = new Date(2026, 9, 14, 18, 0).getTime();
const AT = new Date(2026, 9, 14, 16, 0).getTime();

const PICTURE = "https://pictures.example/ada.png";

/** The comment's markup, as a page would draw it. */
function drawn(props: Parameters<typeof Comment>[0]): string {
  return renderToStaticMarkup(createElement(Comment, props));
}

/** The words of an element of `markup` found by its class, its tags stripped. */
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
  assert.equal(wordsOf(markup, "luke-comment-name"), "Ada Lovelace");
  assert.equal(wordsOf(markup, "luke-comment-time"), "2h");
  assert.match(markup, new RegExp(`<time[^>]*dateTime="${new Date(AT).toISOString()}"`, "u"));
  assert.equal(wordsOf(markup, "luke-comment-trailing"), "Resolved");
  assert.equal(wordsOf(markup, "luke-comment-body"), "Rerunning the spec on WebKit.");
});

test("with no picture the face stands the writer's letter, said once beside the name", () => {
  const markup = drawn({ author: { name: "Ada Lovelace" }, at: AT, now: NOW });
  assert.equal(wordsOf(markup, "luke-comment-face"), "A");
  assert.doesNotMatch(markup, /<img/u);
  assert.doesNotMatch(markup, /aria-label="Ada Lovelace"/u);
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
  assert.equal(wordsOf(markup, "luke-comment-name"), "Ada");
});

test("a draft not yet sent says no time", () => {
  const markup = drawn({ author: { name: "Ada Lovelace" }, children: "Draft" });
  assert.doesNotMatch(markup, /<time/u);
  assert.equal(wordsOf(markup, "luke-comment-time"), undefined);
});
