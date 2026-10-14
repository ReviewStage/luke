import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { withPageHead } from "../src/page-head";

const TEMPLATE = readFileSync(join(import.meta.dirname, "..", "changelog.html"), "utf8");

function metaContent(html: string, key: string): string | undefined {
  return new RegExp(
    `<meta\\s+(?:name|property)="${key.replaceAll(".", "\\.")}"\\s+content="([^"]*)"`,
  ).exec(html)?.[1];
}

test("a route's head replaces the changelog template's title, description, and address", () => {
  const html = withPageHead(
    TEMPLATE,
    {
      title: "Changelog, page 2 — Luke",
      description: "What changed in each Luke release.",
      url: "https://tryluke.dev/changelog/page/2",
      image: undefined,
    },
    undefined,
  );
  assert.match(html, /<title>Changelog, page 2 — Luke<\/title>/);
  assert.equal(metaContent(html, "og:title"), "Changelog, page 2 — Luke");
  assert.equal(metaContent(html, "og:url"), "https://tryluke.dev/changelog/page/2");
  assert.equal(metaContent(html, "og:image"), "https://tryluke.dev/luke-og-card.png");
});

test("a release shares its own screenshot, at its own size, in place of the site's card", () => {
  const html = withPageHead(
    TEMPLATE,
    {
      title: "Luke 0.12.0: The Call tab — Changelog",
      description: 'Calls read as one thread, "quoted" & <kept>.',
      url: "https://tryluke.dev/changelog/0.12.0",
      image: {
        src: "/changelog/0.12.0/the-call-tab.png",
        alt: "The Call tab over the whole window.",
      },
    },
    { width: 2400, height: 1591 },
  );
  assert.equal(
    metaContent(html, "og:image"),
    "https://tryluke.dev/changelog/0.12.0/the-call-tab.png",
  );
  assert.equal(metaContent(html, "og:image:alt"), "The Call tab over the whole window.");
  assert.equal(metaContent(html, "og:image:width"), "2400");
  assert.equal(metaContent(html, "og:image:height"), "1591");
  assert.equal(
    metaContent(html, "description"),
    "Calls read as one thread, &quot;quoted&quot; &amp; &lt;kept&gt;.",
  );
});

test("a template missing a tag the head writes is refused", () => {
  assert.throws(
    () =>
      withPageHead(
        "<html><head><title>x</title></head></html>",
        { title: "t", description: "d", url: "https://tryluke.dev/changelog", image: undefined },
        undefined,
      ),
    /description/,
  );
});
