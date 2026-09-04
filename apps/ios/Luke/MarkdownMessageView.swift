import LukeKit
import SwiftUI

/// A message's words drawn as the Markdown they were written in, the way
/// Notes and Messages draw rich text: system text styles that follow Dynamic
/// Type, `Text`'s own inline rendering for emphasis, code, strikethrough, and
/// safe web links, and the blocks `Text` cannot draw by itself — lists,
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
        case .table(let header, let alignments, let rows):
            table(header: header, alignments: alignments, rows: rows)
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
            if run.link != nil {
                styled[run.range].underlineStyle = .single
            }
            guard let intent = run.inlinePresentationIntent,
                  intent.contains(.stronglyEmphasized), intent.contains(.emphasized)
            else { continue }
            styled[run.range].font = font.bold().italic()
        }
        return Text(styled)
            .font(font)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// Each Markdown level maps directly to a compact system text style. This
    /// keeps all six levels distinct while still following Dynamic Type on a
    /// phone and the much narrower watch face.
    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title3.weight(.semibold)
        case 2: .headline
        case 3: .subheadline.weight(.semibold)
        case 4: .footnote.weight(.semibold)
        case 5: .caption.weight(.semibold)
        default: .caption2.weight(.semibold)
        }
    }

    /// Verbatim text in the system's monospaced footnote. Code keeps each
    /// source line whole and scrolls only sideways: wrapping a long identifier
    /// makes iOS visibly hyphenate it, which reads as a character the author
    /// never wrote, while a horizontal gesture does not compete with the
    /// thread's vertical scroll.
    private func codeBlock(_ code: String) -> some View {
        ScrollView(.horizontal) {
            Text(code)
                .font(.system(.footnote, design: .monospaced))
                .fixedSize(horizontal: true, vertical: true)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
        }
        .scrollIndicators(.hidden)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
    }

    private func table(
        header: [AttributedString],
        alignments: [MarkdownTableAlignment],
        rows: [[AttributedString]]
    ) -> some View {
        ScrollView(.horizontal) {
            Grid(alignment: .topLeading, horizontalSpacing: 14, verticalSpacing: 6) {
                if !header.isEmpty {
                    GridRow {
                        ForEach(Array(header.enumerated()), id: \.offset) { column, cell in
                            inlineText(cell, font: .subheadline.weight(.semibold))
                                .multilineTextAlignment(textAlignment(for: alignments, column: column))
                                .gridColumnAlignment(columnAlignment(for: alignments, column: column))
                        }
                    }
                    Divider()
                }
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { column, cell in
                            inlineText(cell, font: .subheadline)
                                .multilineTextAlignment(textAlignment(for: alignments, column: column))
                        }
                    }
                }
            }
        }
        .scrollIndicators(.hidden)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func columnAlignment(
        for alignments: [MarkdownTableAlignment],
        column: Int
    ) -> HorizontalAlignment {
        guard alignments.indices.contains(column) else { return .leading }
        return switch alignments[column] {
        case .leading: .leading
        case .center: .center
        case .trailing: .trailing
        }
    }

    private func textAlignment(
        for alignments: [MarkdownTableAlignment],
        column: Int
    ) -> TextAlignment {
        guard alignments.indices.contains(column) else { return .leading }
        return switch alignments[column] {
        case .leading: .leading
        case .center: .center
        case .trailing: .trailing
        }
    }
}
