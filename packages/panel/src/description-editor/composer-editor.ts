import { WRITING_MARK } from "@repo/settings/shortcuts";
import { TEXT_LINK_MARK_ATTRIBUTES } from "@repo/ui/link-face";
import {
  cutReply,
  MESSAGE_BLOCK,
  messageBlocks,
  messageText,
  QUOTE_GAP,
  quoteOf,
} from "@repo/ui/reply-quote";
import {
  insideCode,
  mentionAt,
  skillTokens,
  skillWord,
  type TextRange,
} from "@repo/ui/skill-mention";
import { type AnyExtension, Editor, Extension, Node } from "@tiptap/core";
import {
  type Fragment,
  type Mark,
  type Node as PmNode,
  type Schema,
  Slice,
} from "@tiptap/pm/model";
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import type { EditorProps, EditorView } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import { enterKeyHint, enterSends } from "../enter-sends.js";
import {
  INLINE_MARK,
  INLINE_SPAN,
  type InlineMark,
  type InlineMarkName,
  readInline,
  writeInline,
} from "./composer-markdown.js";
import {
  COMPOSER_INPUT,
  type ComposerEditorHandle,
  type ComposerEditorProps,
  type ComposerInput,
  type ComposerMark,
  type ComposerQuote,
  type ComposerTrigger,
  type EditorAria,
  type MentionNode,
  rootAria,
  sameAria,
  sameTrigger,
} from "./contract.js";
import {
  MENTION_NODE,
  type MentionToken,
  mentionLink,
  mentionNode,
  mentionTokens,
  pastedMention,
} from "./mention-node.js";
import { editorFormatting, formatReports } from "./writing-format.js";
import { withoutTipTapChords, writingKeys } from "./writing-keys.js";

const EDITOR_CLASS = "composer-editor";

const COMPOSING_KEY_CODE = 229;

const COMMAND_META = "composer-command";

const CHIPPED_META = "composer-chipped";

const NAME_CHARACTER = /[A-Za-z0-9-]/u;

const SPACE = " ";
const NEWLINE = "\n";
const SKILL_NODE = "skill";
const QUOTE_NODE = "replyQuote";
const HARD_BREAK_NODE = "hardBreak";

interface TextRun {
  readonly offset: number;
  readonly pos: number;
  readonly length: number;
}

const INLINE_MARKS: ReadonlySet<string> = new Set(Object.values(INLINE_MARK));

const MARK_ACTIONS = Object.values(WRITING_MARK);

function isInlineMark(name: string): name is InlineMarkName {
  return INLINE_MARKS.has(name);
}

function inlineMark(mark: Mark): InlineMark[] {
  const { name } = mark.type;
  if (!isInlineMark(name)) return [];
  return [{ name, href: name === INLINE_MARK.LINK ? String(mark.attrs.href) : undefined }];
}

function inlineText(node: PmNode): string {
  if (node.isText) return node.text ?? "";
  if (node.type.name === SKILL_NODE) return skillWord(String(node.attrs.name));
  if (node.type.name === MENTION_NODE) {
    return mentionLink({ name: String(node.attrs.name), target: String(node.attrs.target) });
  }
  return node.type.name === HARD_BREAK_NODE ? NEWLINE : "";
}

function isQuote(node: PmNode): boolean {
  return node.type.name === QUOTE_NODE;
}

function quoteWords(node: PmNode): string {
  return String(node.attrs.words);
}

function writtenLine(nodes: readonly PmNode[]): ReturnType<typeof writeInline> {
  return writeInline(
    nodes.map((node) => ({
      text: inlineText(node),
      marks: node.isText ? node.marks.flatMap(inlineMark) : [],
      atom: !node.isText,
    })),
  );
}

function fragmentText(fragment: Fragment): string {
  const blocks: ({ kind: "quote"; words: string } | { kind: "words"; lines: string[] })[] = [];
  const inline: PmNode[] = [];
  fragment.forEach((node) => {
    const last = blocks.at(-1);
    if (isQuote(node)) blocks.push({ kind: MESSAGE_BLOCK.QUOTE, words: quoteWords(node) });
    else if (!node.isBlock) inline.push(node);
    else if (last?.kind === MESSAGE_BLOCK.WORDS) last.lines.push(fragmentText(node.content));
    else blocks.push({ kind: MESSAGE_BLOCK.WORDS, lines: [fragmentText(node.content)] });
  });
  return blocks.length === 0 ? writtenLine(inline).text : messageText(blocks);
}

function textOf(doc: PmNode): string {
  return fragmentText(doc.content);
}

function textRuns(doc: PmNode): TextRun[] {
  const runs: TextRun[] = [];
  let offset = 0;
  let previous: PmNode | undefined;
  doc.forEach((paragraph, start) => {
    if (previous !== undefined) {
      offset += isQuote(previous) || isQuote(paragraph) ? QUOTE_GAP.length : NEWLINE.length;
    }
    previous = paragraph;
    if (isQuote(paragraph)) {
      offset += quoteOf(quoteWords(paragraph)).length;
      return;
    }
    const children: PmNode[] = [];
    const starts: number[] = [];
    paragraph.forEach((child, childStart) => {
      children.push(child);
      starts.push(start + 1 + childStart);
    });
    const line = writtenLine(children);
    for (const segment of line.segments) {
      const pos = (starts[segment.piece] ?? 0) + segment.from;
      runs.push({ offset: offset + segment.offset, pos, length: segment.length });
    }
    offset += line.text.length;
  });
  return runs;
}

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

function textBetween(doc: PmNode, from: number, to: number): string {
  return textOf(doc.cut(from, to));
}

function offsetAt(doc: PmNode, pos: number): number {
  const run = textRuns(doc).find((each) => pos >= each.pos && pos <= each.pos + each.length);
  return run === undefined ? textBetween(doc, 0, pos).length : run.offset + pos - run.pos;
}

interface ChipToken {
  readonly start: number;
  readonly end: number;
  readonly node: (schema: Schema) => PmNode;
}

interface Chipping {
  readonly skills: ReadonlySet<string>;
  readonly mentions: boolean;
}

function chipTokens(
  text: string,
  { skills, mentions: takesMentions }: Chipping,
): readonly ChipToken[] {
  const mentions = (takesMentions ? mentionTokens(text) : []).map(
    (token: MentionToken): ChipToken => ({
      start: token.start,
      end: token.end,
      node: (schema) => schema.node(MENTION_NODE, { ...token.mention }),
    }),
  );
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

function schemaMark(schema: Schema, mark: InlineMark): Mark {
  return schema.mark(mark.name, mark.href === undefined ? null : { href: mark.href });
}

function paragraphsOf(schema: Schema, text: string, chipping: Chipping): PmNode[] {
  const tokens = chipTokens(text, chipping);
  const paragraphs: PmNode[] = [];
  let lineStart = 0;
  for (const line of text.split(NEWLINE)) {
    const lineEnd = lineStart + line.length;
    const chips = tokens.filter((each) => each.start >= lineStart && each.end <= lineEnd);
    const atoms = chips.map((each) => ({
      start: each.start - lineStart,
      end: each.end - lineStart,
    }));
    const children = readInline(line, atoms).map((span) =>
      span.kind === INLINE_SPAN.ATOM
        ? (chips.find((each) => each.start === lineStart + span.from)?.node(schema) ??
          schema.text(line.slice(span.from, span.to)))
        : schema.text(
            line.slice(span.from, span.to),
            span.marks.map((mark) => schemaMark(schema, mark)),
          ),
    );
    paragraphs.push(schema.node("paragraph", null, children));
    lineStart = lineEnd + NEWLINE.length;
  }
  return paragraphs;
}

function documentOf(schema: Schema, text: string, chipping: Chipping): PmNode {
  const blocks = messageBlocks(text);
  const nodes = blocks.flatMap((block) =>
    block.kind === MESSAGE_BLOCK.QUOTE
      ? [schema.node(QUOTE_NODE, { words: block.words })]
      : paragraphsOf(schema, block.lines.join(NEWLINE), chipping),
  );
  if (blocks.at(-1)?.kind === MESSAGE_BLOCK.QUOTE) nodes.push(schema.node("paragraph"));
  return schema.topNodeType.create(null, nodes);
}

function sliceOf(schema: Schema, text: string, chipping: Chipping): Slice {
  return Slice.maxOpen(documentOf(schema, text, chipping).content);
}

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

function removedQuote(view: EditorView, back: boolean): boolean {
  const { doc, selection } = view.state;
  const { $from } = selection;
  if ($from.depth !== 1) return false;
  const atEdge = back ? $from.parentOffset === 0 : $from.parentOffset === $from.parent.content.size;
  const index = $from.index(0) + (back ? -1 : 1);
  if (!atEdge || index < 0 || index >= doc.childCount) return false;
  const beside = doc.child(index);
  if (!isQuote(beside)) return false;
  const from = back ? $from.before(1) - beside.nodeSize : $from.after(1);
  view.dispatch(view.state.tr.delete(from, from + beside.nodeSize).scrollIntoView());
  return true;
}

function removedChip(view: EditorView, key: string): boolean {
  const { selection } = view.state;
  if (!selection.empty || (key !== "Backspace" && key !== "Delete")) return false;
  const back = key === "Backspace";
  if (removedQuote(view, back)) return true;
  const beside = back ? selection.$from.nodeBefore : selection.$from.nodeAfter;
  if (beside?.type.name !== SKILL_NODE && beside?.type.name !== MENTION_NODE) return false;
  const from = back ? selection.from - 1 : selection.from;
  view.dispatch(view.state.tr.delete(from, from + 1).scrollIntoView());
  return true;
}

function composing(view: EditorView, event: KeyboardEvent): boolean {
  return event.isComposing || view.composing || event.keyCode === COMPOSING_KEY_CODE;
}

interface TriggerWord {
  readonly start: number;
  readonly query: string;
  readonly end: number;
}

type TriggerFinder = (text: string, caret: number) => TriggerWord | undefined;

function slashWord(text: string, caret: number): TriggerWord | undefined {
  const mention = mentionAt(text, caret);
  if (mention === undefined) return undefined;
  let end = caret;
  while (end < text.length && NAME_CHARACTER.test(text[end] ?? "")) end += 1;
  return { ...mention, end };
}

const AT_WORD = /(^|\s)@((?:[^\s@[\]()]+(?: [^\s@[\]()]+){0,5})?)$/u;

const AT_WORD_CHARACTER = /[^\s@[\]()]/u;

function atWord(text: string, caret: number): TriggerWord | undefined {
  const match = AT_WORD.exec(text.slice(0, caret));
  if (match === null) return undefined;
  const query = match[2] ?? "";
  const start = caret - query.length - 1;
  if (insideCode(text, start)) return undefined;
  let end = caret;
  while (end < text.length && AT_WORD_CHARACTER.test(text[end] ?? "")) end += 1;
  return { start, query, end };
}

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

function quoteNode(drawQuote: ComposerEditorProps["drawQuote"]) {
  return Node.create({
    name: QUOTE_NODE,
    group: "block",
    atom: true,
    selectable: false,
    draggable: false,
    addAttributes() {
      return { words: { default: "", rendered: false } };
    },
    parseHTML() {
      return [
        {
          tag: "blockquote[data-quote]",
          getAttrs: (element) => ({ words: element.textContent ?? "" }),
        },
      ];
    },
    renderHTML({ node }) {
      return ["blockquote", { "data-quote": "" }, quoteWords(node)];
    },
    renderText({ node }) {
      return quoteOf(quoteWords(node));
    },
    addNodeView() {
      return ({ node, getPos, editor }) => {
        const dom = document.createElement("div");
        dom.contentEditable = "false";
        dom.dataset.quote = "";
        const quote: ComposerQuote = {
          words: quoteWords(node),
          remove: () => {
            const pos = getPos();
            if (pos === undefined || !editor.isEditable) return;
            editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize));
            editor.view.focus();
          },
        };
        if (drawQuote === undefined) dom.textContent = quote.words;
        const undraw = drawQuote?.(dom, quote) ?? (() => undefined);
        return { dom, ignoreMutation: () => true, destroy: undraw };
      };
    },
  });
}

function composerExtensions(
  props: ComposerEditorProps,
  known: (name: string) => boolean,
): AnyExtension[] {
  const kit = StarterKit.configure({
    blockquote: false,
    bulletList: false,
    codeBlock: false,
    dropcursor: false,
    gapcursor: false,
    heading: false,
    horizontalRule: false,
    listItem: false,
    listKeymap: false,
    link: { autolink: false, openOnClick: false, HTMLAttributes: TEXT_LINK_MARK_ATTRIBUTES },
    orderedList: false,
    underline: false,
    trailingNode: false,
  });
  return [
    withoutTipTapChords(kit),
    writingKeys.configure({ actions: MARK_ACTIONS }),
    ...formatReports(props.format),
    skillNode(props.drawChip, known),
    mentionNode(props.mentions?.drawMention),
    quoteNode(props.drawQuote),
  ];
}

function isChip(node: PmNode): boolean {
  return node.type.name === SKILL_NODE || node.type.name === MENTION_NODE;
}

function unmarkedChips(tr: Transaction): Transaction {
  tr.doc.descendants((node, pos) => {
    if (isChip(node) && node.marks.length > 0) tr.removeMark(pos, pos + node.nodeSize);
    return !node.isInline;
  });
  return tr;
}

interface ComposerState {
  skills: ReadonlySet<string>;
  input: ComposerInput;
  aria: EditorAria;
  emitted: string;
  reported: ComposerTrigger | undefined;
  trigger: ReturnType<typeof triggerAt>;
  mentionReported: ComposerTrigger | undefined;
  mentionTrigger: ReturnType<typeof triggerAt>;
  readonly mentions: boolean;
  readonly marks: Map<symbol, number>;
}

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

function guardPlugin(state: ComposerState, props: ComposerEditorProps): Plugin {
  return new Plugin({
    key: new PluginKey("composer-guard"),
    filterTransaction: (tr, before) => {
      if (!tr.docChanged) return true;
      if (state.input === COMPOSER_INPUT.READ_ONLY && tr.getMeta(COMMAND_META) !== true)
        return false;
      const length = textOf(tr.doc).length;
      return length <= props.maxLength || length <= textOf(before.doc).length;
    },
    appendTransaction: (transactions, _old, now) => {
      const chipping = transactions.some((tr) => tr.getMeta(CHIPPED_META) === true);
      const tr = unmarkedChips((chipping ? undefined : chipped(now, state.skills, true)) ?? now.tr);
      return tr.docChanged ? tr : undefined;
    },
    view: () => ({ update: (view) => reported(view, state, props) }),
  });
}

function caretInCode(text: string, caret: number): boolean {
  if (insideCode(text, caret)) return true;
  return caret > 0 && text[caret - 1] !== NEWLINE && insideCode(text, caret - 1);
}

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
  const { doc, selection, schema } = view.state;
  const words = fragmentText(slice.content);
  const over = (pasting: string) =>
    textOf(view.state.tr.replaceSelection(sliceOf(schema, pasting, state)).doc).length -
    props.maxLength;
  const mention = props.mentions?.pasted(words);
  if (
    mention !== undefined &&
    over(`${mentionLink(mention)}${SPACE}`) <= 0 &&
    !caretInCode(textOf(doc), offsetAt(doc, selection.from))
  ) {
    return pastedMention(view, event, () => mention);
  }
  let kept = words;
  for (let excess = over(kept); excess > 0 && kept !== ""; excess = over(kept)) {
    kept = kept.slice(0, Math.max(0, kept.length - excess));
  }
  if (kept === words) return false;
  if (kept !== "") {
    view.dispatch(view.state.tr.replaceSelection(sliceOf(schema, kept, state)).scrollIntoView());
  }
  props.onPasteCut?.();
  return true;
}

function composerProps(state: ComposerState, props: ComposerEditorProps): EditorProps {
  return {
    attributes: () => ({
      class: `${props.className} ${EDITOR_CLASS}`,
      ...rootAria(state.aria),
      "aria-label": props.label,
      enterkeyhint: enterKeyHint(),
    }),
    handleKeyDown: (view, event) => {
      if (composing(view, event)) return false;
      if (props.onKey(event) || removedChip(view, event.key)) return true;
      if (!enterSends(event)) return false;
      props.onEnter();
      return true;
    },
    handleDOMEvents: {
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
      scroll: (view) => {
        reported(view, state, props);
        return false;
      },
    },
    handlePaste: (view, event, slice) => pasted(view, event, slice, state, props),
    handleDrop: (_view, event) => event.dataTransfer?.types.includes("Files") === true,
    clipboardTextParser: (text, _context, _plain, view) => sliceOf(view.state.schema, text, state),
    clipboardTextSerializer: (slice) => fragmentText(slice.content),
  };
}

function commanded(editor: Editor, tr: Transaction): void {
  editor.view.dispatch(
    tr.setMeta(COMMAND_META, true).setMeta("addToHistory", false).scrollIntoView(),
  );
}

function focusedAtCaret(editor: Editor): void {
  editor.view.dom.ownerDocument.getSelection()?.removeAllRanges();
  editor.view.focus();
}

function laidIn(editor: Editor, state: ComposerState, text: string): void {
  const { doc, schema } = editor.state;
  const tr = editor.state.tr.replaceWith(
    0,
    doc.content.size,
    documentOf(schema, text, state).content,
  );
  commanded(editor, tr.setSelection(TextSelection.atEnd(tr.doc)).setMeta(CHIPPED_META, true));
  if (editor.view.hasFocus()) focusedAtCaret(editor);
}

function needsSpace(node: PmNode | null | undefined, after: boolean): boolean {
  if (node === null || node === undefined) return false;
  const words = inlineText(node);
  const character = after ? words[0] : words.at(-1);
  return character !== undefined && !/\s/u.test(character);
}

function insertedAt(
  editor: Editor,
  state: ComposerState,
  maxLength: number,
  pos: number,
  words: string,
): boolean {
  const { doc, schema } = editor.state;
  const $pos = doc.resolve(pos);
  const lead = needsSpace($pos.nodeBefore, false) ? SPACE : "";
  const trail = needsSpace($pos.nodeAfter, true) ? SPACE : "";
  const room = Math.max(0, maxLength - textOf(doc).length - lead.length - trail.length);
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

function laidInMention(
  editor: Editor,
  state: ComposerState,
  maxLength: number,
  mention: MentionNode,
): void {
  if (state.input !== COMPOSER_INPUT.EDITABLE) return;
  const { doc, selection, schema } = editor.state;
  const spaced =
    doc.textBetween(selection.to, Math.min(selection.to + 1, doc.content.size)) === SPACE;
  const chip = schema.node(MENTION_NODE, { name: mention.name, target: mention.target });
  const laid = editor.state.tr.replaceSelectionWith(chip, false);
  const tr = spaced ? laid : laid.insertText(SPACE);
  if (textOf(tr.doc).length > maxLength) return;
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}

function quotedAt(editor: Editor, words: string): Transaction {
  const { doc, selection, schema } = editor.state;
  const { $from } = selection;
  const line = doc.child($from.index(0));
  const quote = schema.node(QUOTE_NODE, { words });
  const from = $from.before(1);
  const empty = line.type.name === "paragraph" && line.content.size === 0;
  const tr = empty
    ? editor.state.tr.replaceWith(from, from + line.nodeSize, quote)
    : editor.state.tr.insert(from + line.nodeSize, quote);
  const under = (empty ? from : from + line.nodeSize) + quote.nodeSize;
  const next = tr.doc.nodeAt(under);
  if (next === null || next.type.name !== "paragraph" || next.content.size > 0) {
    tr.insert(under, schema.node("paragraph"));
  }
  return tr.setSelection(TextSelection.create(tr.doc, under + 1));
}

function laidInQuote(
  editor: Editor,
  state: ComposerState,
  maxLength: number,
  words: string,
): boolean {
  if (state.input !== COMPOSER_INPUT.EDITABLE || editor.state.selection.$from.depth !== 1) {
    return false;
  }
  let kept = words;
  while (kept !== "") {
    const tr = quotedAt(editor, kept);
    const over = textOf(tr.doc).length - maxLength;
    if (over <= 0) {
      editor.view.dispatch(tr.scrollIntoView());
      focusedAtCaret(editor);
      return true;
    }
    kept = cutReply(kept, kept.length - over);
  }
  return false;
}

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

function attributed(
  editor: Editor,
  attributes: Readonly<Record<string, string | undefined>>,
): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined) editor.view.dom.removeAttribute(name);
    else editor.view.dom.setAttribute(name, value);
  }
}

export function mountComposer(host: HTMLElement, props: ComposerEditorProps): ComposerEditorHandle {
  const state: ComposerState = {
    skills: props.skills,
    input: COMPOSER_INPUT.EDITABLE,
    aria: {},
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
    injectCSS: false,
    enablePasteRules: false,
    extensions: [
      ...composerExtensions(props, (name) => state.skills.has(name)),
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
    ...editorFormatting(editor),
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
    insertQuote: (words) => laidInQuote(editor, state, props.maxLength, words),
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
    setAria: (aria) => {
      if (sameAria(state.aria, aria) || editor.isDestroyed) return;
      state.aria = aria;
      if (!editor.view.composing) editor.view.updateState(editor.state);
    },
    blur: () => editor.view.dom.blur(),
    destroy: () => editor.destroy(),
  };
}
