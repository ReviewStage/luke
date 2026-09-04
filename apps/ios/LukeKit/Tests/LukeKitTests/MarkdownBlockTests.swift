import XCTest

@testable import LukeKit

private func words(_ text: AttributedString) -> String {
    String(text.characters)
}

private func paragraphWords(_ block: MarkdownBlock) -> String? {
    guard case .paragraph(let text) = block else { return nil }
    return words(text)
}

final class MarkdownBlockTests: XCTestCase {
    func testPlainWordsAreOneParagraph() {
        XCTAssertEqual(MarkdownBlock.parse("Fixed the flaky test."), [.paragraph(AttributedString("Fixed the flaky test."))])
    }

    func testBlankMessageHasNoBlocks() {
        XCTAssertEqual(MarkdownBlock.parse(""), [])
        XCTAssertEqual(MarkdownBlock.parse("  \n "), [])
    }

    func testParagraphsSplitOnBlankLinesAndKeepLineBreaks() {
        let blocks = MarkdownBlock.parse("First line\nsecond line\n\nSecond paragraph")
        XCTAssertEqual(blocks.count, 2)
        XCTAssertEqual(paragraphWords(blocks[0]), "First line\nsecond line")
        XCTAssertEqual(paragraphWords(blocks[1]), "Second paragraph")
    }

    func testInlineStylesSurviveWithoutBlockIntent() throws {
        let blocks = MarkdownBlock.parse("Ran **all** tests with `pnpm test` at [the repo](https://example.com).")
        guard case .paragraph(let text) = try XCTUnwrap(blocks.first) else {
            return XCTFail("expected a paragraph, got \(blocks)")
        }
        XCTAssertEqual(words(text), "Ran all tests with pnpm test at the repo.")
        let styles = text.runs.map { run in
            (String(text[run.range].characters), run.inlinePresentationIntent, run.link, run.presentationIntent)
        }
        XCTAssertTrue(styles.allSatisfy { $0.3 == nil })
        XCTAssertEqual(styles.first { $0.0 == "all" }?.1, .stronglyEmphasized)
        XCTAssertEqual(styles.first { $0.0 == "pnpm test" }?.1, .code)
        XCTAssertEqual(styles.first { $0.0 == "the repo" }?.2, URL(string: "https://example.com"))
    }

    func testCustomSchemeLinkDestinationsNeverBecomeControls() throws {
        let blocks = MarkdownBlock.parse("[review this](custom-scheme://run-action)")
        guard case .paragraph(let text) = try XCTUnwrap(blocks.first) else {
            return XCTFail("expected a paragraph, got \(blocks)")
        }
        XCTAssertEqual(words(text), "review this")
        XCTAssertTrue(text.runs.allSatisfy { $0.link == nil })
    }

    func testWebLinkFormsRetainSafeDestinations() throws {
        let source = """
        [Inline](https://example.com)
        [Title](https://example.com "Example")
        <https://example.com>
        [Reference][example]

        [example]: https://example.com
        """
        let blocks = MarkdownBlock.parse(source)
        guard case .paragraph(let text) = try XCTUnwrap(blocks.first) else {
            return XCTFail("expected a paragraph, got \(blocks)")
        }
        XCTAssertEqual(words(text), "Inline\nTitle\nhttps://example.com\nReference")
        XCTAssertEqual(
            text.runs.compactMap(\.link),
            Array(repeating: URL(string: "https://example.com")!, count: 4)
        )
    }

    func testHeadingsCarryAllSixLevels() {
        let blocks = MarkdownBlock.parse("# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six")
        XCTAssertEqual(blocks, [
            .heading(level: 1, AttributedString("One")),
            .heading(level: 2, AttributedString("Two")),
            .heading(level: 3, AttributedString("Three")),
            .heading(level: 4, AttributedString("Four")),
            .heading(level: 5, AttributedString("Five")),
            .heading(level: 6, AttributedString("Six")),
        ])
    }

    func testFencedCodeKeepsLanguageAndDropsTrailingNewline() {
        let blocks = MarkdownBlock.parse("```swift\nlet x = 1\nprint(x)\n```")
        XCTAssertEqual(blocks, [.code(language: "swift", "let x = 1\nprint(x)")])
    }

    func testFencedCodeWithoutLanguageHasNone() {
        XCTAssertEqual(MarkdownBlock.parse("```\nls -la\n```"), [.code(language: nil, "ls -la")])
    }

    func testIndentedCodeBecomesACodeBlock() {
        XCTAssertEqual(
            MarkdownBlock.parse("    let value = 1\n    print(value)"),
            [.code(language: nil, "let value = 1\nprint(value)")]
        )
    }

    func testUnorderedListNestsAnOrderedList() throws {
        let blocks = MarkdownBlock.parse("- one\n- two\n  1. inner a\n  2. inner b")
        guard case .list(let ordered, let items) = try XCTUnwrap(blocks.first) else {
            return XCTFail("expected a list, got \(blocks)")
        }
        XCTAssertFalse(ordered)
        XCTAssertEqual(items.map(\.ordinal), [1, 2])
        XCTAssertEqual(items[0].blocks, [.paragraph(AttributedString("one"))])
        XCTAssertEqual(items[1].blocks.count, 2)
        XCTAssertEqual(paragraphWords(items[1].blocks[0]), "two")
        guard case .list(let innerOrdered, let inner) = items[1].blocks[1] else {
            return XCTFail("expected a nested list, got \(items[1].blocks)")
        }
        XCTAssertTrue(innerOrdered)
        XCTAssertEqual(inner.map(\.ordinal), [1, 2])
        XCTAssertEqual(inner.map { $0.blocks.compactMap(paragraphWords) }, [["inner a"], ["inner b"]])
    }

    func testTaskBoxesLeaveTheWordsAndBecomeChecked() throws {
        let blocks = MarkdownBlock.parse("- [x] Done\n- [ ] **Todo** soon\n- [x]\n- Plain")
        guard case .list(false, let items) = try XCTUnwrap(blocks.first) else {
            return XCTFail("expected a list, got \(blocks)")
        }
        XCTAssertEqual(items.map(\.checked), [true, false, nil, nil])
        XCTAssertEqual(items.map { $0.blocks.compactMap(paragraphWords) }, [["Done"], ["Todo soon"], ["[x]"], ["Plain"]])
        guard case .paragraph(let todo) = items[1].blocks[0] else { return XCTFail("expected words") }
        XCTAssertEqual(todo.runs.first?.inlinePresentationIntent, .stronglyEmphasized)
    }

    func testATaskBoxInsideInlineMarkupIsTheAuthorsOwnWords() throws {
        let blocks = MarkdownBlock.parse("- `[x]` in code\n- **[ ]** in bold\n- [[x]](https://example.com) in a link")
        guard case .list(false, let items) = try XCTUnwrap(blocks.first) else {
            return XCTFail("expected a list, got \(blocks)")
        }
        XCTAssertEqual(items.map(\.checked), [nil, nil, nil])
        XCTAssertEqual(items.map { $0.blocks.compactMap(paragraphWords) }, [["[x] in code"], ["[ ] in bold"], ["[x] in a link"]])
    }

    func testOrderedListKeepsTheSourceNumbering() throws {
        let blocks = MarkdownBlock.parse("3. three\n4. four")
        guard case .list(true, let items) = try XCTUnwrap(blocks.first) else {
            return XCTFail("expected an ordered list, got \(blocks)")
        }
        XCTAssertEqual(items.map(\.ordinal), [3, 4])
    }

    func testBlockQuoteHoldsItsParagraphs() {
        let blocks = MarkdownBlock.parse("> quoted words\n\n> second quote")
        XCTAssertEqual(blocks, [
            .quote([.paragraph(AttributedString("quoted words"))]),
            .quote([.paragraph(AttributedString("second quote"))]),
        ])
    }

    func testTableSplitsHeaderAndRowsByColumn() {
        let blocks = MarkdownBlock.parse("| File | Change |\n|---|---|\n| a.ts | edited |\n| b.ts | added |")
        XCTAssertEqual(blocks, [
            .table(
                header: [AttributedString("File"), AttributedString("Change")],
                alignments: [.leading, .leading],
                rows: [
                    [AttributedString("a.ts"), AttributedString("edited")],
                    [AttributedString("b.ts"), AttributedString("added")],
                ]
            ),
        ])
    }

    func testTableKeepsColumnAlignment() {
        let blocks = MarkdownBlock.parse("| Left | Center | Right |\n|:---|:---:|---:|\n| a | b | c |")
        XCTAssertEqual(blocks, [
            .table(
                header: [AttributedString("Left"), AttributedString("Center"), AttributedString("Right")],
                alignments: [.leading, .center, .trailing],
                rows: [[AttributedString("a"), AttributedString("b"), AttributedString("c")]]
            ),
        ])
    }

    func testTableKeepsAnEscapedPipeInsideCode() throws {
        let blocks = MarkdownBlock.parse("| Expression | Result |\n|---|---|\n| `a \\| b` | pipe |")
        guard case .table(_, _, let rows) = try XCTUnwrap(blocks.first) else {
            return XCTFail("expected a table, got \(blocks)")
        }
        XCTAssertEqual(rows.map { $0.map(words) }, [["a | b", "pipe"]])
        XCTAssertEqual(rows[0][0].runs.first?.inlinePresentationIntent, .code)
    }

    func testUnsupportedExtensionsStayReadableWithoutCustomRenderers() {
        XCTAssertEqual(
            MarkdownBlock.parse("![Image unavailable](https://example.com/image.png)"),
            [.paragraph(AttributedString("Image unavailable"))]
        )
        XCTAssertEqual(
            MarkdownBlock.parse("Here is a note[^1].\n\n[^1]: Footnote body.").compactMap(paragraphWords),
            ["Here is a note[^1].", "[^1]: Footnote body."]
        )
        XCTAssertEqual(
            MarkdownBlock.parse("Term\n: Definition").compactMap(paragraphWords),
            ["Term\n: Definition"]
        )
        XCTAssertEqual(
            MarkdownBlock.parse("<kbd>Ctrl</kbd> <mark>highlighted</mark>").compactMap(paragraphWords),
            ["<kbd>Ctrl</kbd> <mark>highlighted</mark>"]
        )
        XCTAssertEqual(
            MarkdownBlock.parse("Inline $E = mc^2$\n\n$$x^2$$").compactMap(paragraphWords),
            ["Inline $E = mc^2$", "$$x^2$$"]
        )
        XCTAssertEqual(
            MarkdownBlock.parse("H~2~O and X^2^").compactMap(paragraphWords),
            ["H2O and X^2^"]
        )
        XCTAssertEqual(
            MarkdownBlock.parse("```mermaid\ngraph TD\nA --> B\n```"),
            [.code(language: "mermaid", "graph TD\nA --> B")]
        )
    }

    func testThematicBreakIsARule() {
        XCTAssertEqual(MarkdownBlock.parse("above\n\n---\n\nbelow"), [
            .paragraph(AttributedString("above")),
            .rule,
            .paragraph(AttributedString("below")),
        ])
    }

    func testBlocksKeepDocumentOrder() {
        let blocks = MarkdownBlock.parse("## Done\n\nShipped it.\n\n- a\n\n```\nok\n```\n\n> note")
        let kinds = blocks.map { block -> String in
            switch block {
            case .heading: return "heading"
            case .paragraph: return "paragraph"
            case .list: return "list"
            case .code: return "code"
            case .quote: return "quote"
            case .table: return "table"
            case .rule: return "rule"
            }
        }
        XCTAssertEqual(kinds, ["heading", "paragraph", "list", "code", "quote"])
    }
}
