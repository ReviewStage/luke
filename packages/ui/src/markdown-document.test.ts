// @vitest-environment jsdom
/** markdown-document.test.ts -- the formatting and links a reader sees in trusted documents. */

import assert from "node:assert/strict";
import { test } from "vitest";
import {
  markdownHtml,
  markdownSections,
  markdownText,
  parseMarkdown,
} from "./markdown-document.js";

function rendered(markdown: string): Document {
  return new DOMParser().parseFromString(markdownHtml(parseMarkdown(markdown)), "text/html");
}

test("documents keep GFM tables, task lists, deletion, and autolinks", () => {
  const page = rendered(
    [
      "| Feature | Status |",
      "| --- | --- |",
      "| Tables | Ready |",
      "",
      "- [x] Done",
      "- [ ] Pending",
      "",
      "~~Old~~ and https://example.com.",
    ].join("\n"),
  );
  assert.equal(page.querySelector("th")?.textContent, "Feature");
  assert.equal(page.querySelector("td")?.textContent, "Tables");
  assert.deepEqual(
    Array.from(page.querySelectorAll("input")).map((input) => [input.checked, input.disabled]),
    [
      [true, true],
      [false, true],
    ],
  );
  assert.equal(page.querySelector("del")?.textContent, "Old");
  assert.equal(page.querySelector("a")?.getAttribute("href"), "https://example.com");
});

test("trusted HTML stays HTML while code stays literal text", () => {
  const page = rendered(
    "<details><summary>More</summary>Details</details>\n\n`<script>no()</script> & ]]>`",
  );
  assert.equal(page.querySelector("summary")?.textContent, "More");
  assert.equal(page.querySelector("code")?.textContent, "<script>no()</script> & ]]>");
  assert.equal(page.querySelector("script"), null);
});

test("reference links and image titles decode without becoming new attributes", () => {
  const page = rendered(
    '[Policy][policy]\n\n![A &quot;quote&quot; & more][shot]\n\n[policy]: /privacy "Privacy & details"\n[shot]: /shot.png "A &quot;title&quot;"',
  );
  assert.equal(page.querySelector("a")?.getAttribute("href"), "/privacy");
  assert.equal(page.querySelector("img")?.getAttribute("alt"), 'A "quote" & more');
  assert.equal(page.querySelector("img")?.getAttribute("title"), 'A "title"');
});

test("share-card text keeps emphasis, links, escapes, and code but not image descriptions", () => {
  const tree = parseMarkdown(
    "**Bold** [link](/x) `code` &amp; \\*literal\\* ![not words](/image.png)",
  );
  assert.equal(markdownText(tree).trim(), "Bold link code & *literal*");
});

test("sectioned documents keep inline heading punctuation without adding spaces", () => {
  const policy = markdownSections("# **Privacy**.\n\nOpening.\n\n## A[link](/privacy).\n\nBody.");
  const page = new DOMParser().parseFromString(
    `<h1>${policy.title}</h1><h2>${policy.sections[1]?.title}</h2>`,
    "text/html",
  );
  assert.equal(page.querySelector("h1")?.textContent, "Privacy.");
  assert.equal(page.querySelector("h2")?.textContent, "Alink.");
  assert.equal(page.querySelector("h2 a")?.getAttribute("href"), "/privacy");
  assert.equal(policy.sections[0]?.title, null);
  assert.match(policy.sections[0]?.html ?? "", /<p>Opening\.<\/p>/);
});

test("sectioned documents resolve nested references across headings with the first definition winning", () => {
  const policy = markdownSections(
    [
      "# Policy",
      "",
      "## First",
      "",
      "Read our [policy].",
      "",
      "## Second",
      "",
      "> [policy]: /privacy",
      "",
      "[policy]: /wrong",
      "",
    ].join("\n"),
  );
  const page = new DOMParser().parseFromString(policy.sections[0]?.html ?? "", "text/html");
  assert.equal(page.querySelector("a")?.getAttribute("href"), "/privacy");
  assert.equal(policy.sections[0]?.title, "First");
});
