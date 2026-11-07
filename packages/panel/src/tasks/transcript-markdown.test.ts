// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACT_KIND } from "@repo/host/acts";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { TranscriptWords } from "./transcript-blocks.js";

/**
 * transcript-markdown.test.ts -- a fenced block in a reply still being
 * written: drawn plain while its closing fence has not arrived, and sent to
 * main to be colored once it has, rather than once a word. Synthetic reply.
 */

/** The reply's words before its block, so the block is not the first thing written. */
const LEAD = "Here is the fix for the reader.\n\n```ts\n";

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

test("a block after a reply's first words is colored once its closing fence arrives, and not while it streams", async () => {
  const asked: string[] = [];
  fakeActPort({
    [ACT_KIND.TASKS_COLOR_CODE]: ({ code }) => {
      asked.push(code);
      return Promise.resolve([]);
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const draw = (text: string) =>
    act(() =>
      root.render(
        onRegistry(AtomRegistry.make(), createElement(TranscriptWords, { text, streaming: true })),
      ),
    );
  draw(`${LEAD}const reader = open(`);
  draw(`${LEAD}const reader = open(path);\nreader.`);
  draw(`${LEAD}const reader = open(path);\nreader.close();\n\`\`\`\n\nThat closes it.`);
  await act(() => Promise.resolve());
  assert.deepEqual(asked, ["const reader = open(path);\nreader.close();"]);
});
