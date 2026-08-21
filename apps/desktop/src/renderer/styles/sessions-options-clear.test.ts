import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * While a selection stands, the options control wears an X on its right that
 * clears every chosen chip. These read the stylesheet and the control's markup
 * as text, the way the row-side tests do, and guard the facts that seat stands
 * on: the X is a sibling rather than a nested button, it sits on the right of
 * the pill, and pressing it is the same empty selection the chips already know.
 */
const css = readFileSync(new URL("./sessions.css", import.meta.url), "utf8");
const parts = readFileSync(new URL("../session-parts.tsx", import.meta.url), "utf8");
const body = readFileSync(new URL("../panel-body.tsx", import.meta.url), "utf8");

const rule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
};

test("the X sits on the right of the options pill, as a sibling", () => {
  const control = parts.indexOf('className="options-control"');
  const toggle = parts.indexOf('className="options-button"', control);
  const clear = parts.indexOf('className="options-clear"', toggle);
  assert.notEqual(control, -1);
  assert.notEqual(toggle, -1);
  assert.notEqual(clear, -1);
  assert.ok(toggle < clear, "the X belongs on the right of the filter names, not before them");
  // Nested buttons are invalid HTML and would make a press on the X also
  // toggle the sheet. The X has to be a sibling inside the wrapper.
  const toggleClose = parts.indexOf("</button>", toggle);
  assert.ok(toggleClose < clear, "the X is not nested inside the toggle");
});

test("the X is offered only while a selection stands, and names the clear", () => {
  const clear = parts.indexOf('className="options-clear"');
  const guarded = parts.lastIndexOf("{narrowed ?", clear);
  assert.notEqual(clear, -1);
  assert.notEqual(guarded, -1);
  assert.match(parts.slice(clear), /aria-label="Clear filters"/);
});

test("clearing the control drops every chosen chip", () => {
  assert.match(body, /onClear=\{\(\) => onFiltersChange\(\[\]\)\}/);
});

test("the narrowed pill is the wrapper, so the X can sit inside it", () => {
  assert.match(rule(".options-control"), /display: inline-flex;/);
  assert.match(rule(".options-control"), /align-items: center;/);
  const pill = rule('.options-control[data-narrowed="true"]');
  assert.match(pill, /background: var\(--raised\);/);
  assert.match(pill, /border-radius: 10px;/);
});

test("the X is a disc that must not grow inside the pill", () => {
  const clear = rule(".options-clear");
  assert.match(clear, /width: 20px;/);
  assert.match(clear, /height: 20px;/);
  assert.match(clear, /padding: 0;/);
  assert.match(clear, /flex: 0 0 auto;/);
  assert.match(clear, /margin-right: 4px;/);
});
