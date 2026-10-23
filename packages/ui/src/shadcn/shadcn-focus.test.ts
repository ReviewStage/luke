import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "vitest";

/**
 * shadcn-focus.test.ts -- a vendored shadcn/ui component leaves the keyboard's ring to the window.
 *
 * shadcn's source suppresses the browser's outline and draws a ring of its
 * own (`outline-none`, `focus-visible:ring-*`). The window draws one ring
 * for every control (`@luke/panel`'s base.css) in a layer Tailwind's
 * utilities outrank, so a vendored component that kept either would hide
 * that ring or draw a second, and a keyboard user would lose where focus is.
 */

const SHADCN = new URL("./", import.meta.url);

/** The utilities that would hide the window's ring or draw a ring of their own. */
const RING_UTILITY = /(?:^|[\s"'`])(?:[\w-]+:)*(?:outline-none|outline-hidden|ring-\d|ring-ring)\b/;

test("no vendored shadcn component hides the window's focus ring or draws its own", () => {
  const sources = readdirSync(SHADCN).filter((name) => name.endsWith(".tsx"));
  assert.ok(sources.length > 0, "the shadcn folder holds components");
  for (const name of sources) {
    const source = readFileSync(new URL(name, SHADCN), "utf8");
    const found = RING_UTILITY.exec(source)?.[0]?.trim();
    assert.equal(found, undefined, `${name} spells ${found ?? ""}`);
  }
});
