import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The session row's trailing column stacks the age over the app marks. These
 * read the stylesheet and the row's markup as text, the way the settings
 * header tests do, and guard the facts "the marks sit under the age" stands
 * on: the column that stacks them, the markup order that puts the age first,
 * and the width rules that let a long title ellipsize instead of pushing the
 * column off the row.
 */
const css = readFileSync(new URL("./sessions.css", import.meta.url), "utf8");
const markup = readFileSync(
  new URL("../../../../../packages/panel/src/session-row.tsx", import.meta.url),
  "utf8",
);

const rule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
};

test("the trailing column stacks and pins against the title's line", () => {
  const side = rule(".row-side");
  assert.match(side, /flex-direction: column;/);
  // Pinned top-right whatever the copy column's line count, the seat the age
  // held when it stood alone.
  assert.match(side, /align-self: flex-start;/);
  // The marks right-align under the age, flush with the row's right edge.
  assert.match(side, /align-items: flex-end;/);
});

test("the age leads the trailing column and the app marks follow", () => {
  const side = markup.indexOf('className="row-side"');
  assert.notEqual(side, -1);
  const when = markup.indexOf('className="row-when"', side);
  // The shared row owns the ordering while each app owns the interactive
  // application-mark contents it places in this slot.
  const applications = markup.indexOf("{applications}", side);
  assert.notEqual(when, -1);
  assert.notEqual(applications, -1);
  assert.ok(when < applications, "the app marks belong under the age, not above it");
});

test("a narrowing row spends the title, never the trailing column", () => {
  const copy = rule(".row-copy");
  assert.match(copy, /flex: 1;/);
  assert.match(copy, /min-width: 0;/);
  assert.match(rule(".row-side"), /flex: 0 0 auto;/);
});
