import { WRITING_BLOCK, WRITING_SHORTCUTS } from "@repo/settings/shortcuts";
import { linkMarkAttributes } from "@repo/ui/link-face";
import { MARKDOWN_CLASS } from "@repo/ui/markdown-class";
import { QUOTE_CLASS } from "@repo/ui/quote-face";
import { type AnyExtension, Editor, Extension, type NodeViewRenderer } from "@tiptap/core";
import Heading from "@tiptap/extension-heading";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Paragraph from "@tiptap/extension-paragraph";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Selection, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { enterSends, modEnterSends } from "../enter-sends.js";
import { anchorsLaidIn, anchorsOf, commentAnchorMark, spanIn } from "./comment-anchors.js";
import {
  type EditorAria,
  type EditorSpan,
  FINISH,
  type MentionDrawer,
  DESCRIPTION_PLACEHOLDER,
  type PlacedWords,
  type DescriptionEditorHandle,
  type DescriptionEditorPictures,
  type DescriptionEditorPlacement,
  type DescriptionEditorProps,
  rootAria,
  sameAria,
  type TaskBoxDrawer,
} from "./contract.js";
import { diagramPreview } from "./diagram-preview.js";
import {
  documentManager,
  documentMarkdown,
  documentOpened,
  documentTook,
  type HeldSources,
  lineEndingOf,
  RawBlock,
  sourcesOf,
  withLf,
  withLineEnding,
} from "./document-source.js";
import { mentionNode, pastedMention } from "./mention-node.js";
import {
  copiedPictures,
  droppedPictures,
  laidInPictures,
  pastedPictures,
  pictureNode,
  removedPicture,
  settledPicture,
} from "./picture-node.js";
import { descriptionMentions } from "./description-mentions.js";
import { descriptionSlash } from "./description-slash.js";
import { editorFormatting, formatReports } from "./writing-format.js";
import { blockRulesOutOfCells, withoutTipTapChords, writingKeys } from "./writing-keys.js";

const COMPOSING_KEY_CODE = 229;

const EDITOR_CLASS = "description-document-text";

const LINE_PLACEHOLDER = "Write, or press / for blocks";

const HEADING_PLACEHOLDERS: ReadonlyMap<number, string> = new Map([
  [1, WRITING_SHORTCUTS[WRITING_BLOCK.HEADING_1].label],
  [2, WRITING_SHORTCUTS[WRITING_BLOCK.HEADING_2].label],
  [3, WRITING_SHORTCUTS[WRITING_BLOCK.HEADING_3].label],
]);

const SECTION_LEVELS = new Set([1, 2]);

const DocumentHeading = Heading.extend({
  renderHTML({ node }) {
    const level = Number(node.attrs.level);
    return [`h${level}`, { class: MARKDOWN_CLASS.HEADING, "data-level": String(level) }, 0];
  },
});

const DocumentParagraph = Paragraph.extend({
  parseMarkdown(token, helpers) {
    const tokens = token.tokens ?? [];
    if (tokens.length === 1 && tokens[0]?.type === "image") {
      return helpers.createNode("paragraph", undefined, helpers.parseInline(tokens));
    }
    return this.parent?.(token, helpers) ?? [];
  },
});

const EMPTY_TASK_WORDS = "&nbsp;";

const TASK_MARK_LENGTH = "- [ ] ".length;

const DocumentTaskItem = blockRulesOutOfCells(TaskItem).extend({
  addOptions() {
    const parent = this.parent?.();
    return {
      ...parent,
      nested: true,
      HTMLAttributes: { ...parent?.HTMLAttributes, class: MARKDOWN_CLASS.TASK_ITEM },
    };
  },
  parseMarkdown(token, helpers) {
    const empty = token.text === EMPTY_TASK_WORDS;
    return this.parent?.(empty ? { ...token, text: "", tokens: [] } : token, helpers) ?? [];
  },
  renderMarkdown(node, helpers, context) {
    const written = this.parent?.(node, helpers, context) ?? "";
    const [words] = node.content ?? [];
    const empty = words?.type === "paragraph" && (words.content ?? []).length === 0;
    if (!empty) return written;
    return written.slice(0, TASK_MARK_LENGTH) + EMPTY_TASK_WORDS + written.slice(TASK_MARK_LENGTH);
  },
});

const UNNAMED_TASK = "Task";

function taskBoxOf(node: PmNode, toggle: (checked: boolean) => void) {
  const words = node.firstChild?.textContent.trim() ?? "";
  return {
    label: words === "" ? UNNAMED_TASK : words,
    checked: node.attrs.checked === true,
    toggle,
  };
}

function drawnTaskView(tiptap: NodeViewRenderer, drawTaskBox: TaskBoxDrawer): NodeViewRenderer {
  return (props) => {
    const view = tiptap(props);
    const { editor, getPos } = props;
    const box = document.createElement("span");
    box.className = MARKDOWN_CLASS.TASK_BOX;
    box.contentEditable = "false";
    box.addEventListener("mousedown", (event) => event.preventDefault());
    view.dom.firstChild?.replaceWith(box);
    const toggle = (checked: boolean) => {
      const at = getPos();
      if (!editor.isEditable || typeof at !== "number") return;
      editor
        .chain()
        .focus(undefined, { scrollIntoView: false })
        .command(({ tr }) => {
          tr.setNodeMarkup(at, undefined, { ...tr.doc.nodeAt(at)?.attrs, checked });
          return true;
        })
        .run();
    };
    let drawn = taskBoxOf(props.node, toggle);
    let undraw = drawTaskBox(box, drawn);
    return {
      ...view,
      update: (node, decorations, inner) => {
        if (view.update?.(node, decorations, inner) !== true) return false;
        const next = taskBoxOf(node, toggle);
        if (next.label !== drawn.label || next.checked !== drawn.checked) {
          undraw();
          drawn = next;
          undraw = drawTaskBox(box, drawn);
        }
        return true;
      },
      stopEvent: (event) => event.target instanceof Node && box.contains(event.target),
      ignoreMutation: (mutation) => box.contains(mutation.target),
      destroy: () => {
        undraw();
        view.destroy?.();
      },
    };
  };
}

function drawnTaskItem(drawTaskBox: TaskBoxDrawer | undefined) {
  if (drawTaskBox === undefined) return DocumentTaskItem;
  return DocumentTaskItem.extend({
    addNodeView(this: { parent?: (() => NodeViewRenderer | null) | undefined }) {
      const tiptap = this.parent?.();
      return tiptap == null ? null : drawnTaskView(tiptap, drawTaskBox);
    },
  });
}

const MENTION_LINK_CLASS = "description-mention-link";

function linkLook(namesMention: ((target: string) => boolean) | undefined) {
  return Extension.create({
    name: "linkLook",
    addGlobalAttributes() {
      return [
        {
          types: ["link"],
          attributes: {
            look: {
              default: null,
              parseHTML: () => null,
              renderHTML: (attributes) => {
                const href = String(attributes.href ?? "");
                return namesMention?.(href) === true
                  ? { class: MENTION_LINK_CLASS }
                  : linkMarkAttributes(href);
              },
            },
          },
        },
      ];
    },
  });
}

export function markdownExtensions(
  drawMention?: MentionDrawer | undefined,
  namesMention?: ((target: string) => boolean) | undefined,
  pictures?: DescriptionEditorPictures | undefined,
  drawTaskBox?: TaskBoxDrawer | undefined,
): AnyExtension[] {
  const kit = StarterKit.configure({
    blockquote: { HTMLAttributes: { class: QUOTE_CLASS } },
    heading: false,
    paragraph: false,
    underline: false,
    trailingNode: false,
    link: { openOnClick: false },
  });
  return [
    blockRulesOutOfCells(withoutTipTapChords(kit)),
    withoutTipTapChords(DocumentParagraph),
    blockRulesOutOfCells(withoutTipTapChords(DocumentHeading)),
    Markdown,
    withoutTipTapChords(TaskList),
    drawnTaskItem(drawTaskBox),
    TableKit,
    pictureNode(pictures),
    RawBlock,
    mentionNode(drawMention),
    linkLook(namesMention),
    writingKeys,
  ];
}

function placeholderOf(description: string, offersBlocks: boolean) {
  return ({ editor, node }: { editor: Editor; node: PmNode }): string => {
    if (node.type.name === "heading")
      return HEADING_PLACEHOLDERS.get(Number(node.attrs.level)) ?? "";
    if (editor.isEmpty) return description;
    return offersBlocks && node.type.name === "paragraph" ? LINE_PLACEHOLDER : "";
  };
}

function opensSection(node: PmNode): boolean {
  return node.type.name === "heading" && SECTION_LEVELS.has(Number(node.attrs.level));
}

function sectionStarts(doc: PmNode): number[] {
  const starts: number[] = [0];
  doc.forEach((node, _offset, index) => {
    if (index > 0 && opensSection(node)) starts.push(index);
  });
  return starts;
}

function caretSection(editor: Editor): number {
  const index = editor.state.selection.$from.index(0);
  return sectionStarts(editor.state.doc).filter((start) => start <= index).length - 1;
}

function sectionBlocks(doc: PmNode, section: number): { first: number; next: number } | undefined {
  const starts = sectionStarts(doc);
  const first = starts[section];
  return first === undefined ? undefined : { first, next: starts[section + 1] ?? doc.childCount };
}

function inCode(text: Node): boolean {
  return text.parentElement?.closest("pre") != null;
}

function wordsAt(editor: Editor, words: PlacedWords): number | undefined {
  const { view } = editor;
  const blocks = sectionBlocks(view.state.doc, words.section);
  if (blocks === undefined) return undefined;
  let seen = 0;
  let found: number | undefined;
  view.state.doc.forEach((_node: PmNode, offset: number, index: number) => {
    const dom = view.nodeDOM(offset);
    if (found !== undefined || index < blocks.first || index >= blocks.next || dom === null) return;
    const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT);
    for (
      let text = walker.nextNode();
      text !== null && found === undefined;
      text = walker.nextNode()
    ) {
      if (text.textContent !== words.text || inCode(text) !== words.code) continue;
      if (seen === words.occurrence)
        found = view.posAtDOM(text, Math.min(words.offset, words.text.length));
      seen += 1;
    }
  });
  return found;
}

function caretText(editor: Editor): { text: Text; offset: number } | undefined {
  const { node, offset } = editor.view.domAtPos(editor.state.selection.head);
  if (node instanceof Text) return { text: node, offset };
  const after = node.childNodes[offset];
  if (after instanceof Text) return { text: after, offset: 0 };
  const before = node.childNodes[offset - 1];
  return before instanceof Text ? { text: before, offset: before.data.length } : undefined;
}

function caretWords(editor: Editor): PlacedWords | undefined {
  const { view } = editor;
  const at = caretText(editor);
  const section = caretSection(editor);
  const blocks = sectionBlocks(view.state.doc, section);
  if (at === undefined || blocks === undefined) return undefined;
  const code = inCode(at.text);
  let occurrence = 0;
  let found = false;
  view.state.doc.forEach((_node: PmNode, offset: number, index: number) => {
    const dom = view.nodeDOM(offset);
    if (found || index < blocks.first || index >= blocks.next || dom === null) return;
    const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text !== null && !found; text = walker.nextNode()) {
      if (text === at.text) found = true;
      else if (text.textContent === at.text.data && inCode(text) === code) occurrence += 1;
    }
  });
  if (!found) return undefined;
  try {
    const { top } = view.coordsAtPos(view.state.selection.head);
    return { section, text: at.text.data, occurrence, offset: at.offset, code, top };
  } catch {
    return undefined;
  }
}

function placedOnWords(
  editor: Editor,
  placement: DescriptionEditorPlacement | undefined,
): Selection | undefined {
  const click = placement !== undefined && "x" in placement ? placement : undefined;
  const at = click?.words === undefined ? undefined : wordsAt(editor, click.words);
  if (at === undefined) return undefined;
  const from = click?.from === undefined ? undefined : wordsAt(editor, click.from);
  const { doc } = editor.state;
  return from === undefined || from === at
    ? TextSelection.near(doc.resolve(at))
    : TextSelection.between(doc.resolve(from), doc.resolve(at));
}

function placed(editor: Editor, placement: DescriptionEditorPlacement | undefined): Selection {
  const { doc } = editor.state;
  if (placement === undefined) return Selection.atStart(doc);
  if ("end" in placement) return Selection.atEnd(doc);
  if ("x" in placement) {
    const point = editor.view.posAtCoords({ left: placement.x, top: placement.y });
    return point === null ? Selection.atStart(doc) : TextSelection.near(doc.resolve(point.pos));
  }
  const starts = sectionStarts(doc);
  const next = starts[placement.section + 1];
  let end = doc.content.size;
  if (next !== undefined) {
    end = 0;
    doc.forEach((_node, offset, index) => {
      if (index === next) end = offset;
    });
  }
  return TextSelection.near(doc.resolve(end), -1);
}

function heldAcrossMarks(before: PmNode, after: PmNode, held: HeldSources): HeldSources {
  if (before === after) return held;
  const sources = new Map<PmNode, string>();
  after.forEach((node, _offset, index) => {
    const source = held.sources.get(before.child(index));
    if (source !== undefined) sources.set(node, source);
  });
  return { ...held, sources };
}

export function mountDescriptionEditor(
  host: HTMLElement,
  props: DescriptionEditorProps,
): DescriptionEditorHandle {
  const {
    markdown,
    placement,
    focus,
    label,
    placeholder = DESCRIPTION_PLACEHOLDER,
    className,
    onDraft,
    onFinish,
    sendsOnEnter = false,
    onLeaveUp,
    mentions,
    drawDiagram,
    drawTaskBox,
    pictures,
    anchors,
    format,
    blocks,
  } = props;
  const extensions = markdownExtensions(
    mentions?.drawMention,
    mentions?.namesMention,
    pictures,
    drawTaskBox,
  );
  const manager = documentManager(extensions);
  let held: HeldSources = { sources: new Map(), lead: "", ending: "" };
  const picking =
    mentions === undefined
      ? undefined
      : descriptionMentions(manager, (node) => held.sources.get(node), mentions);
  const slash =
    blocks === undefined
      ? undefined
      : descriptionSlash(blocks, (markdown) => manager.parse(markdown).content ?? []);
  const ending = lineEndingOf(markdown);
  const source = withLf(markdown);
  const written = () => withLineEnding(documentMarkdown(manager, editor.state.doc, held), ending);
  const opened = documentOpened(manager, source);
  held = { sources: new Map(), lead: opened.lead, ending: opened.ending };
  let carried: readonly string[] = [];
  let laying = false;
  let breaking = false;
  let aria: EditorAria = {};
  const editor: Editor = new Editor({
    element: host,
    injectCSS: false,
    extensions: [
      ...extensions,
      Placeholder.configure({ placeholder: placeholderOf(placeholder, blocks !== undefined) }),
      commentAnchorMark,
      ...(drawDiagram === undefined ? [] : [diagramPreview(drawDiagram)]),
      ...formatReports(format),
    ],
    content: opened.content,
    contentType: "json",
    editorProps: {
      attributes: () => ({
        class: `${className} ${EDITOR_CLASS}`,
        ...rootAria(aria),
        "aria-label": label,
      }),
      handlePaste: (view, event) => {
        if (pictures !== undefined && pastedPictures(view, event, pictures)) return true;
        return mentions === undefined ? false : pastedMention(view, event, mentions.pasted);
      },
      handleDrop: (view, event, _slice, moved) =>
        pictures === undefined ? false : droppedPictures(view, event, moved, pictures),
      transformPasted: (slice) =>
        pictures === undefined ? slice : copiedPictures(slice, pictures),
      handleKeyDown: (view, event) => {
        if (
          breaking ||
          event.isComposing ||
          view.composing ||
          event.keyCode === COMPOSING_KEY_CODE
        ) {
          return false;
        }
        if (mentions?.onKey(event) === true) return true;
        if (blocks?.onKey(event) === true) return true;
        if (event.key === "Escape") {
          onFinish(caretSection(editor), FINISH.ESCAPE);
          return true;
        }
        if (sendsOnEnter ? enterSends(event) : modEnterSends(event)) {
          onFinish(caretSection(editor), FINISH.SUBMIT);
          return true;
        }
        if (sendsOnEnter && event.key === "Enter" && event.shiftKey) {
          breaking = true;
          editor.commands.keyboardShortcut("Enter");
          breaking = false;
          return true;
        }
        const { selection } = view.state;
        const first = selection.empty && selection.$from.index(0) === 0;
        if (onLeaveUp === undefined || event.key !== "ArrowUp" || !first) return false;
        if (!view.endOfTextblock("up")) return false;
        onLeaveUp();
        return true;
      },
    },
    onUpdate: ({ editor: updated }) => {
      if (laying) return;
      const markdown = written();
      onDraft(
        markdown,
        carried.length === 0 ? undefined : anchorsOf(updated.state.doc, markdown, carried),
      );
    },
  });
  laying = true;
  carried =
    anchors === undefined
      ? []
      : anchorsLaidIn(editor, markdown, anchors, new Set(anchors.map(({ thread }) => thread)), []);
  laying = false;
  if (picking !== undefined) editor.registerPlugin(picking.plugin);
  if (slash !== undefined) editor.registerPlugin(slash.plugin);
  held = sourcesOf(editor.state.doc, opened);
  const onWords = placedOnWords(editor, placement);
  editor.view.dispatch(editor.state.tr.setSelection(onWords ?? placed(editor, placement)));
  let onWordsAs = onWords === undefined ? undefined : editor.state;
  if (focus) editor.view.focus();
  return {
    ...editorFormatting(editor),
    take: (sent, merged) => {
      const answer = documentTook(editor, manager, held, withLf(sent), withLf(merged));
      held = answer.held;
      return { base: withLineEnding(answer.base, ending), text: written() };
    },
    chooseMention: (mention) => picking?.choose(editor, mention),
    insertBlock: (block) => slash?.insert(editor, block),
    markdown: written,
    replaceAnchors: (text, next, open) => {
      if (editor.isDestroyed) return;
      const before = editor.state.doc;
      laying = true;
      carried = anchorsLaidIn(editor, text, next ?? [], new Set(open), carried);
      laying = false;
      held = heldAcrossMarks(before, editor.state.doc, held);
    },
    setAria: (next) => {
      if (sameAria(aria, next) || editor.isDestroyed) return;
      aria = next;
      if (!editor.view.composing) editor.view.updateState(editor.state);
    },
    focusAt: (placement) => {
      onWordsAs = undefined;
      const selection = placedOnWords(editor, placement) ?? placed(editor, placement);
      editor.view.dispatch(editor.state.tr.setSelection(selection));
      editor.view.focus();
    },
    wordsTop: () => {
      const { doc, selection } = editor.state;
      if (onWordsAs === undefined || doc !== onWordsAs.doc || !selection.eq(onWordsAs.selection)) {
        return undefined;
      }
      try {
        return editor.view.coordsAtPos(editor.state.selection.head).top;
      } catch {
        return undefined;
      }
    },
    caretWords: () => caretWords(editor),
    insertPictures: (files) => {
      if (pictures !== undefined) laidInPictures(editor.view, files, pictures);
    },
    settlePicture: (upload, src) => settledPicture(editor.view, upload, src),
    removePicture: (upload) => removedPicture(editor.view, upload),
    selectionSpan: () => {
      const { from, to, empty } = editor.state.selection;
      return empty ? undefined : editorSpan(editor, written(), from, to);
    },
    blockSpan: (element) => {
      const { doc } = editor.state;
      const at = editor.view.posAtDOM(element, 0);
      const resolved = doc.resolve(Math.min(Math.max(at, 0), doc.content.size));
      if (resolved.depth < 1) return undefined;
      for (let depth = resolved.depth; depth >= 1; depth -= 1) {
        const node = resolved.node(depth);
        if (LIST_ITEMS.has(node.type.name)) {
          const start = resolved.start(depth);
          const own = node.firstChild?.nodeSize ?? node.content.size;
          return editorSpan(editor, written(), start, start + own);
        }
      }
      return editorSpan(editor, written(), resolved.before(1), resolved.after(1));
    },
    destroy: () => editor.destroy(),
  };
}

const LIST_ITEMS: ReadonlySet<string> = new Set(["listItem", "taskItem"]);

function editorSpan(
  editor: Editor,
  text: string,
  from: number,
  to: number,
): EditorSpan | undefined {
  const { doc } = editor.state;
  const span = spanIn(doc, text, from, to);
  const quote = doc.textBetween(from, to, "\n", "\uFFFC").trim();
  return span === undefined || quote === "" ? undefined : { ...span, quote, text };
}
