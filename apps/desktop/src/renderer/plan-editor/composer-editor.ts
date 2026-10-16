import {
  insideCode,
  mentionAt,
  skillTokens,
  skillWord,
  type TextRange,
} from "@luke/ui/skill-mention";
import { type AnyExtension, Editor, Extension, Node } from "@tiptap/core";
import { type Fragment, type Node as PmNode, type Schema, Slice } from "@tiptap/pm/model";
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import type { EditorProps, EditorView } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import {
  COMPOSER_INPUT,
  type ComposerEditorHandle,
  type ComposerEditorProps,
  type ComposerInput,
  type ComposerMark,
  type ComposerTrigger,
  type MentionNode,
} from "./contract";
import {
  MENTION_NODE,
  type MentionToken,
  mentionLink,
  mentionNode,
  mentionTokens,
  pastedMention,
} from "./mention-node";

/**
 * composer-editor.ts -- an agent's message box on TipTap: plain words, a line break, and a chosen skill as a chip, read out as the one string the message is.
 *
 * The box holds nothing a textarea would not, so its schema is StarterKit
 * cut down to a document of paragraphs, text, a hard break, and undo: no
 * mark, no list, no input rule turns what is typed into anything but the
 * words typed. One node is added, the `skill` chip, an atom that one
 * Backspace takes out whole and that reads out as `/name`. The words leave
 * the editor one way, `onDraft`, as the string `textOf` reads off the
 * document; nothing hands them back in. A change from outside is one of
 * the handle's commands (`./contract.ts`): `clear` after a send, `replace`
 * for a message that comes back, and a mark that carries the caret through
 * every change until a dictation's words land there, so no offset into the
 * string is ever turned back into a place in the document by arithmetic.
 *
 * A `/name` naming one of the repository's skills becomes its chip once the
 * caret has left it, typed or pasted, and at once in words laid in whole;
 * a `/` word the caret ends is reported to the box (`onTrigger`), which
 * draws the list over it and writes the choice back through `chooseSkill`.
 * The trigger is the character's finder over the words (`slashWord`), so
 * another character's list stands on the same report beside it.
 * Neither a chip nor anything else in the editor's DOM carries the skill's
 * name in an attribute: it lives in the node, and the chip's words, drawn by
 * the panel (`drawChip`), are text the session recording masks.
 *
 * The bound is a transaction filter, so no keystroke, pick, or command
 * carries the words past it; a paste past it is cut to the room left, as a
 * textarea cuts one. Enter with no Shift is the owner's send, unless an
 * input method is composing, when the key is the input method's.
 */

/** The element class the editor wears beside the owner's. */
const EDITOR_CLASS = "composer-editor";

/** The key code a browser gives a key an input method takes. */
const COMPOSING_KEY_CODE = 229;

/** What a transaction from one of the handle's commands is tagged with, which read-only still takes. */
const COMMAND_META = "luke-composer-command";

/** What a transaction that made chips of `/name` words is tagged with, so it makes none of its own. */
const CHIPPED_META = "luke-composer-chipped";

/** A character a skill's name is spelled in, which a pick replaces through to the word's end. */
const NAME_CHARACTER = /[A-Za-z0-9-]/u;

const SPACE = " ";
const NEWLINE = "\n";
const SKILL_NODE = "skill";
const HARD_BREAK_NODE = "hardBreak";

/** A run of plain text in the words: where it starts in the string, and where in the document. */
interface TextRun {
  readonly offset: number;
  readonly pos: number;
  readonly length: number;
}

/** The words an inline node stands for. */
function inlineText(node: PmNode): string {
  if (node.isText) return node.text ?? "";
  if (node.type.name === SKILL_NODE) return skillWord(String(node.attrs.name));
  if (node.type.name === MENTION_NODE) {
    return mentionLink({ name: String(node.attrs.name), target: String(node.attrs.target) });
  }
  return node.type.name === HARD_BREAK_NODE ? NEWLINE : "";
}

/** The words a fragment stands for: its paragraphs a line each, or its inline nodes run together. */
function fragmentText(fragment: Fragment): string {
  const lines: string[] = [];
  let inline = "";
  fragment.forEach((node) => {
    if (node.isBlock) lines.push(fragmentText(node.content));
    else inline += inlineText(node);
  });
  return lines.length === 0 ? inline : lines.join(NEWLINE);
}

/** The words the document stands for, as the message sends them. */
function textOf(doc: PmNode): string {
  return fragmentText(doc.content);
}

/** Every run of plain text in the document, in order, each with where it stands in the words. */
function textRuns(doc: PmNode): TextRun[] {
  const runs: TextRun[] = [];
  let offset = 0;
  doc.forEach((paragraph, start, index) => {
    if (index > 0) offset += NEWLINE.length;
    paragraph.forEach((child, childStart) => {
      const length = inlineText(child).length;
      if (child.isText) runs.push({ offset, pos: start + 1 + childStart, length });
      offset += length;
    });
  });
  return runs;
}

/** Where in the document a range of the words stands, where it falls within one run of plain text; nothing where it does not. */
function placeOf(
  runs: readonly TextRun[],
  range: TextRange,
): { from: number; to: number } | undefined {
  const run = runs.find(
    (each) => range.start >= each.offset && range.end <= each.offset + each.length,
  );
  if (run === undefined) return undefined;
  return { from: run.pos + range.start - run.offset, to: run.pos + range.end - run.offset };
}

/** The words between two places in the document. */
function textBetween(doc: PmNode, from: number, to: number): string {
  return textOf(doc.cut(from, to));
}

/** Where a place in the document stands in the words. */
function offsetAt(doc: PmNode, pos: number): number {
  return textBetween(doc, 0, pos).length;
}

/** A chip written in plain words: where it stands, and the node it becomes. */
interface ChipToken {
  readonly start: number;
  readonly end: number;
  readonly node: (schema: Schema) => PmNode;
}

/** What words are made chips of: the skills a `/name` names, and whether the box takes mentions. */
interface Chipping {
  readonly skills: ReadonlySet<string>;
  readonly mentions: boolean;
}

/** Every chip the words spell, in order: each `/name` of a known skill, and each mention written as its link where the box takes mentions, none overlapping another. */
function chipTokens(
  text: string,
  { skills, mentions: takesMentions }: Chipping,
): readonly ChipToken[] {
  // Note that a box that takes no mentions keeps a mention's link as the words it is, which it can edit.
  const mentions = (takesMentions ? mentionTokens(text) : []).map(
    (token: MentionToken): ChipToken => ({
      start: token.start,
      end: token.end,
      node: (schema) => schema.node(MENTION_NODE, { ...token.mention }),
    }),
  );
  // Note that a `/name` inside a mention's link is the link's words, never a chip of its own.
  const skilled = skillTokens(text, skills)
    .filter((range) => !mentions.some((each) => range.start < each.end && range.end > each.start))
    .map(
      (range): ChipToken => ({
        ...range,
        node: (schema) => schema.node(SKILL_NODE, { name: text.slice(range.start + 1, range.end) }),
      }),
    );
  return [...mentions, ...skilled].sort((first, second) => first.start - second.start);
}

/** The document the words stand for: a paragraph per line, each `/name` of a known skill and each mention its chip. */
function documentOf(schema: Schema, text: string, chipping: Chipping): PmNode {
  const tokens = chipTokens(text, chipping);
  const paragraphs: PmNode[] = [];
  let lineStart = 0;
  for (const line of text.split(NEWLINE)) {
    const lineEnd = lineStart + line.length;
    const children: PmNode[] = [];
    let at = lineStart;
    for (const token of tokens.filter((each) => each.start >= lineStart && each.end <= lineEnd)) {
      if (token.start > at) children.push(schema.text(text.slice(at, token.start)));
      children.push(token.node(schema));
      at = token.end;
    }
    if (lineEnd > at) children.push(schema.text(text.slice(at, lineEnd)));
    paragraphs.push(schema.node("paragraph", null, children));
    lineStart = lineEnd + NEWLINE.length;
  }
  return schema.topNodeType.create(null, paragraphs);
}

/** The words as a slice that lays in where a caret or a selection stands, its first and last lines joining the lines around them. */
function sliceOf(schema: Schema, text: string, chipping: Chipping): Slice {
  return Slice.maxOpen(documentOf(schema, text, chipping).content);
}

/**
 * Each `/name` of a known skill that still stands as words made its chip,
 * but the one the caret ends where it is asked to be spared; nothing where
 * there is none.
 */
function chipped(
  state: EditorState,
  skills: ReadonlySet<string>,
  spareCaret: boolean,
): Transaction | undefined {
  const { doc, selection } = state;
  const runs = textRuns(doc);
  const caret = selection.empty ? offsetAt(doc, selection.from) : undefined;
  const places = skillTokens(textOf(doc), skills)
    .filter((token) => !spareCaret || token.end !== caret)
    .flatMap((token) => {
      const place = placeOf(runs, token);
      return place === undefined
        ? []
        : [{ ...place, name: doc.textBetween(place.from + 1, place.to) }];
    });
  if (places.length === 0) return undefined;
  const tr = state.tr;
  for (const place of places.reverse()) {
    tr.replaceWith(place.from, place.to, state.schema.node(SKILL_NODE, { name: place.name }));
  }
  return tr.setMeta(CHIPPED_META, true);
}

/** The chip beside an empty selection taken out whole, before it for Backspace and after it for Delete; answers whether there was one. */
function removedChip(view: EditorView, key: string): boolean {
  const { selection } = view.state;
  if (!selection.empty || (key !== "Backspace" && key !== "Delete")) return false;
  const back = key === "Backspace";
  const beside = back ? selection.$from.nodeBefore : selection.$from.nodeAfter;
  if (beside?.type.name !== SKILL_NODE && beside?.type.name !== MENTION_NODE) return false;
  const from = back ? selection.from - 1 : selection.from;
  view.dispatch(view.state.tr.delete(from, from + 1).scrollIntoView());
  return true;
}

/** Whether a key belongs to an input method that is composing, in any of the ways a browser says so. */
function composing(view: EditorView, event: KeyboardEvent): boolean {
  return event.isComposing || view.composing || event.keyCode === COMPOSING_KEY_CODE;
}

/** A word a trigger character starts, in the words' own terms: where the character stands, what follows it to the caret, and where the word ends. */
interface TriggerWord {
  readonly start: number;
  readonly query: string;
  readonly end: number;
}

/** Finds the word a trigger character starts at the caret; one for each character the box answers. */
type TriggerFinder = (text: string, caret: number) => TriggerWord | undefined;

/** The `/` word the caret ends: a skill's name as far as it is typed, through to the name's end. */
function slashWord(text: string, caret: number): TriggerWord | undefined {
  const mention = mentionAt(text, caret);
  if (mention === undefined) return undefined;
  let end = caret;
  while (end < text.length && NAME_CHARACTER.test(text[end] ?? "")) end += 1;
  return { ...mention, end };
}

/** The `@` word the caret ends: `@` at the start of a word, then up to four words with no bracket, parenthesis, or `@` in them. */
const AT_WORD = /(^|\s)@((?:[^\s@[\]()]+(?: [^\s@[\]()]+){0,3})?)$/u;

/** A character of an `@` word, which a pick replaces through to the word's end. */
const AT_WORD_CHARACTER = /[^\s@[\]()]/u;

/** The `@` word the caret ends, as far as it is typed, through to the word's end; nothing in code. */
function atWord(text: string, caret: number): TriggerWord | undefined {
  const match = AT_WORD.exec(text.slice(0, caret));
  if (match === null) return undefined;
  const query = match[2] ?? "";
  const start = caret - query.length - 1;
  // An `@` in code is the code's, as a `/` there is, and as the server reads no mention there.
  if (insideCode(text, start)) return undefined;
  let end = caret;
  while (end < text.length && AT_WORD_CHARACTER.test(text[end] ?? "")) end += 1;
  return { start, query, end };
}

/**
 * The word a trigger character starts at the caret, where the character
 * stands in plain text: the report, and the range a pick replaces; nothing
 * while the box has no caret, or the caret ends no such word.
 */
function triggerAt(
  view: EditorView,
  find: TriggerFinder,
): { readonly trigger: ComposerTrigger; readonly from: number; readonly to: number } | undefined {
  const { doc, selection } = view.state;
  if (!selection.empty || !view.hasFocus()) return undefined;
  const text = textOf(doc);
  const caret = offsetAt(doc, selection.from);
  const word = find(text, caret);
  if (word === undefined) return undefined;
  const runs = textRuns(doc);
  const typed = placeOf(runs, { start: word.start, end: caret });
  if (typed === undefined) return undefined;
  const whole = placeOf(runs, { start: word.start, end: word.end }) ?? typed;
  const box = view.coordsAtPos(typed.from);
  return {
    trigger: {
      start: word.start,
      query: word.query,
      rect: { left: box.left, top: box.top, bottom: box.bottom },
    },
    from: whole.from,
    to: whole.to,
  };
}

/** Whether two reports say the same, so an unchanged word is not reported again. */
function sameTrigger(a: ComposerTrigger | undefined, b: ComposerTrigger | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.start === b.start &&
    a.query === b.query &&
    a.rect.left === b.rect.left &&
    a.rect.top === b.rect.top &&
    a.rect.bottom === b.rect.bottom
  );
}

/** The `skill` chip: an atom read out as `/name`, its look the panel's (`drawChip`), its name in the node and never in the DOM's attributes. */
function skillNode(drawChip: ComposerEditorProps["drawChip"], known: (name: string) => boolean) {
  return Node.create({
    name: SKILL_NODE,
    group: "inline",
    inline: true,
    atom: true,
    selectable: false,
    addAttributes() {
      return { name: { default: "", rendered: false } };
    },
    // Note that a chip copied out and pasted back is read by its words, since its name is in no
    // attribute, and stays words where this repository keeps no skill of that name.
    parseHTML() {
      return [
        {
          tag: "span[data-chip]",
          getAttrs: (element) => {
            const name = (element.textContent ?? "").replace(/^\//u, "");
            return known(name) ? { name } : false;
          },
        },
      ];
    },
    renderHTML({ node }) {
      return ["span", { "data-chip": SKILL_NODE }, skillWord(String(node.attrs.name))];
    },
    renderText({ node }) {
      return skillWord(String(node.attrs.name));
    },
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement("span");
        dom.contentEditable = "false";
        dom.dataset.chip = SKILL_NODE;
        const undraw = drawChip(dom, { name: String(node.attrs.name) });
        return { dom, ignoreMutation: () => true, destroy: undraw };
      };
    },
  });
}

/** What the box may hold: paragraphs, text, a hard break, and undo, StarterKit's and nothing more, and the chip. */
function composerExtensions(
  drawChip: ComposerEditorProps["drawChip"],
  known: (name: string) => boolean,
  drawMention: ((element: HTMLElement, mention: MentionNode) => () => void) | undefined,
): AnyExtension[] {
  const kit = StarterKit.configure({
    blockquote: false,
    bold: false,
    bulletList: false,
    code: false,
    codeBlock: false,
    dropcursor: false,
    gapcursor: false,
    heading: false,
    horizontalRule: false,
    italic: false,
    listItem: false,
    listKeymap: false,
    link: false,
    orderedList: false,
    strike: false,
    underline: false,
    trailingNode: false,
  });
  return [kit, skillNode(drawChip, known), mentionNode(drawMention)];
}

/** What a mounted box keeps between its events: the skills it chips, whether it takes words, the last words and word it reported, and its marks. */
interface ComposerState {
  skills: ReadonlySet<string>;
  input: ComposerInput;
  emitted: string;
  reported: ComposerTrigger | undefined;
  trigger: ReturnType<typeof triggerAt>;
  mentionReported: ComposerTrigger | undefined;
  mentionTrigger: ReturnType<typeof triggerAt>;
  /** Whether the box takes mentions, as it was mounted. */
  readonly mentions: boolean;
  /** Each mark's place, carried through every change the document takes. */
  readonly marks: Map<symbol, number>;
}

/** The `/` word and the `@` word the caret ends found again, and each reported where it changed. */
function reported(view: EditorView, state: ComposerState, props: ComposerEditorProps): void {
  state.trigger = triggerAt(view, slashWord);
  const next = state.trigger?.trigger;
  if (!sameTrigger(next, state.reported)) {
    state.reported = next;
    props.onTrigger(next);
  }
  const { mentions } = props;
  if (mentions === undefined) return;
  state.mentionTrigger = triggerAt(view, atWord);
  const mention = state.mentionTrigger?.trigger;
  if (sameTrigger(mention, state.mentionReported)) return;
  state.mentionReported = mention;
  mentions.onTrigger(mention);
}

/**
 * The box's guard: no change past the bound and none while read-only but a
 * command's, each completed `/name` made its chip, and the `/` word
 * reported as the editor's state moves.
 */
function guardPlugin(state: ComposerState, props: ComposerEditorProps): Plugin {
  return new Plugin({
    key: new PluginKey("composer-guard"),
    // Note that a change that shrinks the words passes even past the bound, so
    // words already over it, which nothing lays in, can still be cut back.
    filterTransaction: (tr, before) => {
      if (!tr.docChanged) return true;
      if (state.input === COMPOSER_INPUT.READ_ONLY && tr.getMeta(COMMAND_META) !== true)
        return false;
      const length = textOf(tr.doc).length;
      return length <= props.maxLength || length <= textOf(before.doc).length;
    },
    appendTransaction: (transactions, _old, now) => {
      if (transactions.some((tr) => tr.getMeta(CHIPPED_META) === true)) return undefined;
      return chipped(now, state.skills, true);
    },
    view: () => ({ update: (view) => reported(view, state, props) }),
  });
}

/**
 * Whether a caret stands in code: the character after it is code's, or the
 * one before it on its own line is, as a caret just inside a span's closing
 * backtick is. Note that the line before is never read, because a fence's
 * closing line is code and the line after it is not.
 */
function caretInCode(text: string, caret: number): boolean {
  if (insideCode(text, caret)) return true;
  return caret > 0 && text[caret - 1] !== NEWLINE && insideCode(text, caret - 1);
}

/** A paste taken: files the owner takes kept out of the words, and words past the bound cut to the room left. */
function pasted(
  view: EditorView,
  event: ClipboardEvent,
  slice: Slice,
  state: ComposerState,
  props: ComposerEditorProps,
): boolean {
  const files = [...(event.clipboardData?.files ?? [])];
  if (files.length > 0 && props.onPasteFiles(files)) return true;
  if (state.input === COMPOSER_INPUT.READ_ONLY) return true;
  const { doc, selection } = view.state;
  const words = fragmentText(slice.content);
  const room =
    props.maxLength - textOf(doc).length + textBetween(doc, selection.from, selection.to).length;
  // An address of Luke's own or a page of an integration's pasted whole, outside code, is laid in as its mention, where its link has room.
  const mention = props.mentions?.pasted(words);
  if (
    mention !== undefined &&
    mentionLink(mention).length + SPACE.length <= room &&
    !caretInCode(textOf(doc), offsetAt(doc, selection.from))
  ) {
    return pastedMention(view, event, () => mention);
  }
  if (words.length <= room) return false;
  if (room > 0) {
    const cut = sliceOf(view.state.schema, words.slice(0, room), state);
    view.dispatch(view.state.tr.replaceSelection(cut).scrollIntoView());
  }
  return true;
}

/** How the box's editor hears keys, input, focus, a paste, a drop, and the clipboard. */
function composerProps(state: ComposerState, props: ComposerEditorProps): EditorProps {
  return {
    attributes: {
      class: `${props.className} ${EDITOR_CLASS}`,
      role: "textbox",
      "aria-multiline": "true",
      "aria-label": props.label,
    },
    // Note that a key an input method is composing is the input method's alone, the owner's included.
    handleKeyDown: (view, event) => {
      if (composing(view, event)) return false;
      if (props.onKey(event) || removedChip(view, event.key)) return true;
      if (event.key !== "Enter" || event.shiftKey) return false;
      props.onEnter();
      return true;
    },
    handleDOMEvents: {
      // A dictation's read-only box keeps the caret and its keys, and takes no words.
      beforeinput: (_view, event) => {
        if (state.input !== COMPOSER_INPUT.READ_ONLY) return false;
        event.preventDefault();
        return true;
      },
      blur: (view) => {
        reported(view, state, props);
        return false;
      },
      focus: (view) => {
        reported(view, state, props);
        return false;
      },
      // The words scrolling under a list move the slash it stands over, with no change to the state.
      scroll: (view) => {
        reported(view, state, props);
        return false;
      },
    },
    handlePaste: (view, event, slice) => pasted(view, event, slice, state, props),
    // Note that a drop of files is left to the card around the box, which takes them as a "+" does.
    handleDrop: (_view, event) => event.dataTransfer?.types.includes("Files") === true,
    clipboardTextParser: (text, _context, _plain, view) => sliceOf(view.state.schema, text, state),
    clipboardTextSerializer: (slice) => fragmentText(slice.content),
  };
}

/** A change from outside dispatched: taken while read-only, left out of undo, the caret kept in view. */
function commanded(editor: Editor, tr: Transaction): void {
  editor.view.dispatch(
    tr.setMeta(COMMAND_META, true).setMeta("addToHistory", false).scrollIntoView(),
  );
}

/** The words laid in whole, each known skill's `/name` its chip, the caret at their end. */
function laidIn(editor: Editor, state: ComposerState, text: string): void {
  const { doc, schema } = editor.state;
  const tr = editor.state.tr.replaceWith(
    0,
    doc.content.size,
    documentOf(schema, text, state).content,
  );
  commanded(editor, tr.setSelection(TextSelection.atEnd(tr.doc)).setMeta(CHIPPED_META, true));
}

/** The words put in at a place, spaced from a word either side and cut to the room left, the caret after them; answers whether any went in. */
function insertedAt(
  editor: Editor,
  state: ComposerState,
  maxLength: number,
  pos: number,
  words: string,
): boolean {
  const { doc, schema } = editor.state;
  const text = textOf(doc);
  const offset = offsetAt(doc, pos);
  const lead = offset === 0 || /\s/u.test(text[offset - 1] ?? "") ? "" : SPACE;
  const trail = offset === text.length || /\s/u.test(text[offset] ?? "") ? "" : SPACE;
  const room = Math.max(0, maxLength - text.length - lead.length - trail.length);
  const fitting = words.slice(0, room).trim();
  if (fitting === "") return false;
  const tr = editor.state.tr.replace(pos, pos, sliceOf(schema, `${lead}${fitting}${trail}`, state));
  commanded(
    editor,
    tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(pos) - trail.length)),
  );
  editor.view.focus();
  return true;
}

/** The word a trigger found written as the chip given, a space after it unless one follows, the caret after the space. */
function choseChip(editor: Editor, word: ReturnType<typeof triggerAt>, chip: PmNode): void {
  if (word === undefined) return;
  const { doc, schema } = editor.state;
  const spaced = doc.textBetween(word.to, Math.min(word.to + 1, doc.content.size)) === SPACE;
  const tr = editor.state.tr.replaceWith(
    word.from,
    word.to,
    spaced ? [chip] : [chip, schema.text(SPACE)],
  );
  editor.view.dispatch(
    tr.setSelection(TextSelection.create(tr.doc, word.from + 2)).scrollIntoView(),
  );
}

/**
 * A mention made elsewhere laid in where the caret stands, over what is
 * selected, a space after it unless one follows, the caret after the
 * mention and the box focused; nothing where the box takes no words now, or the mention's link
 * has no room left under the bound, as a key typed past it is not written.
 */
function laidInMention(
  editor: Editor,
  state: ComposerState,
  maxLength: number,
  mention: MentionNode,
): void {
  if (state.input !== COMPOSER_INPUT.EDITABLE) return;
  const { doc, selection, schema } = editor.state;
  const room =
    maxLength - textOf(doc).length + textBetween(doc, selection.from, selection.to).length;
  const spaced =
    doc.textBetween(selection.to, Math.min(selection.to + 1, doc.content.size)) === SPACE;
  if (mentionLink(mention).length + (spaced ? 0 : SPACE.length) > room) return;
  const chip = schema.node(MENTION_NODE, { name: mention.name, target: mention.target });
  const tr = editor.state.tr.replaceSelectionWith(chip, false);
  editor.view.dispatch((spaced ? tr : tr.insertText(SPACE)).scrollIntoView());
  editor.view.focus();
}

/** A mark of the caret where it stands, carried through every change until its words land or it is let go. */
function marked(editor: Editor, state: ComposerState, maxLength: number): ComposerMark {
  const mark = Symbol("mark");
  state.marks.set(mark, editor.state.selection.to);
  return {
    insert: (words) => {
      const pos = state.marks.get(mark);
      state.marks.delete(mark);
      return pos !== undefined && insertedAt(editor, state, maxLength, pos, words);
    },
    release: () => {
      state.marks.delete(mark);
    },
  };
}

/** The editor element's attributes set, or taken off where a value is nothing. */
function attributed(
  editor: Editor,
  attributes: Readonly<Record<string, string | undefined>>,
): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined) editor.view.dom.removeAttribute(name);
    else editor.view.dom.setAttribute(name, value);
  }
}

/**
 * The message box's editor mounted into `host`, opening on the words given,
 * each change handed back through `onDraft`, and every outside change taken
 * through the handle it answers.
 */
export function mountComposer(host: HTMLElement, props: ComposerEditorProps): ComposerEditorHandle {
  const state: ComposerState = {
    skills: props.skills,
    input: COMPOSER_INPUT.EDITABLE,
    emitted: props.text,
    reported: undefined,
    trigger: undefined,
    mentionReported: undefined,
    mentionTrigger: undefined,
    mentions: props.mentions !== undefined,
    marks: new Map(),
  };
  const guard = guardPlugin(state, props);
  const editor = new Editor({
    element: host,
    extensions: [
      ...composerExtensions(
        props.drawChip,
        (name) => state.skills.has(name),
        props.mentions?.drawMention,
      ),
      Extension.create({ name: "composerGuard", addProseMirrorPlugins: () => [guard] }),
    ],
    editorProps: composerProps(state, props),
  });
  editor.on("transaction", ({ transaction }) => {
    for (const [mark, pos] of state.marks) state.marks.set(mark, transaction.mapping.map(pos));
    const text = textOf(editor.state.doc);
    if (!transaction.docChanged || text === state.emitted) return;
    state.emitted = text;
    props.onDraft(text);
  });
  laidIn(editor, state, props.text);
  if (props.focus) editor.view.focus();
  return {
    clear: () => laidIn(editor, state, ""),
    replace: (text) => laidIn(editor, state, text),
    mark: () => marked(editor, state, props.maxLength),
    chooseSkill: (name) =>
      choseChip(editor, state.trigger, editor.schema.node(SKILL_NODE, { name })),
    chooseMention: (mention) =>
      choseChip(
        editor,
        state.mentionTrigger,
        editor.schema.node(MENTION_NODE, { name: mention.name, target: mention.target }),
      ),
    insertMention: (mention) => laidInMention(editor, state, props.maxLength, mention),
    chooseSkillAtMention: (name) =>
      choseChip(editor, state.mentionTrigger, editor.schema.node(SKILL_NODE, { name })),
    setSkills: (skills) => {
      state.skills = skills;
      const tr = chipped(editor.state, skills, true);
      if (tr !== undefined) editor.view.dispatch(tr.setMeta("addToHistory", false));
    },
    setInput: (input) => {
      state.input = input;
      editor.setEditable(input !== COMPOSER_INPUT.DISABLED, false);
      attributed(editor, {
        "aria-disabled": input === COMPOSER_INPUT.DISABLED ? "true" : undefined,
        "aria-readonly": input === COMPOSER_INPUT.READ_ONLY ? "true" : undefined,
      });
    },
    setAria: (aria) => attributed(editor, aria),
    focus: () => editor.view.focus(),
    blur: () => editor.view.dom.blur(),
    destroy: () => editor.destroy(),
  };
}
