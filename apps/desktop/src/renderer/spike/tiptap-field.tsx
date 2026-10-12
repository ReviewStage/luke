// tiptap-field.tsx -- SPIKE: the same in-place field editor on TipTap (StarterKit over ProseMirror), for comparison.

import { Node as TipTapNode } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { keymap } from "prosemirror-keymap";
import { Selection, TextSelection } from "prosemirror-state";
import { useLayoutEffect, useRef } from "react";
import type { FieldSources } from "./field-markdown";
import { type FieldValue, fieldJson, fieldValueOf, PM_FIELD_KIND, sourcesOf } from "./field-value";
import { ruleBackspace, ruleEnter } from "./rule-commands";

/**
 * SPIKE, not production code. TipTap is ProseMirror with an extension API
 * and a React binding on top, so the editor here is the minimal ProseMirror
 * prototype's (`pm-field.tsx`) written as TipTap extensions: StarterKit with
 * its heading and rule line switched off for a text field, a one-list
 * document for the items, and six small nodes for a rule. The Markdown
 * bridge is the same `field-markdown.ts`, since TipTap's node names are what
 * it speaks; `@tiptap/markdown` (which brings `marked`) is measured
 * separately in the spike doc rather than used, because it re-prints the
 * whole field on every save.
 */

const RawBlock = TipTapNode.create({
  name: "rawBlock",
  group: "block",
  atom: true,
  addAttributes: () => ({ source: { default: "" } }),
  renderHTML: ({ node }) => [
    "pre",
    { class: "spike-raw", contenteditable: "false" },
    node.attrs.source,
  ],
});

const ItemsDocument = TipTapNode.create({ name: "doc", topNode: true, content: "bulletList" });

function clause(name: string, label: string) {
  return TipTapNode.create({
    name,
    content: "inline*",
    parseHTML: () => [{ tag: `div[data-clause=${name}]` }],
    renderHTML: () => [
      "div",
      { "data-clause": name, class: "spike-clause" },
      ["strong", { contenteditable: "false" }, label],
      ["span", 0],
    ],
  });
}

const RULE_NODES = [
  TipTapNode.create({ name: "doc", topNode: true, content: "statement examples" }),
  TipTapNode.create({ name: "statement", content: "inline*", renderHTML: () => ["p", 0] }),
  TipTapNode.create({ name: "examples", content: "example*", renderHTML: () => ["ul", 0] }),
  TipTapNode.create({ name: "example", content: "given when then", renderHTML: () => ["li", 0] }),
  clause("given", "Given"),
  clause("when", "When"),
  clause("then", "Then"),
  TipTapNode.create({
    name: "ruleKeys",
    addProseMirrorPlugins: () => [keymap({ Enter: ruleEnter, Backspace: ruleBackspace })],
  }),
];

/** Each kind's extensions. */
function extensionsOf(kind: FieldValue["kind"]) {
  const inlineOnly = {
    heading: false,
    horizontalRule: false,
    blockquote: false,
    codeBlock: false,
    trailingNode: false,
  } as const;
  switch (kind) {
    case PM_FIELD_KIND.TEXT:
      return [
        StarterKit.configure({
          heading: false,
          horizontalRule: false,
          underline: false,
          trailingNode: false,
        }),
        RawBlock,
      ];
    case PM_FIELD_KIND.ITEMS:
      return [
        StarterKit.configure({
          ...inlineOnly,
          document: false,
          orderedList: false,
          underline: false,
        }),
        ItemsDocument,
      ];
    case PM_FIELD_KIND.RULE:
      return [
        StarterKit.configure({
          ...inlineOnly,
          document: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          listKeymap: false,
          underline: false,
        }),
        ...RULE_NODES,
      ];
  }
}

/** One field in TipTap's editor, with the props `pm-field.tsx`'s takes. */
export function TipTapFieldEditor({
  value,
  at,
  label,
  className,
  onDraft,
  onFinish,
}: {
  value: FieldValue;
  at: { readonly x: number; readonly y: number } | undefined;
  label: string;
  className: string;
  onDraft: (value: FieldValue) => void;
  onFinish: () => void;
}): React.JSX.Element {
  const handlers = useRef({ onDraft, onFinish });
  handlers.current = { onDraft, onFinish };
  const opened = useRef(fieldJson(value));
  const sources = useRef<FieldSources>(new Map());
  const editor = useEditor({
    extensions: extensionsOf(value.kind),
    content: opened.current.json as never,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: `${className} spike-editor`,
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Escape" || (event.key === "Enter" && event.metaKey)) {
          handlers.current.onFinish();
          return true;
        }
        return false;
      },
    },
    onCreate: ({ editor: created }) => {
      sources.current = sourcesOf(value.kind, created.state.doc, opened.current.sources);
    },
    onUpdate: ({ editor: updated }) =>
      handlers.current.onDraft(fieldValueOf(value.kind, updated.state.doc, sources.current)),
    onBlur: () => handlers.current.onFinish(),
  });

  useLayoutEffect(() => {
    const view = editor.view;
    const pos = at === undefined ? undefined : view.posAtCoords({ left: at.x, top: at.y });
    const selection =
      pos === undefined || pos === null
        ? Selection.atEnd(view.state.doc)
        : TextSelection.near(view.state.doc.resolve(pos.pos));
    view.dispatch(view.state.tr.setSelection(selection));
    view.focus();
  }, [editor]);

  return <EditorContent editor={editor} className="ph-no-capture spike-editor-host" />;
}
