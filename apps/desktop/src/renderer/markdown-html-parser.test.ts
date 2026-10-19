// @vitest-environment jsdom

import assert from "node:assert/strict";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { rendererRegistry } from "@luke/panel/renderer-runtime";
import { TranscriptWords } from "@luke/panel/tasks/transcript-blocks";
import { markdownHtmlParserLanded } from "@luke/panel/testing/markdown";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { test } from "vitest";

/**
 * markdown-html-parser.test.ts -- a reply drawn before the HTML parser has
 * landed waits for it rather than being drawn without it, and is drawn
 * whole, its raw HTML parsed, the moment it lands. Synthetic words.
 */

test("a reply is drawn only once the parser has landed, its HTML parsed", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const words = createElement(TranscriptWords, { text: "Press <kbd>K</kbd> to search." });
  // Note that the render is synchronous, so nothing the parser's import resolves has run yet.
  act(() =>
    root.render(createElement(RegistryContext.Provider, { value: rendererRegistry }, words)),
  );
  assert.equal(container.textContent, "");
  await act(() => Effect.runPromise(markdownHtmlParserLanded));
  assert.equal(container.querySelector("kbd")?.textContent, "K");
  assert.equal(container.textContent, "Press K to search.");
  act(() => root.unmount());
});
