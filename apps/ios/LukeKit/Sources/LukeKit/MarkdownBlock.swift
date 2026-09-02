import Foundation

/// One block of a message read as Markdown, in the shape a chat draws it:
/// the words of a paragraph or heading with their inline styles kept, a code
/// block's verbatim text, and the containers (quote, list, table) holding the
/// blocks inside them. The parser is Foundation's own, so a message reads on
/// this platform exactly as the system's Markdown does everywhere else on it,
/// and what this type adds is only the block structure that `AttributedString`
/// carries as presentation intents but `Text` cannot draw by itself.
public indirect enum MarkdownBlock: Equatable, Sendable {
    case paragraph(AttributedString)
    case heading(level: Int, AttributedString)
    case code(language: String?, String)
    case quote([MarkdownBlock])
    case list(ordered: Bool, items: [MarkdownListItem])
    case table(
        header: [AttributedString],
        alignments: [MarkdownTableAlignment],
        rows: [[AttributedString]]
    )
    case rule
}

public enum MarkdownTableAlignment: Equatable, Sendable {
    case leading
    case center
    case trailing
}

public struct MarkdownListItem: Equatable, Sendable {
    /// The number a list item counts as, from the source's own numbering.
    public let ordinal: Int
    /// Whether the item's task box is ticked, for an item that opened with
    /// one (`[ ]` or `[x]`); nil for an ordinary item. Foundation's parser
    /// reads no task lists, so the box is found in the item's first words.
    public let checked: Bool?
    public let blocks: [MarkdownBlock]

    public init(ordinal: Int, checked: Bool? = nil, blocks: [MarkdownBlock]) {
        self.ordinal = ordinal
        self.checked = checked
        self.blocks = blocks
    }

    /// An item read for the task box GitHub-flavored lists open with: the
    /// box leaves the words and becomes `checked`, and an item without one
    /// is left exactly as it was. The box must be plain words: a `[x]` that
    /// opens inside a code span, emphasis, or link is the author's own text,
    /// and inline markup has already been applied by the time it is read.
    static func readingTaskBox(ordinal: Int, blocks: [MarkdownBlock]) -> MarkdownListItem {
        guard
            case .paragraph(let words)? = blocks.first,
            let openingRun = words.runs.first,
            openingRun.inlinePresentationIntent == nil,
            openingRun.link == nil,
            words.characters.distance(from: openingRun.range.lowerBound, to: openingRun.range.upperBound) >= 4
        else {
            return MarkdownListItem(ordinal: ordinal, blocks: blocks)
        }
        let opening = String(words.characters.prefix(4))
        let checked: Bool
        switch opening {
        case "[ ] ": checked = false
        case "[x] ", "[X] ": checked = true
        default: return MarkdownListItem(ordinal: ordinal, blocks: blocks)
        }
        var rest = words
        rest.removeSubrange(rest.startIndex ..< rest.characters.index(rest.startIndex, offsetBy: 4))
        return MarkdownListItem(
            ordinal: ordinal,
            checked: checked,
            blocks: [.paragraph(rest)] + blocks.dropFirst()
        )
    }
}

extension MarkdownBlock {
    /// A message's words as the blocks that draw them. Whatever the parser
    /// cannot read as Markdown still reads as the words themselves, so a
    /// message never draws less than the plain text it started as; only an
    /// entirely blank message yields no blocks at all.
    public static func parse(_ text: String) -> [MarkdownBlock] {
        let options = AttributedString.MarkdownParsingOptions(
            allowsExtendedAttributes: false,
            interpretedSyntax: .full,
            failurePolicy: .returnPartiallyParsedIfPossible
        )
        guard let parsed = try? AttributedString(markdown: text, options: options) else {
            return fallback(text)
        }
        let root = BlockNode(kind: .paragraph, identity: 0)
        for run in parsed.runs {
            let path = (run.presentationIntent?.components ?? []).reversed()
            var node = root
            for component in path {
                node = node.child(kind: component.kind, identity: component.identity)
            }
            node.text.append(inlinePiece(String(parsed[run.range].characters), run: run))
        }
        let blocks = root.children.flatMap { $0.blocks() }
        return blocks.isEmpty ? fallback(text) : blocks
    }

    private static func fallback(_ text: String) -> [MarkdownBlock] {
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return words.isEmpty ? [] : [.paragraph(AttributedString(words))]
    }

    /// A run's words carrying only what `Text` draws inline, emphasis and
    /// links: the block intent is now the enum case around them, and the
    /// parser's other bookkeeping (a list item's delimiter) is nothing a
    /// bubble draws. A line break in the source is kept as one line break: a
    /// message is a chat's words, where a new line means a new line, not a
    /// manuscript whose soft breaks a typesetter joins.
    private static func inlinePiece(_ words: String, run: AttributedString.Runs.Run) -> AttributedString {
        if let intent = run.inlinePresentationIntent, intent.contains(.softBreak) || intent.contains(.lineBreak) {
            return AttributedString("\n")
        }
        var piece = AttributedString(words)
        if let intent = run.inlinePresentationIntent { piece.inlinePresentationIntent = intent }
        if let link = run.link { piece.link = link }
        return piece
    }
}

/// The parser's flat runs rebuilt as the tree they describe. Each run names
/// its enclosing blocks innermost first, each with an identity unique to the
/// document, so the same identity seen on consecutive runs is the same block
/// continuing and a new identity is a new block beside it.
private final class BlockNode {
    let kind: PresentationIntent.Kind
    let identity: Int
    var children: [BlockNode] = []
    var text = AttributedString()

    init(kind: PresentationIntent.Kind, identity: Int) {
        self.kind = kind
        self.identity = identity
    }

    func child(kind: PresentationIntent.Kind, identity: Int) -> BlockNode {
        if let existing = children.last, existing.identity == identity {
            return existing
        }
        let node = BlockNode(kind: kind, identity: identity)
        children.append(node)
        return node
    }

    func blocks() -> [MarkdownBlock] {
        switch kind {
        case .paragraph:
            return [.paragraph(text)]
        case .header(let level):
            return [.heading(level: level, text)]
        case .codeBlock(let languageHint):
            let language = languageHint.flatMap { $0.isEmpty ? nil : $0 }
            var code = String(text.characters)
            if code.hasSuffix("\n") { code.removeLast() }
            return [.code(language: language, code)]
        case .thematicBreak:
            return [.rule]
        case .blockQuote:
            return [.quote(children.flatMap { $0.blocks() })]
        case .orderedList, .unorderedList:
            let items = children.compactMap { child -> MarkdownListItem? in
                guard case .listItem(let ordinal) = child.kind else { return nil }
                return MarkdownListItem.readingTaskBox(ordinal: ordinal, blocks: child.blocks())
            }
            return [.list(ordered: kind == .orderedList, items: items)]
        case .table(let columns):
            var header: [AttributedString] = []
            var rows: [[AttributedString]] = []
            for row in children {
                switch row.kind {
                case .tableHeaderRow: header = row.cells()
                case .tableRow: rows.append(row.cells())
                default: break
                }
            }
            let alignments = columns.map { column in
                switch column.alignment {
                case .left: MarkdownTableAlignment.leading
                case .center: MarkdownTableAlignment.center
                case .right: MarkdownTableAlignment.trailing
                @unknown default: MarkdownTableAlignment.leading
                }
            }
            return [.table(header: header, alignments: alignments, rows: rows)]
        case .listItem, .tableHeaderRow, .tableRow, .tableCell:
            return children.flatMap { $0.blocks() }
        @unknown default:
            return children.isEmpty ? [.paragraph(text)] : children.flatMap { $0.blocks() }
        }
    }

    private func cells() -> [AttributedString] {
        children
            .compactMap { child -> (Int, AttributedString)? in
                guard case .tableCell(let column) = child.kind else { return nil }
                return (column, child.text)
            }
            .sorted { $0.0 < $1.0 }
            .map(\.1)
    }
}
