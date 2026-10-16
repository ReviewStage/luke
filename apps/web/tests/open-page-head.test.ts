import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

/**
 * What an unfurler shows for a pasted Luke link: the head of the page every
 * Luke link is served (`vercel-services.test.ts` holds the routing), read as
 * Slackbot, iMessage, and X read it, by its Open Graph and Twitter tags. It is
 * the site's own card, the landing page's image under Luke's name, because an
 * unfurler fetches the link signed out and whatever the tags say, anyone
 * holding the link reads.
 */

const WEB = join(import.meta.dirname, "..");

/** A page's `<meta>` tags, by their `name` or `property`, read across however each is wrapped. */
function metaOf(page: string): ReadonlyMap<string, string> {
  const html = readFileSync(join(WEB, page), "utf8");
  return new Map(
    Array.from(
      html.matchAll(/<meta\s+(?:name|property)="([^"]+)"\s+content="([^"]*)"/gu),
      ([, key = "", content = ""]) => [key, content],
    ),
  );
}

const open = metaOf("open.html");
const landing = metaOf("index.html");

test("a pasted Luke link unfurls under Luke's name, and its card leads to the link itself, never the landing page", () => {
  assert.equal(open.get("og:title"), "Luke");
  assert.equal(open.get("twitter:title"), "Luke");
  assert.equal(open.get("og:site_name"), "Luke");
  assert.equal(open.get("og:url"), undefined);
});

test("a pasted Luke link shows the landing page's card, large, on X as everywhere else", () => {
  for (const key of ["og:image", "og:image:width", "og:image:height", "og:image:alt"]) {
    assert.equal(open.get(key), landing.get(key), key);
  }
  assert.equal(open.get("twitter:image"), landing.get("og:image"));
  assert.equal(open.get("twitter:card"), "summary_large_image");
});

test("a pasted Luke link says one line of what Luke is, the same in every tag that carries it", () => {
  const description = open.get("description");
  assert.ok(description !== undefined && description.length > 0);
  assert.equal(open.get("og:description"), description);
  assert.equal(open.get("twitter:description"), description);
});
