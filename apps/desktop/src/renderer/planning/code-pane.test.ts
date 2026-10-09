import assert from "node:assert/strict";
import { CODE_UNREADABLE, type PlanCode } from "@sidecar/hosted/planning-view";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { CodePane } from "./code-pane";
import { rangeLabel } from "./code-pane-model";

const CODE: PlanCode = {
  ref: { path: "src/invite.ts", startLine: 11, endLine: 12 },
  firstLine: 10,
  lineCount: 40,
  lines: [
    [{ text: "export", color: "#ff7b72", lightColor: "#cf222e" }, { text: " function accept() {" }],
    [{ text: "  return true;" }],
    [{ text: "}" }],
  ],
};

function paneMarkup(code: PlanCode): string {
  return renderToStaticMarkup(createElement(CodePane, { code }));
}

test("the pane numbers the window's lines from where it starts in the file and lights the lines pointed at", () => {
  const markup = paneMarkup(CODE);

  assert.match(markup, /src\/invite\.ts/u);
  assert.match(markup, /Lines 11–12/u);
  const lit = [
    ...markup.matchAll(/data-pointed="true"><span class="code-line-number">(\d+)</gu),
  ].map((match) => match[1]);
  assert.deepEqual(lit, ["11", "12"]);
});

test("a run carries its colour in both appearances, so the stylesheet picks one as the appearance changes", () => {
  const markup = paneMarkup(CODE);

  assert.match(markup, /<span style="--run-dark:#ff7b72;--run-light:#cf222e">export<\/span>/u);
  assert.match(markup, /<span> function accept\(\) \{<\/span>/u);
});

test("a file that drew nothing says why", () => {
  assert.match(
    paneMarkup({ ref: { path: ".env" }, unreadable: CODE_UNREADABLE.REFUSED }),
    /outside the plan&#x27;s folder, or holds secrets/u,
  );
});

test("the heading names one line, a range, or nothing for a whole file", () => {
  assert.equal(rangeLabel({ path: "a.ts", startLine: 4, endLine: 4 }), "Line 4");
  assert.equal(rangeLabel({ path: "a.ts", startLine: 4, endLine: 9 }), "Lines 4–9");
  assert.equal(rangeLabel({ path: "a.ts" }), undefined);
});
