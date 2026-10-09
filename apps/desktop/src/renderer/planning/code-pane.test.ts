import assert from "node:assert/strict";
import type { PlanCode } from "@sidecar/hosted/planning-view";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { CodePane } from "./code-pane";
import { rangeLabel } from "./code-pane-model";

const CODE: PlanCode = {
  ref: { path: "src/invite.ts", startLine: 11, endLine: 12 },
  repository: "acme/relay",
  firstLine: 10,
  lineCount: 40,
  lines: [
    [{ text: "export", color: "#ff7b72" }, { text: " function accept() {" }],
    [{ text: "  return true;" }],
    [{ text: "}" }],
  ],
};

function paneMarkup(code: PlanCode): string {
  return renderToStaticMarkup(createElement(CodePane, { code }));
}

test("the pane names the repository and numbers the window's lines from where it starts in the file, lighting the lines pointed at", () => {
  const markup = paneMarkup(CODE);

  // The pane blocks its whole subtree from the recording, a second line behind the text mask.
  assert.match(markup, /^<section class="code-pane ph-no-capture"/u);
  assert.match(markup, /<span class="code-pane-repository">acme\/relay<\/span>/u);
  assert.match(markup, /src\/invite\.ts/u);
  assert.match(markup, /Lines 11–12/u);
  const lit = [
    ...markup.matchAll(/data-pointed="true"><span class="code-line-number">(\d+)</gu),
  ].map((match) => match[1]);
  assert.deepEqual(lit, ["11", "12"]);
  assert.match(markup, /<span style="color:#ff7b72">export<\/span>/u);
});

test("the heading names one line, a range, or nothing for a whole file", () => {
  assert.equal(rangeLabel({ path: "a.ts", startLine: 4, endLine: 4 }), "Line 4");
  assert.equal(rangeLabel({ path: "a.ts", startLine: 4, endLine: 9 }), "Lines 4–9");
  assert.equal(rangeLabel({ path: "a.ts" }), undefined);
});
