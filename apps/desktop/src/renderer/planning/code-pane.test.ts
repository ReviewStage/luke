import assert from "node:assert/strict";
import { CODE_SOURCE, CODE_UNREADABLE, type PlanCode } from "@sidecar/hosted/planning-view";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { CodePane } from "./code-pane";
import { CODE_PANE_EMPTY_LINE, quickOpenMatches, rangeLabel, selectedRef } from "./code-pane-model";

const ignore = () => undefined;

const CODE: PlanCode = {
  source: CODE_SOURCE.LUKE,
  ref: { path: "src/invite.ts", startLine: 11, endLine: 12 },
  firstLine: 10,
  lineCount: 40,
  lines: [
    [{ text: "export", color: "#ff7b72" }, { text: " function accept() {" }],
    [{ text: "  return true;" }],
    [{ text: "}" }],
  ],
};

function paneMarkup(code: PlanCode | undefined): string {
  return renderToStaticMarkup(
    createElement(CodePane, {
      control: { code, onShowCode: ignore, listFiles: () => Promise.resolve([]) },
    }),
  );
}

test("the pane numbers the window's lines from where it starts in the file and lights the lines pointed at", () => {
  const markup = paneMarkup(CODE);

  assert.match(markup, /src\/invite\.ts/u);
  assert.match(markup, /Lines 11–12/u);
  assert.match(markup, />Luke</u);
  const lit = [...markup.matchAll(/data-pointed="true"><button[^>]*>(\d+)</gu)].map(
    (match) => match[1],
  );
  assert.deepEqual(lit, ["11", "12"]);
  assert.match(markup, /<span style="color:#ff7b72">export<\/span>/u);
});

test("a file that drew nothing says why, and an empty pane says what it is for", () => {
  assert.match(
    paneMarkup({
      source: CODE_SOURCE.DEVELOPER,
      ref: { path: ".env" },
      unreadable: CODE_UNREADABLE.REFUSED,
    }),
    /outside the plan&#x27;s folder, or holds secrets/u,
  );
  assert.ok(paneMarkup(undefined).includes(CODE_PANE_EMPTY_LINE.replace("'", "&#x27;")));
});

test("a drag selects its lines in order whichever way it went", () => {
  assert.deepEqual(selectedRef("a.ts", 9, 4), { path: "a.ts", startLine: 4, endLine: 9 });
  assert.equal(rangeLabel({ path: "a.ts", startLine: 4, endLine: 4 }), "Line 4");
  assert.equal(rangeLabel({ path: "a.ts" }), undefined);
});

test("the quick open puts a file named by the query ahead of one that only holds its letters", () => {
  const files = [
    "src/members/invite-email.ts",
    "docs/inventory.md",
    "src/invite.ts",
    "src/routes/index.ts",
  ];

  assert.deepEqual(quickOpenMatches(files, "invite"), [
    "src/invite.ts",
    "src/members/invite-email.ts",
  ]);
  assert.deepEqual(quickOpenMatches(files, "rtix"), ["src/routes/index.ts"]);
  assert.deepEqual(quickOpenMatches(files, "inv"), [
    "src/invite.ts",
    "docs/inventory.md",
    "src/members/invite-email.ts",
  ]);
});
