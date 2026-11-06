// @vitest-environment jsdom

import assert from "node:assert/strict";
import { test } from "vitest";
import { markLineIndents } from "./line-indents.js";

const LINE_INDENT = "--ui-line-indent";

function drawnLines(texts: readonly string[]): HTMLElement {
  const content = document.createElement("div");
  for (const text of texts) {
    const line = document.createElement("div");
    line.setAttribute("data-line", "");
    line.style.setProperty("tab-size", "2");
    line.textContent = text;
    content.append(line);
  }
  return content;
}

test("a line is marked with its indent in columns, tabs to the next stop", () => {
  const content = drawnLines(["    four", "\ttab", " \tspace then tab", "none"]);
  markLineIndents(content);
  const marks = [...content.children].map((line) =>
    (line as HTMLElement).style.getPropertyValue(LINE_INDENT),
  );
  assert.deepEqual(marks, ["4ch", "2ch", "2ch", ""]);
});

test("a line drawn again with no indent loses its mark", () => {
  const content = drawnLines(["  nested"]);
  markLineIndents(content);
  const line = content.firstElementChild as HTMLElement;
  line.textContent = "flush";
  markLineIndents(content);
  assert.equal(line.style.getPropertyValue(LINE_INDENT), "");
});
