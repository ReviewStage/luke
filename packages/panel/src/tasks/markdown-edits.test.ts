import assert from "node:assert/strict";
import { test } from "vitest";
import {
  type FieldSelection,
  MARKDOWN_FORMAT,
  type MarkdownEdit,
  type MarkdownFormat,
  markdownEdit,
  suggestionEdit,
} from "./markdown-edits.js";

/**
 * markdown-edits.test.ts -- each formatting press writes what GitHub's own
 * comment toolbar writes: it wraps or prefixes what is selected, writes a
 * placeholder selected where nothing is, takes off what it wrote when
 * pressed again, and a suggestion writes the lines it would change in a
 * fence none of their own backticks can close.
 */

/** A field written as its words with `[` and `]` around what is selected, or `|` at a caret. */
function field(written: string): FieldSelection {
  const caret = written.indexOf("|");
  if (caret !== -1) {
    return {
      value: `${written.slice(0, caret)}${written.slice(caret + 1)}`,
      start: caret,
      end: caret,
    };
  }
  const start = written.indexOf("[");
  const close = written.indexOf("]", start);
  const value = `${written.slice(0, start)}${written.slice(start + 1, close)}${written.slice(close + 1)}`;
  return { value, start, end: close - 1 };
}

/** The field an edit leaves, written the same way. */
function after(before: FieldSelection, edit: MarkdownEdit): string {
  const value = `${before.value.slice(0, edit.from)}${edit.text}${before.value.slice(edit.to)}`;
  if (edit.selectFrom === edit.selectTo) {
    return `${value.slice(0, edit.selectFrom)}|${value.slice(edit.selectFrom)}`;
  }
  return `${value.slice(0, edit.selectFrom)}[${value.slice(edit.selectFrom, edit.selectTo)}]${value.slice(edit.selectTo)}`;
}

/** What a press of `format` leaves of the field written. */
function press(format: MarkdownFormat, written: string): string {
  const before = field(written);
  return after(before, markdownEdit(format, before));
}

test("bold, italic and code wrap what is selected and keep it selected, or write a placeholder selected for typing over", () => {
  assert.equal(press(MARKDOWN_FORMAT.BOLD, "Why [twice]?"), "Why **[twice]**?");
  assert.equal(press(MARKDOWN_FORMAT.ITALIC, "Why [twice]?"), "Why _[twice]_?");
  assert.equal(press(MARKDOWN_FORMAT.CODE, "Call [send()] here"), "Call `[send()]` here");
  assert.equal(press(MARKDOWN_FORMAT.BOLD, "Why |"), "Why **[bold text]**");
});

test("a wrap pressed again takes its marks off, whether they stand around the selection or at its ends", () => {
  assert.equal(press(MARKDOWN_FORMAT.BOLD, "Why **[twice]**?"), "Why [twice]?");
  assert.equal(press(MARKDOWN_FORMAT.BOLD, "Why [**twice**]?"), "Why [twice]?");
  assert.equal(
    press(MARKDOWN_FORMAT.ITALIC, "Why **[twice]**?"),
    "Why **_[twice]_**?",
    "italic inside bold is still a wrap",
  );
});

test("code over more than one line is a fenced block on lines of its own", () => {
  assert.equal(press(MARKDOWN_FORMAT.CODE, "See [a();\nb();]"), "See \n```\n[a();\nb();]\n```");
  assert.equal(
    press(MARKDOWN_FORMAT.CODE, "[a();\nb();\n]after"),
    "```\n[a();\nb();]\n```\nafter",
    "a selection of whole lines leaves the line after it alone",
  );
});

test("code holding backticks of its own is marked with more of them, spaced where it starts or ends with one", () => {
  assert.equal(press(MARKDOWN_FORMAT.CODE, "Use |"), "Use `[code]`");
  const embedded = { value: "a x`y b", start: 2, end: 5 };
  assert.equal(after(embedded, markdownEdit(MARKDOWN_FORMAT.CODE, embedded)), "a ``[x`y]`` b");
  const edge = { value: "`t`", start: 0, end: 3 };
  assert.equal(
    after(edge, markdownEdit(MARKDOWN_FORMAT.CODE, edge)),
    "[t]",
    "a span selected whole comes off",
  );
  const doubled = { value: "``t``", start: 0, end: 5 };
  assert.equal(after(doubled, markdownEdit(MARKDOWN_FORMAT.CODE, doubled)), "``` [``t``] ```");
});

test("a link takes the selection as its words and selects the address to write, or an address selected as where it points", () => {
  assert.equal(press(MARKDOWN_FORMAT.LINK, "See [the docs]"), "See [the docs]([url])");
  assert.equal(press(MARKDOWN_FORMAT.LINK, "See |"), "See [[link text]](url)");
  const bracketed = { value: "look ] here", start: 0, end: 11 };
  assert.equal(
    after(bracketed, markdownEdit(MARKDOWN_FORMAT.LINK, bracketed)),
    "[look \\] here]([url])",
    "a bracket in the words is escaped",
  );
  const slashed = { value: "C:\\", start: 0, end: 3 };
  assert.equal(
    after(slashed, markdownEdit(MARKDOWN_FORMAT.LINK, slashed)),
    "[C:\\\\]([url])",
    "a backslash in the words is escaped, so it cannot escape the closing bracket",
  );
  assert.equal(
    press(MARKDOWN_FORMAT.LINK, "See [https://github.com]"),
    "See [[link text]](https://github.com)",
  );
});

test("a line format prefixes every line the selection touches, numbering a numbered list, and comes off lines that all wear it", () => {
  assert.equal(press(MARKDOWN_FORMAT.BULLETS, "o[ne\ntw]o"), "[- one\n- two]");
  assert.equal(press(MARKDOWN_FORMAT.NUMBERS, "[one\ntwo]"), "[1. one\n2. two]");
  assert.equal(press(MARKDOWN_FORMAT.TASKS, "[one]"), "[- [ ] one]");
  assert.equal(press(MARKDOWN_FORMAT.QUOTE, "Before\nWh|y"), "Before\n> Why|");
  assert.equal(press(MARKDOWN_FORMAT.HEADING, "Notes|"), "### Notes|");
  assert.equal(press(MARKDOWN_FORMAT.BULLETS, "[- one\n- two]"), "[one\ntwo]");
  assert.equal(press(MARKDOWN_FORMAT.TASKS, "- [ ] one|"), "one|");
  assert.equal(
    press(MARKDOWN_FORMAT.BULLETS, "- [ ] one|"),
    "- - [ ] one|",
    "a task is not a bulleted line, so bullets go on rather than off",
  );
});

test("a line format on an empty line writes its placeholder selected", () => {
  assert.equal(press(MARKDOWN_FORMAT.TASKS, "Todo:\n|"), "Todo:\n- [ ] [Task]");
  assert.equal(press(MARKDOWN_FORMAT.HEADING, "|"), "### [Heading]");
});

test("a suggestion writes the lines as they read now after what is selected, on lines of its own, in a fence longer than any run of backticks they hold", () => {
  const before = field("Better as [this]:");
  assert.equal(
    after(before, suggestionEdit(before, "  once();\n  done();")),
    "Better as this:\n```suggestion\n[  once();\n  done();]\n```",
  );
  const empty = field("|");
  assert.equal(
    after(empty, suggestionEdit(empty, "const fence = '```';")),
    "````suggestion\n[const fence = '```';]\n````",
  );
});
