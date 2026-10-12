// milkdown.ts -- SPIKE: Milkdown (ProseMirror with remark as its Markdown layer), opened on a field's Markdown and read back.

import { defaultValueCtx, Editor, editorViewCtx, rootCtx } from "@milkdown/kit/core";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { getMarkdown } from "@milkdown/kit/utils";

/** SPIKE: an editor on `markdown` in `host`; `edit` types `!` at the end of the first paragraph before reading back. */
export async function milkdownRoundTrip(
  host: HTMLElement,
  markdown: string,
  edit: boolean,
): Promise<string> {
  let changed = "";
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, host);
      ctx.set(defaultValueCtx, markdown);
      ctx.get(listenerCtx).markdownUpdated((_ctx, next) => {
        changed = next;
      });
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(listener)
    .use(clipboard)
    .create();
  if (edit) {
    const view = editor.ctx.get(editorViewCtx);
    let at = -1;
    view.state.doc.descendants((node, pos) => {
      if (at === -1 && node.type.name === "paragraph") at = pos + node.nodeSize - 1;
      return at === -1;
    });
    view.dispatch(view.state.tr.insertText("!", at));
  }
  const out = editor.action(getMarkdown());
  await editor.destroy();
  return changed === "" ? out : out;
}
