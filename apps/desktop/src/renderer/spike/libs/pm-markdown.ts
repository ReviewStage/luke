// pm-markdown.ts -- SPIKE: prosemirror-markdown's own parser and serializer (markdown-it, CommonMark), opened on a field's Markdown and read back.

import { defaultMarkdownParser, defaultMarkdownSerializer } from "prosemirror-markdown";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

/** SPIKE: an editor on `markdown` in `host`; `edit` types `!` at the end of the first paragraph before reading back. */
export function pmMarkdownRoundTrip(host: HTMLElement, markdown: string, edit: boolean): string {
  const doc = defaultMarkdownParser.parse(markdown);
  const view = new EditorView(host, { state: EditorState.create({ doc }) });
  if (edit) {
    let at = -1;
    view.state.doc.descendants((node, pos) => {
      if (at === -1 && node.type.name === "paragraph") at = pos + node.nodeSize - 1;
      return at === -1;
    });
    view.dispatch(view.state.tr.insertText("!", at));
  }
  const out = defaultMarkdownSerializer.serialize(view.state.doc);
  view.destroy();
  return out;
}
