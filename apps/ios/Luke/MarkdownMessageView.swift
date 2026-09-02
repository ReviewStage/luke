import LukeKit
import SwiftUI

/// A message's words drawn as the Markdown they were written in, the way
/// Notes and Messages draw rich text: system text styles that follow Dynamic
/// Type, `Text`'s own inline rendering for emphasis, code, strikethrough, and
/// tappable links, and the blocks `Text` cannot draw by itself — lists,
/// quotes, fenced code, tables, rules — composed from system parts around it.
/// Every colour is hierarchical off the bubble's foreground, so the same view
/// reads on the agent's card fill and on the developer's accent bubble.
struct MarkdownMessageView: View {
    private let blocks: [MarkdownBlock]

    init(_ text: String) {
        blocks = MarkdownBlock.parse(text)
    }

    var body: some View {
        MarkdownBlocksView(blocks: blocks, spacing: 8)
    }
}

private struct MarkdownBlocksView: View {
    let blocks: [MarkdownBlock]
    let spacing: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                MarkdownBlockView(block: block)
            }
        }
    }
}

private struct MarkdownBlockView: View {
    let block: MarkdownBlock

    var body: some View {
        switch block {
        case .paragraph(let text):
            inlineText(text, font: .subheadline)
        case .heading(let level, let text):
            inlineText(text, font: headingFont(level))
        case .code(_, let code):
            codeBlock(code)
        case .quote(let blocks):
            MarkdownBlocksView(blocks: blocks, spacing: 6)
                .foregroundStyle(.secondary)
                .padding(.leading, 13)
                .overlay(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(.tertiary)
                        .frame(width: 3)
                }
        case .list(let ordered, let items):
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        listMarker(ordered: ordered, item: item)
                            .font(.subheadline)
                            .frame(minWidth: 16, alignment: .trailing)
                        MarkdownBlocksView(blocks: item.blocks, spacing: 4)
                    }
                }
            }
        case .table(let header, let rows):
            table(header: header, rows: rows)
        case .rule:
            Divider()
        }
    }

    /// A task box draws as the checklist glyph Notes uses; every other item
    /// takes its number or a bullet.
    @ViewBuilder
    private func listMarker(ordered: Bool, item: MarkdownListItem) -> some View {
        if let checked = item.checked {
            Image(systemName: checked ? "checkmark.square.fill" : "square")
                .foregroundStyle(checked ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
        } else {
            Text(ordered ? "\(item.ordinal)." : "•")
                .monospacedDigit()
        }
    }

    /// Words with their inline styles, wrapping rather than truncating in a
    /// tight height. `Text` draws a run marked both strong and emphasized as
    /// italic alone, so that pairing is written onto the run as its own font.
    private func inlineText(_ text: AttributedString, font: Font) -> some View {
        var styled = text
        for run in text.runs {
            guard let intent = run.inlinePresentationIntent,
                  intent.contains(.stronglyEmphasized), intent.contains(.emphasized)
            else { continue }
            styled[run.range].font = font.bold().italic()
        }
        return Text(styled)
            .font(font)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// The three sizes a message can afford under a chat title: the top
    /// level a small title, the second a headline, anything deeper the body's
    /// own size given weight alone.
    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title3.weight(.semibold)
        case 2: .headline
        default: .subheadline.weight(.semibold)
        }
    }

    /// Verbatim text in the system's monospaced footnote on a block the
    /// bubble's width, wrapping where it must: a scroll of its own inside a
    /// chat bubble would fight the thread's scroll and the long-press that
    /// selects text, and a wrapped line still reads where a hidden one does
    /// not.
    private func codeBlock(_ code: String) -> some View {
        Text(code)
            .font(.system(.footnote, design: .monospaced))
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
    }

    private func table(header: [AttributedString], rows: [[AttributedString]]) -> some View {
        Grid(alignment: .topLeading, horizontalSpacing: 14, verticalSpacing: 6) {
            if !header.isEmpty {
                GridRow {
                    ForEach(Array(header.enumerated()), id: \.offset) { _, cell in
                        inlineText(cell, font: .subheadline.weight(.semibold))
                    }
                }
                Divider()
            }
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                GridRow {
                    ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                        inlineText(cell, font: .subheadline)
                    }
                }
            }
        }
    }
}
