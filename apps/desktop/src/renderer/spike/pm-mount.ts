// pm-mount.ts -- SPIKE: a plan field edited in place on a minimal ProseMirror, drawn exactly as the document draws it; no React, so it can ship as a bundle of its own.

import { baseKeymap, chainCommands, exitCode, toggleMark } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import {
  type MarkSpec,
  type MarkType,
  type NodeSpec,
  type Node as PmNode,
  Schema,
} from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";
import { type Command, EditorState, Selection, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import type { FieldSources } from "./field-markdown";
import {
  type FieldValue,
  fieldJson,
  fieldValueOf,
  PM_FIELD_KIND,
  type PmFieldKind,
  sourcesOf,
} from "./field-value";
import { ruleBackspace, ruleEnter } from "./rule-commands";

/**
 * SPIKE, not production code. One field, one small ProseMirror editor, and
 * no heading inside it: the formatter owns every heading, so the heading is
 * drawn outside the editor by the document as it is today and the template
 * cannot be broken by construction. Each field kind has its own schema:
 *
 * - a text field: paragraphs, lists, code blocks, quotes, and the inline
 *   marks, printed back to Markdown by `field-markdown.ts`;
 * - the open questions and the assumptions: one bullet list, an item a
 *   paragraph, printed back as one item a line;
 * - a rule: its statement, then examples of exactly Given, When, and Then,
 *   whose labels are drawn and never typed, read back as the rule's parts.
 *
 * No document is ever parsed back into fields: each editor reads and writes
 * its one field's stored shape. The editor's DOM wears the read view's own
 * classes (`markdown`, `plan-rule-body`), so swapping the drawn words for the
 * editor moves nothing, and a click's coordinates land the caret where the
 * pointer was (`posAtCoords`).
 */

const MARKS: Record<string, MarkSpec> = {
  link: {
    attrs: { href: {} },
    inclusive: false,
    parseDOM: [{ tag: "a[href]", getAttrs: (dom) => ({ href: dom.getAttribute("href") }) }],
    toDOM: (mark) => ["a", { href: mark.attrs.href, class: "markdown-link" }, 0],
  },
  bold: {
    parseDOM: [{ tag: "strong" }, { tag: "b" }, { style: "font-weight=bold" }],
    toDOM: () => ["strong", 0],
  },
  italic: { parseDOM: [{ tag: "em" }, { tag: "i" }], toDOM: () => ["em", 0] },
  strike: { parseDOM: [{ tag: "del" }, { tag: "s" }], toDOM: () => ["del", 0] },
  code: { excludes: "_", parseDOM: [{ tag: "code" }], toDOM: () => ["code", 0] },
};

const INLINE: Record<string, NodeSpec> = {
  text: { group: "inline" },
  hardBreak: {
    inline: true,
    group: "inline",
    selectable: false,
    parseDOM: [{ tag: "br" }],
    toDOM: () => ["br"],
  },
};

/** A text field: the blocks a field's Markdown may hold, and no heading. A pasted heading lands as a paragraph. */
const textSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      parseDOM: [{ tag: "p" }, { tag: "h1" }, { tag: "h2" }, { tag: "h3" }, { tag: "h4" }],
      toDOM: () => ["p", 0],
    },
    bulletList: {
      group: "block",
      content: "listItem+",
      parseDOM: [{ tag: "ul" }],
      toDOM: () => ["ul", 0],
    },
    orderedList: {
      group: "block",
      content: "listItem+",
      attrs: { start: { default: 1 } },
      parseDOM: [{ tag: "ol" }],
      toDOM: (node) => ["ol", { start: node.attrs.start }, 0],
    },
    listItem: {
      content: "paragraph block*",
      defining: true,
      parseDOM: [{ tag: "li" }],
      toDOM: () => ["li", 0],
    },
    codeBlock: {
      group: "block",
      content: "text*",
      marks: "",
      code: true,
      defining: true,
      attrs: { language: { default: null } },
      parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
      toDOM: () => ["pre", ["code", 0]],
    },
    blockquote: {
      group: "block",
      content: "block+",
      parseDOM: [{ tag: "blockquote" }],
      toDOM: () => ["blockquote", 0],
    },
    // A table, a rule line, or HTML the field already holds: drawn, kept, and not edited here.
    rawBlock: {
      group: "block",
      atom: true,
      selectable: true,
      attrs: { source: {} },
      toDOM: (node) => ["pre", { class: "spike-raw", contenteditable: "false" }, node.attrs.source],
    },
    ...INLINE,
  },
  marks: MARKS,
});

/** The open questions or the assumptions: one bullet list, an item one paragraph. */
const itemsSchema = new Schema({
  nodes: {
    doc: { content: "bulletList" },
    bulletList: { content: "listItem+", parseDOM: [{ tag: "ul" }], toDOM: () => ["ul", 0] },
    listItem: { content: "paragraph", parseDOM: [{ tag: "li" }], toDOM: () => ["li", 0] },
    paragraph: { content: "inline*", parseDOM: [{ tag: "p" }], toDOM: () => ["p", 0] },
    ...INLINE,
  },
  marks: MARKS,
});

/** A clause's node, its label drawn beside the words and never part of them. */
function clause(name: string, label: string): NodeSpec {
  return {
    content: "inline*",
    parseDOM: [{ tag: `div[data-clause=${name}]` }],
    toDOM: () => [
      "div",
      { "data-clause": name, class: "spike-clause" },
      ["strong", { contenteditable: "false" }, label],
      ["span", 0],
    ],
  };
}

/** A rule: its statement, then examples of exactly Given, When, and Then. */
const ruleSchema = new Schema({
  nodes: {
    doc: { content: "statement examples" },
    statement: { content: "inline*", parseDOM: [{ tag: "p" }], toDOM: () => ["p", 0] },
    examples: { content: "example*", parseDOM: [{ tag: "ul" }], toDOM: () => ["ul", 0] },
    example: { content: "given when then", parseDOM: [{ tag: "li" }], toDOM: () => ["li", 0] },
    given: clause("given", "Given"),
    when: clause("when", "When"),
    // biome-ignore lint/suspicious/noThenProperty: `then` is the example's clause name in the fixed template.
    then: clause("then", "Then"), // oxlint-disable-line unicorn/no-thenable -- the same name.
    ...INLINE,
  },
  marks: MARKS,
});

function schemaOf(kind: PmFieldKind): Schema {
  if (kind === PM_FIELD_KIND.ITEMS) return itemsSchema;
  if (kind === PM_FIELD_KIND.RULE) return ruleSchema;
  return textSchema;
}

/** A field's stored value as the editor's document, and the sources a text field prints untouched blocks from. */
function docOf(value: FieldValue): { doc: PmNode; sources: FieldSources } {
  const { json, sources } = fieldJson(value);
  const doc = schemaOf(value.kind).nodeFromJSON(json);
  return { doc, sources: sourcesOf(value.kind, doc, sources) };
}

/** `**words**`, `*words*`, `` `words` ``, and `~~words~~` typed: the words take the mark, the markers go. */
function markRule(pattern: RegExp, type: MarkType): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const words = match[1] ?? "";
    if (words === "") return null;
    // Note that the mark is dropped from what is typed next, because typing on after `**words**` means plain words.
    return state.tr
      .replaceWith(start, end, state.schema.text(words, [type.create()]))
      .removeStoredMark(type);
  });
}

/** `[words](https://…)` typed: a link. */
function linkRule(schema: Schema): InputRule {
  return new InputRule(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/u, (state, match, start, end) => {
    const link = schema.marks.link;
    if (link === undefined) return null;
    const text = schema.text(match[1] ?? "", [link.create({ href: match[2] })]);
    return state.tr.replaceWith(start, end, text).removeStoredMark(link);
  });
}

function rulesOf(schema: Schema): InputRule[] {
  const { bold, italic, code, strike } = schema.marks;
  const rules: InputRule[] = [linkRule(schema)];
  if (bold) rules.push(markRule(/\*\*([^*]+)\*\*$/u, bold));
  if (italic)
    rules.push(
      markRule(/(?<![*\w])\*([^*\s][^*]*)\*$/u, italic),
      markRule(/(?<!\w)_([^_]+)_$/u, italic),
    );
  if (code) rules.push(markRule(/`([^`]+)`$/u, code));
  if (strike) rules.push(markRule(/~~([^~]+)~~$/u, strike));
  const { bulletList, orderedList, codeBlock, blockquote } = schema.nodes;
  if (bulletList && schema === textSchema)
    rules.push(wrappingInputRule(/^\s*([-+*])\s$/u, bulletList));
  if (orderedList) {
    rules.push(
      wrappingInputRule(
        /^(\d+)\.\s$/u,
        orderedList,
        (match) => ({ start: Number(match[1]) }),
        (match, node) => node.childCount + Number(node.attrs.start) === Number(match[1]),
      ),
    );
  }
  if (codeBlock)
    rules.push(
      textblockTypeInputRule(/^```([a-z0-9-]*)\s$/u, codeBlock, (match) => ({
        language: match[1] || null,
      })),
    );
  if (blockquote) rules.push(wrappingInputRule(/^\s*>\s$/u, blockquote));
  return rules;
}

/** Each kind's keys: marks, lists, history, and the two that finish an edit. */
function keysOf(
  schema: Schema,
  kind: PmFieldKind,
  finish: () => void,
): ReturnType<typeof keymap>[] {
  const { bold, italic, code } = schema.marks;
  const listItem = schema.nodes.listItem;
  const finishing: Command = () => {
    finish();
    return true;
  };
  const keys: Record<string, Command> = {
    "Mod-z": undo,
    "Shift-Mod-z": redo,
    "Mod-y": redo,
    Escape: finishing,
    "Mod-Enter": finishing,
  };
  if (bold) keys["Mod-b"] = toggleMark(bold);
  if (italic) keys["Mod-i"] = toggleMark(italic);
  if (code) keys["Mod-e"] = toggleMark(code);
  if (schema.nodes.hardBreak) {
    const hardBreak = schema.nodes.hardBreak;
    keys["Shift-Enter"] = chainCommands(exitCode, (state, dispatch) => {
      dispatch?.(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView());
      return true;
    });
  }
  if (kind === PM_FIELD_KIND.RULE) {
    keys.Enter = ruleEnter;
    keys.Backspace = ruleBackspace;
  } else if (listItem) {
    keys.Enter = splitListItem(listItem);
    keys.Tab = sinkListItem(listItem);
    keys["Shift-Tab"] = liftListItem(listItem);
  }
  return [keymap(keys), keymap(baseKeymap)];
}

/** What the panel hands an editor as it mounts it. */
export interface FieldEditorProps {
  readonly value: FieldValue;
  /** Where the click that opened it landed, which places the caret; the end without one. */
  readonly at: { readonly x: number; readonly y: number } | undefined;
  readonly label: string;
  readonly className: string;
  /** The field's value after each change. */
  readonly onDraft: (value: FieldValue) => void;
  /** Esc, ⌘↩, or focus leaving. */
  readonly onFinish: () => void;
}

/**
 * One field's editor mounted into `host`, focused, its caret where the click
 * landed, since the editor's words stand where the drawn words stood.
 */
export function mountFieldEditor(
  host: HTMLElement,
  props: FieldEditorProps,
): { destroy: () => void } {
  const { value, at, label, className, onDraft, onFinish } = props;
  const schema = schemaOf(value.kind);
  const { doc, sources } = docOf(value);
  const state = EditorState.create({
    doc,
    plugins: [
      inputRules({ rules: rulesOf(schema) }),
      ...keysOf(schema, value.kind, onFinish),
      history(),
    ],
  });
  const view: EditorView = new EditorView(host, {
    state,
    attributes: {
      class: `${className} spike-editor`,
      role: "textbox",
      "aria-multiline": "true",
      "aria-label": label,
      spellcheck: "true",
    },
    dispatchTransaction: (tr) => {
      view.updateState(view.state.apply(tr));
      if (tr.docChanged) onDraft(fieldValueOf(value.kind, view.state.doc, sources));
    },
    handleDOMEvents: {
      blur: (_view, event) => {
        const next = (event as FocusEvent).relatedTarget;
        if (!(next instanceof Node && host.contains(next))) onFinish();
        return false;
      },
    },
  });
  const pos = at === undefined ? null : view.posAtCoords({ left: at.x, top: at.y });
  const selection =
    pos === null
      ? Selection.atEnd(view.state.doc)
      : TextSelection.near(view.state.doc.resolve(pos.pos));
  view.dispatch(view.state.tr.setSelection(selection));
  view.focus();
  return { destroy: () => view.destroy() };
}
