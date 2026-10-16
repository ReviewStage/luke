import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

/**
 * Every page the site serves names Luke's icons: the SVG a browser tab takes,
 * the ICO a reader asks for by name at /favicon.ico, and the touch icon iOS
 * and link previews show, each a file the site serves, plus a theme colour
 * for the browser's chrome. A page added without them fails here rather than
 * shipping a blank tab, as the open page a pasted link lands on once did.
 */

const WEB = join(import.meta.dirname, "..");
const PUBLIC = join(WEB, "public");
const BRAND_FAVICON = join(
  WEB,
  "..",
  "..",
  "packages",
  "brand",
  "assets",
  "icon",
  "luke-favicon.svg",
);

const ICONS = [
  { rel: "icon", href: "/favicon.ico" },
  { rel: "icon", href: "/favicon.svg" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
] as const;

const PAGES = readdirSync(WEB).filter((name) => name.endsWith(".html"));

/** Each `<link>` in a page's head, as its `rel` and `href`. */
function linksOf(html: string): readonly { rel: string; href: string }[] {
  const head = html.slice(0, html.indexOf("</head>"));
  return Array.from(head.matchAll(/<link\b[^>]*>/gu), ([tag]) => ({
    rel: /\brel="([^"]*)"/u.exec(tag)?.[1] ?? "",
    href: /\bhref="([^"]*)"/u.exec(tag)?.[1] ?? "",
  }));
}

test("every page links the favicon, the ICO, and the touch icon, and no other icon", () => {
  assert.ok(PAGES.length > 0);
  for (const page of PAGES) {
    const icons = linksOf(readFileSync(join(WEB, page), "utf8")).filter((link) =>
      link.rel.includes("icon"),
    );
    assert.deepEqual(icons, ICONS, page);
  }
});

test("every page names a theme colour for the browser's chrome", () => {
  for (const page of PAGES) {
    const html = readFileSync(join(WEB, page), "utf8");
    assert.match(html, /<meta name="theme-color" content="#[0-9a-f]{6}" \/>/u, page);
  }
});

test("each icon a page links is a file the site serves, the SVG the brand's own", () => {
  for (const { href } of ICONS) assert.ok(existsSync(join(PUBLIC, href)), href);
  assert.equal(
    readFileSync(join(PUBLIC, "favicon.svg"), "utf8"),
    readFileSync(BRAND_FAVICON, "utf8"),
  );
});
