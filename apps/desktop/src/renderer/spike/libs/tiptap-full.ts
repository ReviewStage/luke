// tiptap-full.ts -- SPIKE: TipTap with its official Markdown, task list, table, and image extensions, opened on a field's Markdown and read back.

import { Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

/** SPIKE: an editor on `markdown` in `host`; `edit` types `!` at the end of the first paragraph before reading back. */
export function tiptapRoundTrip(host: HTMLElement, markdown: string, edit: boolean): string {
  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit,
      Markdown,
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit,
      Image,
    ],
    content: markdown,
    contentType: "markdown",
  });
  if (edit) {
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (at === -1 && node.type.name === "paragraph") at = pos + node.nodeSize - 1;
      return at === -1;
    });
    editor.view.dispatch(editor.state.tr.insertText("!", at));
  }
  const out = editor.getMarkdown();
  editor.destroy();
  return out;
}
