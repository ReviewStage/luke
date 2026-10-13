// theme-color.test.ts -- each page's theme-color is the background it draws.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const STYLES = readFileSync(join(WEB, "src/styles.css"), "utf8");

/** The `--background` a top-level rule block in `styles.css` declares. */
function backgroundOf(selector: string): string {
  const block = STYLES.split(`\n${selector} {\n`)[1]?.split("\n}\n")[0];
  const value = block?.match(/--background:\s*(#[0-9a-f]{6});/i)?.[1];
  assert.ok(value, `styles.css declares no --background under ${selector}`);
  return value.toLowerCase();
}

const PAGES = readdirSync(WEB)
  .filter((name) => name.endsWith(".html"))
  .map((name) => ({ name, html: readFileSync(join(WEB, name), "utf8") }))
  .filter(({ html }) => html.includes('name="theme-color"'));

test("a mobile browser's bar is the colour of the page under it", () => {
  // Note that we read both values from their sources, because the bug was a
  // dark bar over a light page that nothing compared.
  assert.ok(PAGES.length > 0);
  for (const { name, html } of PAGES) {
    const dark = /<html[^>]*class="[^"]*\bdark\b/.test(html);
    const meta = html.match(/<meta name="theme-color" content="(#[0-9a-f]{6})"/i)?.[1];
    assert.equal(meta?.toLowerCase(), backgroundOf(dark ? ".dark" : ":root"), name);
  }
});
