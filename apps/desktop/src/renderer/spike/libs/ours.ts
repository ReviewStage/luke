// ours.ts -- SPIKE: the spike's own mdast bridge, with and without its untouched-block source preservation, for the same comparison.

import { fieldMarkdown } from "../field-markdown";
import { mountFieldEditor } from "../pm-mount";

/** SPIKE: the spike's editor on `markdown`; `edit` types `!` at the end of the first paragraph; `preserve` false re-prints every block. */
export function oursRoundTrip(
  host: HTMLElement,
  markdown: string,
  edit: boolean,
  preserve: boolean,
): string {
  let out = markdown;
  const editor = mountFieldEditor(host, {
    value: { kind: "text", markdown },
    at: undefined,
    label: "x",
    className: "markdown",
    onDraft: (value) => {
      if (value.kind === "text") out = value.markdown ?? "";
    },
    onFinish: () => undefined,
  });
  const { view } = editor;
  if (edit) {
    let at = -1;
    view.state.doc.descendants((node, pos) => {
      if (at === -1 && node.type.name === "paragraph") at = pos + node.nodeSize - 1;
      return at === -1;
    });
    view.dispatch(view.state.tr.insertText("!", at));
  }
  if (!preserve) out = fieldMarkdown(view.state.doc, new Map()) ?? "";
  editor.destroy();
  return out;
}
