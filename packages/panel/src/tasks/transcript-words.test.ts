// @vitest-environment jsdom

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { TranscriptWords } from "./transcript-blocks.js";

/**
 * transcript-words.test.ts -- a transcript's markdown is drawn to the byte
 * as it was recorded, raw HTML among it: what the parser keeps, what the
 * sanitizer drops, and words that only look like a tag. The drawn markup of
 * every sample is held in `transcript-words.golden.json`, which
 * `LUKE_UPDATE_FIXTURES=1` writes, so a change to how the words are parsed,
 * or to when the parser arrives, that moves a byte fails here. Synthetic
 * words.
 */

/** Records the drawings instead of asserting them. `check.sh` never sets it. */
const UPDATE_FIXTURES = process.env.LUKE_UPDATE_FIXTURES === "1";

const GOLDEN = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "transcript-words.golden.json",
);

/** Representative words a transcript draws, by what each sample holds. */
const SAMPLES = {
  prose: "Plain words with *emphasis*, **strength**, `inline code`, and ~~a strike~~.",
  links: "See [the docs](https://example.com/docs), www.example.com, and <https://example.org>.",
  headings: "# One\n\nWords.\n\n## Two\n\n### Three\n\n#### Four",
  lists: "- one\n- two\n  - nested\n\n1. first\n2. second\n\n- [ ] open\n- [x] done",
  table: "| Left | Centre | Right |\n| :--- | :---: | ---: |\n| a | b | c |\n| `d` | **e** | f |",
  code: "```\nplain block\n```\n\n```ts\nconst a = 1;\n```\n\n    indented block",
  quote: "> quoted\n> words\n\n---\n\nAfter a rule.",
  footnote: "A claim.[^1]\n\n[^1]: Its source.",
  image: "Before ![a picture](https://example.com/a.png) after.",
  entities: "Entities: &amp; &lt;div&gt; &copy; and a lone & here.",
  angles: "Generics like Array<string> and Map<K, V>, and a < b > c.",
  inlineHtml: "Press <kbd>Cmd</kbd>+<kbd>K</kbd>, H<sub>2</sub>O, x<sup>2</sup>, a<br>break.",
  blockHtml:
    '<details>\n<summary>More</summary>\n\nHidden **bold** words.\n\n</details>\n\n<div align="center">centred</div>',
  unsafeHtml:
    '<script>alert(1)</script>\n\n<img src="x" onerror="alert(2)">\n\n<iframe src="https://example.com"></iframe>\n\n<a href="javascript:alert(3)" onclick="alert(4)">link</a>',
  brokenHtml: "<div>open\n\nwords </span> and <p>unclosed\n\n<!-- a comment -->\n\nafter",
  htmlInCode: 'Inline `<div>` and:\n\n```html\n<div class="a">b</div>\n```',
  mention: "Ask [@the plan](https://tryluke.dev/acme/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b).",
} as const;

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const roots: Root[] = [];

beforeEach(() => {
  // A fenced block with a language asks main for its colours; refused, it is drawn plain.
  fakeAppBridge({});
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The markup a transcript draws for the words, once whatever it loads has landed. */
async function drawn(text: string): Promise<string> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(createElement(TranscriptWords, { text })));
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  return container.innerHTML;
}

test("a transcript draws every sample of its markdown exactly as recorded", async () => {
  const drawings: Record<string, string> = {};
  for (const [name, text] of Object.entries(SAMPLES)) drawings[name] = await drawn(text);
  const recorded = `${JSON.stringify(drawings, undefined, 2)}\n`;
  if (UPDATE_FIXTURES) {
    await fs.writeFile(GOLDEN, recorded);
    return;
  }
  assert.equal(recorded, await fs.readFile(GOLDEN, "utf8"));
});
