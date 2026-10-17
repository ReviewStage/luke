// @vitest-environment jsdom
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { test } from "vitest";
import { PrivacyPage } from "../src/PrivacyPage";

/**
 * The policy as a reader meets it, drawn as the prerender writes it: one
 * title over the page, and each of the policy's sections a region named by
 * its own heading, so a screen reader can move between them.
 */

/** The page as the prerender writes it. */
function drawn(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = renderToString(createElement(PrivacyPage));
  return root;
}

test("the policy is one page under the title Privacy", () => {
  const titles = Array.from(drawn().querySelectorAll("main h1"));
  assert.deepEqual(
    titles.map((title) => title.textContent),
    ["Privacy"],
  );
});

test("each of the policy's sections is a region named by its heading", () => {
  const main = drawn().querySelector("main");
  assert.ok(main !== null);
  const headings = Array.from(main.querySelectorAll("h2"));
  assert.ok(headings.length > 1);
  for (const heading of headings) {
    const region = heading.closest("section");
    assert.ok(region !== null, `${heading.textContent} heads no section`);
    assert.equal(region.getAttribute("aria-labelledby"), heading.id);
    assert.ok(heading.textContent?.trim(), "a section heading says nothing");
  }
});
