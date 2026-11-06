// @vitest-environment jsdom

import assert from "node:assert/strict";
import { Effect } from "effect";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { GitHubPictureLink, GitHubWords, TranscriptWords } from "./transcript-blocks.js";

const SUGGESTED_CHANGE_HTML =
  '  <div class="my-2 border rounded-2 js-suggested-changes-blob diff-view js-check-hidden-unicode" id="">\n    <div class="f6 p-2 lh-condensed border-bottom d-flex">\n      <div class="flex-auto flex-items-center color-fg-muted">\n        Suggested change\n      </div>\n    </div>\n    <div itemprop="text" class="blob-wrapper data file rounded-0" style="margin: 0; border: none; overflow-y: visible; overflow-x: auto;">\n      <table class="d-table tab-size mb-0 width-full" data-paste-markdown-skip="">\n          <tbody><tr class="border-0">\n            <td class="blob-num blob-num-deletion text-right border-0 px-2 py-1 lh-default" data-line-number="15"></td>\n            <td class="border-0 px-2 py-1 blob-code-inner blob-code-deletion js-blob-code-deletion blob-code-marker-deletion"><span class="pl-s1 x x-first">describe</span><span class="pl-kos x">(</span><span class="pl-s x">\'proxy-no-page-runtime\'</span><span class="pl-kos x">,</span><span class="x"> </span><span class="pl-kos x">(</span><span class="pl-kos x">)</span><span class="x"> </span><span class="pl-c1 x">=&gt;</span><span class="x"> </span><span class="pl-kos x x-last">{</span></td>\n          </tr>\n          <tr class="border-0">\n            <td class="blob-num blob-num-addition text-right border-0 px-2 py-1 lh-default" data-line-number="15"></td>\n            <td class="border-0 px-2 py-1 blob-code-inner blob-code-addition js-blob-code-addition blob-code-marker-addition"></td>\n          </tr>\n          <tr class="border-0">\n            <td class="blob-num blob-num-addition text-right border-0 px-2 py-1 lh-default" data-line-number="16"></td>\n            <td class="border-0 px-2 py-1 blob-code-inner blob-code-addition js-blob-code-addition blob-code-marker-addition"><span class="pl-c">// This test accesses the filesystem, which is not available in deploy mode</span></td>\n          </tr>\n          <tr class="border-0">\n            <td class="blob-num blob-num-addition text-right border-0 px-2 py-1 lh-default" data-line-number="17"></td>\n            <td class="border-0 px-2 py-1 blob-code-inner blob-code-addition js-blob-code-addition blob-code-marker-addition"><span class="pl-c">// <span class="pl-k">@force</span>-gate !deploy</span></td>\n          </tr>\n          <tr class="border-0">\n            <td class="blob-num blob-num-addition text-right border-0 px-2 py-1 lh-default" data-line-number="18"></td>\n            <td class="border-0 px-2 py-1 blob-code-inner blob-code-addition js-blob-code-addition blob-code-marker-addition"><span class="pl-s1">describe</span><span class="pl-kos">(</span><span class="pl-s">\'proxy-no-page-runtime\'</span><span class="pl-kos">,</span> <span class="pl-kos">(</span><span class="pl-kos">)</span> <span class="pl-c1">=&gt;</span> <span class="pl-kos">{</span></td>\n          </tr>\n      </tbody></table>\n    </div>\n    <div class="js-apply-changes"></div>\n  </div>\n\n';

beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const roots: Root[] = [];

beforeEach(() => {
  fakeAppBridge({});
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function drawn(element: ReactElement): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(withQueryClient(element)));
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  return container;
}

function rowsOf(drawing: HTMLElement): { kind: string | null; text: string | null }[] {
  return [...drawing.querySelectorAll(".ui-code-card-row")].map((row) => ({
    kind: row.getAttribute("data-row"),
    text: row.textContent,
  }));
}

test("GitHub's rendering of a suggested change draws as its removed line over its added ones, marks off, indentation and the empty line kept, under its heading and in no table", async () => {
  const drawing = await drawn(
    createElement(GitHubWords, {
      html: SUGGESTED_CHANGE_HTML,
      picture: (src, alt) => createElement(GitHubPictureLink, { src, alt }),
    }),
  );

  assert.equal(drawing.querySelector("figcaption")?.textContent, "Suggested change");
  assert.equal(drawing.querySelector("table"), null, "GitHub's table is not drawn");
  assert.deepEqual(rowsOf(drawing), [
    { kind: "removed", text: "describe('proxy-no-page-runtime', () => {" },
    { kind: "added", text: "\n" },
    {
      kind: "added",
      text: "// This test accesses the filesystem, which is not available in deploy mode",
    },
    { kind: "added", text: "// @force-gate !deploy" },
    { kind: "added", text: "describe('proxy-no-page-runtime', () => {" },
  ]);
});

test("a suggestion as written holds its new lines alone, every one added, a line that starts with a list's dash among them", async () => {
  const drawing = await drawn(
    createElement(TranscriptWords, { text: "```suggestion\nsteps:\n  - run: pnpm test\n```" }),
  );

  assert.equal(drawing.querySelector("figcaption")?.textContent, "Suggested change");
  assert.deepEqual(rowsOf(drawing), [
    { kind: "added", text: "steps:" },
    { kind: "added", text: "  - run: pnpm test" },
  ]);
});

test("a diff's lines are tinted by their marks, which they keep, a line whose words start with -- or ++ among them, and its file headers and unchanged lines stand untinted", async () => {
  const drawing = await drawn(
    createElement(TranscriptWords, {
      text: "```diff\n--- a/days.ts\n+++ b/days.ts\n const unit = 1;\n-const days = 30;\n+const days = 7;\n---counter;\n+++counter;\n```",
    }),
  );

  assert.deepEqual(rowsOf(drawing), [
    { kind: "context", text: "--- a/days.ts" },
    { kind: "context", text: "+++ b/days.ts" },
    { kind: "context", text: " const unit = 1;" },
    { kind: "removed", text: "-const days = 30;" },
    { kind: "added", text: "+const days = 7;" },
    { kind: "removed", text: "---counter;" },
    { kind: "added", text: "+++counter;" },
  ]);
});
