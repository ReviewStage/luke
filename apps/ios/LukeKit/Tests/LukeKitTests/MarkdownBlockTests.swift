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

    func testHeadingsCarryTheirLevel() {
        let blocks = MarkdownBlock.parse("# Summary\n\n### Details")
        XCTAssertEqual(blocks, [
            .heading(level: 1, AttributedString("Summary")),
            .heading(level: 3, AttributedString("Details")),
        ])
    }

    func testFencedCodeKeepsLanguageAndDropsTrailingNewline() {
        let blocks = MarkdownBlock.parse("```swift\nlet x = 1\nprint(x)\n```")
        XCTAssertEqual(blocks, [.code(language: "swift", "let x = 1\nprint(x)")])
    }

    func testFencedCodeWithoutLanguageHasNone() {
        XCTAssertEqual(MarkdownBlock.parse("```\nls -la\n```"), [.code(language: nil, "ls -la")])
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
                rows: [
                    [AttributedString("a.ts"), AttributedString("edited")],
                    [AttributedString("b.ts"), AttributedString("added")],
                ]
            ),
        ])
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
