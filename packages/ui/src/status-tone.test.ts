import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { STATUS_TONE } from "./status-tone.js";

/**
 * Every status tone is coloured once, in `tokens/status-tone.css`: a tone
 * that sheet leaves out would draw every component that wears it in no
 * colour at all.
 */

/** The custom properties `status-tone.css` sets for each `data-tone` it names, comments dropped. */
function toneRules(): Map<string, Set<string>> {
  const source = readFileSync(new URL("./tokens/status-tone.css", import.meta.url), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  return new Map(
    [...source.matchAll(/:where\(\[data-tone="([\w-]+)"\]\)\s*\{([^{}]*)\}/g)].map(
      ([, tone = "", body = ""]) => [
        tone,
        new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map(([, name = ""]) => name)),
      ],
    ),
  );
}

test("every status tone sets its ink and its tint, and the sheet colours no tone the table lacks", () => {
  const rules = toneRules();
  for (const tone of Object.values(STATUS_TONE)) {
    const set = rules.get(tone);
    assert.ok(set, `status-tone.css colours no ${tone}`);
    assert.deepEqual([...set].sort(), ["--luke-tone-ink", "--luke-tone-tint"], tone);
  }
  assert.deepEqual([...rules.keys()].sort(), Object.values(STATUS_TONE).sort());
});
