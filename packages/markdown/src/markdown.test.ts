import assert from "node:assert/strict";
import test from "node:test";
import {
  MARKDOWN_BLOCK_KIND,
  MARKDOWN_INLINE_KIND,
  MARKDOWN_TABLE_ALIGNMENT,
  type MarkdownBlock,
  type MarkdownInline,
  parseMarkdown,
  plainWords,
} from "./markdown.js";

function text(words: string): MarkdownInline {
  return { kind: MARKDOWN_INLINE_KIND.TEXT, text: words };
}

function paragraph(...inlines: MarkdownInline[]): MarkdownBlock {
  return { kind: MARKDOWN_BLOCK_KIND.PARAGRAPH, inlines };
}

function paragraphWords(block: MarkdownBlock | undefined): string | undefined {
  return block?.kind === MARKDOWN_BLOCK_KIND.PARAGRAPH ? plainWords(block.inlines) : undefined;
}

function onlyList(blocks: MarkdownBlock[]) {
  const [list] = blocks;
  assert.equal(blocks.length, 1);
  assert.ok(
    list?.kind === MARKDOWN_BLOCK_KIND.LIST,
    `expected a list, got ${JSON.stringify(blocks)}`,
  );
  return list;
}

function onlyParagraph(blocks: MarkdownBlock[]): MarkdownInline[] {
  const [block] = blocks;
  assert.equal(blocks.length, 1);
  assert.ok(
    block?.kind === MARKDOWN_BLOCK_KIND.PARAGRAPH,
    `expected a paragraph, got ${JSON.stringify(blocks)}`,
  );
  return block.inlines;
}

test("plain words are one paragraph", () => {
  assert.deepEqual(parseMarkdown("Fixed the flaky test."), [
    paragraph(text("Fixed the flaky test.")),
  ]);
});

test("a blank message has no blocks", () => {
  assert.deepEqual(parseMarkdown(""), []);
  assert.deepEqual(parseMarkdown("  \n "), []);
});

test("paragraphs split on blank lines and keep line breaks", () => {
  const blocks = parseMarkdown("First line\nsecond line\n\nSecond paragraph");
  assert.equal(blocks.length, 2);
  assert.deepEqual(
    blocks[0],
    paragraph(text("First line"), { kind: MARKDOWN_INLINE_KIND.BREAK }, text("second line")),
  );
  assert.equal(paragraphWords(blocks[1]), "Second paragraph");
});

test("inline styles survive inside a paragraph", () => {
  const inlines = onlyParagraph(
    parseMarkdown("Ran **all** tests with `pnpm test` at [the repo](https://example.com)."),
  );
  assert.deepEqual(inlines, [
    text("Ran "),
    { kind: MARKDOWN_INLINE_KIND.STRONG, inlines: [text("all")] },
    text(" tests with "),
    { kind: MARKDOWN_INLINE_KIND.CODE, code: "pnpm test" },
    text(" at "),
    { kind: MARKDOWN_INLINE_KIND.LINK, href: "https://example.com", inlines: [text("the repo")] },
    text("."),
  ]);
  assert.equal(plainWords(inlines), "Ran all tests with pnpm test at the repo.");
});

test("emphasis, strong, nested, and strikethrough all read", () => {
  assert.deepEqual(
    onlyParagraph(parseMarkdown("*one* _two_ ***three*** ~~four~~ **bold *and* italic**")),
    [
      { kind: MARKDOWN_INLINE_KIND.EMPHASIS, inlines: [text("one")] },
      text(" "),
      { kind: MARKDOWN_INLINE_KIND.EMPHASIS, inlines: [text("two")] },
      text(" "),
      {
        kind: MARKDOWN_INLINE_KIND.EMPHASIS,
        inlines: [{ kind: MARKDOWN_INLINE_KIND.STRONG, inlines: [text("three")] }],
      },
      text(" "),
      { kind: MARKDOWN_INLINE_KIND.STRIKETHROUGH, inlines: [text("four")] },
      text(" "),
      {
        kind: MARKDOWN_INLINE_KIND.STRONG,
        inlines: [
          text("bold "),
          { kind: MARKDOWN_INLINE_KIND.EMPHASIS, inlines: [text("and")] },
          text(" italic"),
        ],
      },
    ],
  );
});

test("an underscore inside a word and an unclosed marker stay as written", () => {
  assert.deepEqual(onlyParagraph(parseMarkdown("snake_case_name and 2 * 3 * 4")), [
    text("snake_case_name and 2 * 3 * 4"),
  ]);
  // A reply still streaming has opened its emphasis and not yet closed it.
  assert.deepEqual(onlyParagraph(parseMarkdown("Now **checking the")), [
    text("Now **checking the"),
  ]);
});

test("a single tilde is a character, not strikethrough", () => {
  assert.deepEqual(onlyParagraph(parseMarkdown("Copy ~/.ssh/config to ~/backup, ~not struck~")), [
    text("Copy ~/.ssh/config to ~/backup, ~not struck~"),
  ]);
});

test("backslash escapes read as the character itself", () => {
  assert.deepEqual(onlyParagraph(parseMarkdown("\\*not emphasis\\* and \\`not code\\`")), [
    text("*not emphasis* and `not code`"),
  ]);
});

test("a code span keeps its contents verbatim", () => {
  assert.deepEqual(onlyParagraph(parseMarkdown("Run `` a ` b `` and ` **x** `")), [
    text("Run "),
    { kind: MARKDOWN_INLINE_KIND.CODE, code: "a ` b" },
    text(" and "),
    { kind: MARKDOWN_INLINE_KIND.CODE, code: "**x**" },
  ]);
});

test("custom scheme link destinations never become links", () => {
  assert.deepEqual(onlyParagraph(parseMarkdown("[review this](custom-scheme://run-action)")), [
    text("review this"),
  ]);
  assert.deepEqual(onlyParagraph(parseMarkdown("[run](javascript:alert(1))")), [text("run")]);
});

test("every web link form keeps its destination", () => {
  const source = [
    "[Inline](https://example.com)",
    '[Title](https://example.com "Example")',
    "<https://example.com>",
    "[Reference][example]",
    "[example]",
    "https://example.com.",
    "",
    "[example]: https://example.com",
  ].join("\n");
  const inlines = onlyParagraph(parseMarkdown(source));
  const links = inlines.filter((inline) => inline.kind === MARKDOWN_INLINE_KIND.LINK);
  assert.equal(links.length, 6);
  assert.deepEqual(
    links.map((link) => link.href),
    Array.from({ length: 6 }, () => "https://example.com"),
  );
  assert.equal(
    plainWords(inlines),
    "Inline\nTitle\nhttps://example.com\nReference\nexample\nhttps://example.com.",
  );
});

test("a bare link in parentheses stops at the closing parenthesis", () => {
  assert.deepEqual(onlyParagraph(parseMarkdown("(see https://example.com/a_(b)) now")), [
    text("(see "),
    {
      kind: MARKDOWN_INLINE_KIND.LINK,
      href: "https://example.com/a_(b)",
      inlines: [text("https://example.com/a_(b)")],
    },
    text(") now"),
  ]);
});

test("an image reads as its alternative words", () => {
  assert.deepEqual(onlyParagraph(parseMarkdown("See ![the chart](https://example.com/c.png).")), [
    text("See the chart."),
  ]);
});

test("raw HTML is text", () => {
  assert.deepEqual(onlyParagraph(parseMarkdown("<b>bold</b> <script>x</script>")), [
    text("<b>bold</b> <script>x</script>"),
  ]);
});

test("headings carry all six levels and shed closing hashes", () => {
  assert.deepEqual(
    parseMarkdown("# One\n\n## Two\n### Three\n#### Four ##\n##### Five\n###### Six"),
    [
      { kind: MARKDOWN_BLOCK_KIND.HEADING, level: 1, inlines: [text("One")] },
      { kind: MARKDOWN_BLOCK_KIND.HEADING, level: 2, inlines: [text("Two")] },
      { kind: MARKDOWN_BLOCK_KIND.HEADING, level: 3, inlines: [text("Three")] },
      { kind: MARKDOWN_BLOCK_KIND.HEADING, level: 4, inlines: [text("Four")] },
      { kind: MARKDOWN_BLOCK_KIND.HEADING, level: 5, inlines: [text("Five")] },
      { kind: MARKDOWN_BLOCK_KIND.HEADING, level: 6, inlines: [text("Six")] },
    ],
  );
  assert.deepEqual(parseMarkdown("#hashtag"), [paragraph(text("#hashtag"))]);
});

test("fenced code keeps its language and drops the trailing newline", () => {
  assert.deepEqual(parseMarkdown("```swift\nlet x = 1\nprint(x)\n```"), [
    { kind: MARKDOWN_BLOCK_KIND.CODE, language: "swift", code: "let x = 1\nprint(x)" },
  ]);
  assert.deepEqual(parseMarkdown("```\nls -la\n```"), [
    { kind: MARKDOWN_BLOCK_KIND.CODE, code: "ls -la" },
  ]);
  assert.deepEqual(parseMarkdown("~~~\n**not** emphasis\n~~~"), [
    { kind: MARKDOWN_BLOCK_KIND.CODE, code: "**not** emphasis" },
  ]);
});

test("a fence still open reads as code to the end", () => {
  assert.deepEqual(parseMarkdown("Result:\n\n```ts\nconst a = 1;\nconst b"), [
    paragraph(text("Result:")),
    { kind: MARKDOWN_BLOCK_KIND.CODE, language: "ts", code: "const a = 1;\nconst b" },
  ]);
});

test("indented code becomes a code block", () => {
  assert.deepEqual(parseMarkdown("    let value = 1\n    print(value)"), [
    { kind: MARKDOWN_BLOCK_KIND.CODE, code: "let value = 1\nprint(value)" },
  ]);
  // Inside a paragraph, an indented line is the paragraph continuing.
  assert.equal(paragraphWords(parseMarkdown("words\n    more words")[0]), "words\nmore words");
});

test("a thematic break is a rule", () => {
  assert.deepEqual(parseMarkdown("above\n\n---\n\nbelow\n\n* * *"), [
    paragraph(text("above")),
    { kind: MARKDOWN_BLOCK_KIND.RULE },
    paragraph(text("below")),
    { kind: MARKDOWN_BLOCK_KIND.RULE },
  ]);
});

test("a block quote holds blocks and continues lazily", () => {
  assert.deepEqual(parseMarkdown("> quoted\nstill quoted\n>\n> - item"), [
    {
      kind: MARKDOWN_BLOCK_KIND.QUOTE,
      blocks: [
        paragraph(text("quoted"), { kind: MARKDOWN_INLINE_KIND.BREAK }, text("still quoted")),
        {
          kind: MARKDOWN_BLOCK_KIND.LIST,
          ordered: false,
          items: [{ ordinal: 1, blocks: [paragraph(text("item"))] }],
        },
      ],
    },
  ]);
});

test("an unordered list nests an ordered list", () => {
  const list = onlyList(parseMarkdown("- one\n- two\n  1. inner a\n  2. inner b"));
  assert.equal(list.ordered, false);
  assert.deepEqual(
    list.items.map((item) => item.ordinal),
    [1, 2],
  );
  assert.deepEqual(list.items[0]?.blocks, [paragraph(text("one"))]);
  assert.equal(list.items[1]?.blocks.length, 2);
  assert.equal(paragraphWords(list.items[1]?.blocks[0]), "two");
  const inner = list.items[1]?.blocks[1];
  assert.ok(inner?.kind === MARKDOWN_BLOCK_KIND.LIST);
  assert.equal(inner.ordered, true);
  assert.deepEqual(
    inner.items.map((item) => item.blocks.map(paragraphWords)),
    [["inner a"], ["inner b"]],
  );
});

test("an ordered list counts from its own start", () => {
  const list = onlyList(parseMarkdown("3. three\n4. four\n9. five"));
  assert.equal(list.ordered, true);
  assert.deepEqual(
    list.items.map((item) => item.ordinal),
    [3, 4, 5],
  );
});

test("a list survives blank lines between items and ends at a new paragraph", () => {
  const blocks = parseMarkdown("- one\n\n- two\n  continued\n\nAfter");
  assert.equal(blocks.length, 2);
  const list = blocks[0];
  assert.ok(list?.kind === MARKDOWN_BLOCK_KIND.LIST);
  assert.deepEqual(
    list.items.map((item) => item.blocks.map(paragraphWords)),
    [["one"], ["two\ncontinued"]],
  );
  assert.equal(paragraphWords(blocks[1]), "After");
});

test("a year on its own line does not start a list", () => {
  assert.equal(
    paragraphWords(parseMarkdown("Shipped in\n2024. Then more")[0]),
    "Shipped in\n2024. Then more",
  );
});

test("task boxes leave the words and become checked", () => {
  const list = onlyList(parseMarkdown("- [x] Done\n- [ ] **Todo** soon\n- [x]\n- Plain"));
  assert.deepEqual(
    list.items.map((item) => item.checked),
    [true, false, undefined, undefined],
  );
  assert.deepEqual(
    list.items.map((item) => item.blocks.map(paragraphWords)),
    [["Done"], ["Todo soon"], ["[x]"], ["Plain"]],
  );
  const todo = list.items[1]?.blocks[0];
  assert.ok(todo?.kind === MARKDOWN_BLOCK_KIND.PARAGRAPH);
  assert.equal(todo.inlines[0]?.kind, MARKDOWN_INLINE_KIND.STRONG);
});

test("a task box inside inline markup is the author's own words", () => {
  const list = onlyList(
    parseMarkdown("- `[x]` in code\n- **[ ]** in bold\n- [[x]](https://example.com) in a link"),
  );
  assert.deepEqual(
    list.items.map((item) => item.checked),
    [undefined, undefined, undefined],
  );
  assert.deepEqual(
    list.items.map((item) => item.blocks.map(paragraphWords)),
    [["[x] in code"], ["[ ] in bold"], ["[x] in a link"]],
  );
});

test("a table reads its header, alignments, and rows", () => {
  assert.deepEqual(
    parseMarkdown("| Name | Count | Note |\n| :--- | ---: | :---: |\n| a | 1 | **x** |\n| b | 2 |"),
    [
      {
        kind: MARKDOWN_BLOCK_KIND.TABLE,
        header: [[text("Name")], [text("Count")], [text("Note")]],
        alignments: [
          MARKDOWN_TABLE_ALIGNMENT.LEADING,
          MARKDOWN_TABLE_ALIGNMENT.TRAILING,
          MARKDOWN_TABLE_ALIGNMENT.CENTER,
        ],
        rows: [
          [[text("a")], [text("1")], [{ kind: MARKDOWN_INLINE_KIND.STRONG, inlines: [text("x")] }]],
          [[text("b")], [text("2")], []],
        ],
      },
    ],
  );
});

test("an escaped pipe stays in its cell, inside a code span too", () => {
  const [table] = parseMarkdown("| a | b |\n| - | - |\n| `x \\| y` | c \\| d |");
  assert.ok(table?.kind === MARKDOWN_BLOCK_KIND.TABLE);
  assert.deepEqual(table.rows[0]?.map(plainWords), ["x | y", "c | d"]);
});

test("a line with pipes but no delimiter row is words", () => {
  assert.equal(paragraphWords(parseMarkdown("either | or")[0]), "either | or");
});

test("a reply's own mix reads as it was written", () => {
  const blocks = parseMarkdown(
    [
      "Three sessions need you:",
      "",
      "1. **lisbon-v2** is waiting on a permission prompt",
      "2. `Follow a cloud agent` stopped on an error:",
      "   ```",
      "   ENOENT: no such file",
      "   ```",
      "3. Watch a cloud session finished",
      "",
      "> Want me to open one?",
    ].join("\n"),
  );
  assert.equal(blocks.length, 3);
  const list = blocks[1];
  assert.ok(list?.kind === MARKDOWN_BLOCK_KIND.LIST);
  assert.equal(list.items.length, 3);
  assert.deepEqual(list.items[1]?.blocks[1], {
    kind: MARKDOWN_BLOCK_KIND.CODE,
    code: "ENOENT: no such file",
  });
  assert.equal(blocks[2]?.kind, MARKDOWN_BLOCK_KIND.QUOTE);
});
