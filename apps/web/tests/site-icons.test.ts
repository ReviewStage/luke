import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
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

/** The manifest's members this site writes and an installing browser reads. */
const WebAppManifest = Schema.Struct({
  name: Schema.String,
  start_url: Schema.String,
  scope: Schema.String,
  display: Schema.String,
  background_color: Schema.String,
  theme_color: Schema.String,
  icons: Schema.Array(
    Schema.Struct({
      src: Schema.String,
      sizes: Schema.String,
      type: Schema.String,
      purpose: Schema.String,
    }),
  ),
});
const decodeManifest = Schema.decodeUnknownSync(Schema.fromJsonString(WebAppManifest));

/** A PNG's width and height, read from its IHDR chunk, which always follows the 8-byte signature. */
function pngSize(path: string): string {
  const png = readFileSync(path);
  assert.equal(png.toString("latin1", 1, 4), "PNG", path);
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
}

test("the web app links a manifest that installs it full screen at /app, with icons the site serves at the sizes they claim", () => {
  const html = readFileSync(join(WEB, "app.html"), "utf8");
  const manifestHref = linksOf(html).find((link) => link.rel === "manifest")?.href ?? "";
  assert.equal(manifestHref, "/manifest.webmanifest");
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes" \/>/u);
  assert.match(html, /<meta name="apple-mobile-web-app-status-bar-style" content="[a-z-]+" \/>/u);

  const manifest = decodeManifest(readFileSync(join(PUBLIC, manifestHref), "utf8"));
  assert.equal(manifest.name, "Luke");
  assert.equal(manifest.start_url, "/app");
  assert.ok(manifest.start_url.startsWith(manifest.scope));
  assert.equal(manifest.display, "standalone");
  // The splash and the installed app's chrome are the page's own light ground.
  const themeColor = /<meta name="theme-color" content="(#[0-9a-f]{6})" \/>/u.exec(html)?.[1];
  assert.equal(manifest.theme_color, themeColor);
  assert.equal(manifest.background_color, themeColor);

  // Chrome asks for a 192 and a 512 to install; Android masks a maskable one to its own shape.
  for (const size of ["192x192", "512x512"]) {
    assert.ok(
      manifest.icons.some((icon) => icon.sizes === size && icon.purpose === "any"),
      size,
    );
  }
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
  for (const icon of manifest.icons) {
    assert.equal(icon.type, "image/png", icon.src);
    assert.equal(pngSize(join(PUBLIC, icon.src)), icon.sizes, icon.src);
  }
});
