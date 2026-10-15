import assert from "node:assert/strict";
import { test } from "vitest";
import { linkFace, shortUrl } from "./link-face.js";

/**
 * link-face.test.ts -- a bare address says its host and path, folded past
 * the bound, and a labelled link says its label. Synthetic addresses.
 */

test("an address says its host and path, without its scheme, its www., or its fragment", () => {
  assert.equal(
    shortUrl("https://docs.stripe.com/guides/idempotent_requests"),
    "docs.stripe.com/guides/idempotent_requests",
  );
  assert.equal(
    shortUrl(
      "https://vercel.com/docs/functions/runtimes/node-js#node-js-version-and-supported-features",
    ),
    "vercel.com/docs/functions/runtimes/node-js",
  );
  assert.equal(shortUrl("https://www.example.com/"), "example.com");
});

test("a short query is kept and a long one dropped", () => {
  assert.equal(
    shortUrl("https://news.ycombinator.com/item?id=41234567"),
    "news.ycombinator.com/item?id=41234567",
  );
  assert.equal(
    shortUrl("https://example.com/search?q=a-very-long-query-that-says-a-lot&page=2"),
    "example.com/search",
  );
});

test("past the bound, the middle steps fold and a long last step is cut", () => {
  assert.equal(
    shortUrl(
      "https://www.postgresql.org/docs/current/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY",
    ),
    "postgresql.org/docs/…/sql-createindex.html",
  );
  assert.equal(
    shortUrl(
      "https://developer.apple.com/documentation/avfaudio/avaudiosession/1616503-setpreferredioBufferduration",
    ),
    "developer.apple.com/…/1616503-setpreferredioB…",
  );
});

test("a step is said decoded", () => {
  assert.equal(shortUrl("https://example.com/docs/caf%C3%A9"), "example.com/docs/café");
});

test("an address that is not the web's has no short form", () => {
  assert.equal(shortUrl("file:///Users/someone/notes.md"), undefined);
  assert.equal(shortUrl("mailto:someone@example.com"), undefined);
  assert.equal(shortUrl("https://"), undefined);
});

test("a link whose words are its address says it cut short, however the words spell it", () => {
  const href =
    "https://www.postgresql.org/docs/current/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY";
  const short = { words: "postgresql.org/docs/…/sql-createindex.html", shortened: true };
  assert.deepEqual(linkFace(href, href), short);
  assert.deepEqual(linkFace(href, href.replace("https://", "")), short);
  assert.deepEqual(linkFace("https://example.com/", "https://example.com"), {
    words: "example.com",
    shortened: true,
  });
});

test("a labelled link says its label", () => {
  assert.deepEqual(
    linkFace("https://docs.stripe.com/guides/idempotent_requests", "idempotency guide"),
    {
      words: "idempotency guide",
      shortened: false,
    },
  );
  assert.deepEqual(linkFace("file:///Users/someone/notes.md", "file:///Users/someone/notes.md"), {
    words: "file:///Users/someone/notes.md",
    shortened: false,
  });
});
