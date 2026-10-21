// @vitest-environment jsdom
import assert from "node:assert/strict";
import { test } from "vitest";
import { changelogFeed, parseReleases } from "../src/changelog-releases";

const CHANGELOG = [
  "# Changelog",
  "",
  "## 1.1.0 — 2026-10-13",
  "",
  "### The Call tab",
  "",
  "Calls read as one thread, & so on.",
  "",
  "![The Call tab.](apps/web/public/changelog/1.1.0/the-call-tab.png)",
  "",
  "Code with `]]>` in it, a [link](/privacy), and the [Privacy](PRIVACY.md) file.",
  "",
  "## 1.0.0 — 2026-10-01",
  "",
  "### Fixes",
  "",
  "- Fixed a thing",
  "",
].join("\n");

/** The feed as a feed reader parses it: XML, or a parse error that fails the test. */
function parsedFeed(markdown: string): Document {
  const feed = new DOMParser().parseFromString(
    changelogFeed(parseReleases(markdown)),
    "application/xml",
  );
  assert.equal(feed.querySelector("parsererror"), null, "the feed is well-formed XML");
  return feed;
}

test("every release is an item, newest first, linking to its own page and dated by its day", () => {
  const items = Array.from(parsedFeed(CHANGELOG).querySelectorAll("item"));
  assert.deepEqual(
    items.map((item) => [
      item.querySelector("title")?.textContent,
      item.querySelector("link")?.textContent,
      item.querySelector("pubDate")?.textContent,
    ]),
    [
      [
        "Luke 1.1.0: The Call tab",
        "https://tryluke.dev/changelog/1.1.0",
        "Tue, 13 Oct 2026 00:00:00 GMT",
      ],
      ["Luke 1.0.0", "https://tryluke.dev/changelog/1.0.0", "Thu, 01 Oct 2026 00:00:00 GMT"],
    ],
  );
});

test("an item carries the release's whole notes, its screenshots and links at the site's own addresses", () => {
  const description = parsedFeed(CHANGELOG).querySelector("item description")?.textContent ?? "";
  assert.match(description, /Calls read as one thread, &amp; so on\./);
  assert.match(description, /src="https:\/\/tryluke\.dev\/changelog\/1\.1\.0\/the-call-tab\.png"/);
  assert.match(description, /href="https:\/\/tryluke\.dev\/privacy"/);
  assert.match(
    description,
    /href="https:\/\/github\.com\/ReviewStage\/luke\/blob\/main\/PRIVACY\.md"/,
  );
  // The literal CDATA terminator survives the feed's split into adjacent CDATA sections.
  assert.match(description, /<code>\]\]><\/code>/);
});

test("the feed is dated by its newest release, not by when it was built", () => {
  const feed = parsedFeed(CHANGELOG);
  assert.equal(
    feed.querySelector("channel > lastBuildDate")?.textContent,
    "Tue, 13 Oct 2026 00:00:00 GMT",
  );
  assert.equal(feed.querySelector("channel > link")?.textContent, "https://tryluke.dev/changelog");
});

test("reference screenshots stay clickable and lazy on the page and have absolute feed URLs", () => {
  const markdown = [
    "# Changelog",
    "",
    "## 1.0.0 — 2026-10-01",
    "",
    "### Pictures",
    "",
    "![A &quot;quote&quot; & more][shot]",
    "",
    "Read the [policy][policy].",
    "",
    '[shot]: apps/web/public/changelog/1.0.0/shot.png "Full &quot;size&quot;"',
    "[policy]: PRIVACY.md",
    "",
  ].join("\n");
  const [release] = parseReleases(markdown);
  assert.ok(release);
  const page = new DOMParser().parseFromString(release.html, "text/html");
  const description = parsedFeed(markdown).querySelector("item description")?.textContent ?? "";
  assert.match(description, /src="https:\/\/tryluke\.dev\/changelog\/1\.0\.0\/shot\.png"/);
  assert.match(description, /href="https:\/\/tryluke\.dev\/changelog\/1\.0\.0\/shot\.png"/);
  const image = page.querySelector("img");
  assert.ok(image);
  assert.equal(image.getAttribute("src"), "/changelog/1.0.0/shot.png");
  assert.equal(image.getAttribute("alt"), 'A "quote" & more');
  assert.equal(image.getAttribute("title"), 'Full "size"');
  assert.equal(image.getAttribute("loading"), "lazy");
  assert.equal(image.parentElement?.getAttribute("href"), image.getAttribute("src"));
  assert.equal(image.parentElement?.getAttribute("target"), "_blank");
  assert.equal(image.parentElement?.getAttribute("rel"), "noreferrer");
  assert.equal(
    page.querySelector("p:last-child a")?.getAttribute("href"),
    "https://github.com/ReviewStage/luke/blob/main/PRIVACY.md",
  );
});
