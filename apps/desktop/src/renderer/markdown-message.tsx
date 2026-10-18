import { gluedRun, LINK_GLUE } from "@luke/ui/link-glue";
import { QUOTE_CLASS } from "@luke/ui/quote-face";
import { matchRanges } from "@luke/ui/search-tokens";
import { isWireString } from "@luke/wire";
import { createContext, type ReactNode, useContext, useMemo, useRef } from "react";
import Markdown, { type AllowElement, type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import { PlanDiagram } from "./plan-diagram";
import { TextLink } from "./text-link";

const SAFE_LINK = /^https?:\/\//i;

/**
 * The library's own tree types, read off the hook it hands them to rather
 * than declared again or pulled in as a dependency of their own: the tree
 * root or an element, an element, an element's child, and a run of text.
 */
type HastParent = NonNullable<Parameters<AllowElement>[2]>;
type HastNode = HastParent["children"][number];
type HastChild = Parameters<AllowElement>[0]["children"][number];
type HastText = Extract<HastNode, { type: "text" }>;

/** A stretch of the words, from one offset up to another. */
interface MarkdownSpan {
  from: number;
  to: number;
}

/** How a stretch of the words is marked as a change: written in, or struck out. */
export const MARKDOWN_MARK = {
  INSERTED: "inserted",
  DELETED: "deleted",
} as const;

type MarkdownMarkKind = (typeof MARKDOWN_MARK)[keyof typeof MARKDOWN_MARK];

/** A stretch of the words marked as a change. */
export interface MarkdownMark extends MarkdownSpan {
  kind: MarkdownMarkKind;
}

/**
 * A message drawn mid-edit: a stretch of its words left undrawn (typed in
 * but not reached yet, or being erased), a stretch drawn selected, where the
 * caret stands, and the stretches marked as written in or struck out, which
 * do not overlap. Offsets are in the words.
 */
export interface MarkdownEdit {
  hidden?: MarkdownSpan | undefined;
  selection?: MarkdownSpan | undefined;
  caret?: number | undefined;
  marks?: readonly MarkdownMark[] | undefined;
}

/** The caret a typed message ends in: a bar with no words of its own. */
const CARET: HastChild = {
  type: "element",
  tagName: "span",
  properties: { className: ["markdown-caret"], ariaHidden: "true" },
  children: [],
};

/** The class the stretch being selected wears, drawn as an editor draws a selection. */
const SELECTION_CLASS = "markdown-selection";

/** The element and class each kind of change mark is drawn as, so it reads as a change without its colour. */
const MARK_DRAWN = {
  [MARKDOWN_MARK.INSERTED]: { tagName: "ins", className: "markdown-inserted" },
  [MARKDOWN_MARK.DELETED]: { tagName: "del", className: "markdown-deleted" },
} as const satisfies Record<MarkdownMarkKind, { tagName: string; className: string }>;

/** Whether a node is the line break the renderer leaves between block elements, which draws nothing. */
function isBlockBreak(node: HastNode): boolean {
  return node.type === "text" && node.value.trim() === "";
}

/** The innermost element the drawing ends in, past any block breaks, where the caret goes. */
function lastParent(parent: HastParent): HastParent {
  const last = parent.children.findLast((child) => !isBlockBreak(child));
  return last?.type === "element" && last.children.length > 0 ? lastParent(last) : parent;
}

/** One walk's edit, with the caret's offset still to place and whether it has been placed. */
interface EditWalk {
  readonly edit: MarkdownEdit;
  /** The words' length, where a stretch hidden to the end takes the breaks after it too. */
  readonly end: number;
  caretPlaced: boolean;
}

/** Whether the stretch from `start` to `end` lies wholly inside the hidden one; a point at the hidden end counts only at the words' end. */
function insideHidden(walk: EditWalk, start: number, end: number): boolean {
  const hidden = walk.edit.hidden;
  if (hidden === undefined || hidden.from >= hidden.to) return false;
  if (start === end) return start >= hidden.from && (start < hidden.to || hidden.to === walk.end);
  return start >= hidden.from && end <= hidden.to;
}

/**
 * One run of text cut into what is drawn: the hidden stretch dropped, the
 * selected stretch and each change marked, and the caret set in where it falls. A run's
 * place in the words maps letter for letter onto its value, which an escaped
 * character puts one letter off, the same small error the cut always made.
 */
function editedText(text: HastText, start: number, walk: EditWalk): readonly HastChild[] {
  const { hidden, selection, caret, marks = [] } = walk.edit;
  const local = (offset: number) => Math.min(Math.max(offset - start, 0), text.value.length);
  const cuts = new Set([0, text.value.length]);
  for (const span of [hidden, selection, ...marks]) {
    if (span !== undefined) cuts.add(local(span.from)).add(local(span.to));
  }
  const caretAt = caret === undefined || walk.caretPlaced ? undefined : local(caret);
  if (caretAt !== undefined) cuts.add(caretAt);
  const bounds = [...cuts].sort((left, right) => left - right);
  const parts: HastChild[] = [];
  bounds.forEach((from, index) => {
    if (from === caretAt) {
      parts.push(structuredClone(CARET));
      walk.caretPlaced = true;
    }
    const to = bounds[index + 1];
    if (to === undefined || to === from) return;
    const value = text.value.slice(from, to);
    if (hidden !== undefined && from >= local(hidden.from) && to <= local(hidden.to)) return;
    const selected =
      selection !== undefined && from >= local(selection.from) && to <= local(selection.to);
    const mark = marks.find((each) => from >= local(each.from) && to <= local(each.to));
    const drawn = mark === undefined ? undefined : MARK_DRAWN[mark.kind];
    parts.push(
      selected
        ? {
            type: "element",
            tagName: "mark",
            properties: { className: [SELECTION_CLASS] },
            children: [{ type: "text", value }],
          }
        : drawn !== undefined
          ? {
              type: "element",
              tagName: drawn.tagName,
              properties: { className: [drawn.className] },
              children: [{ type: "text", value }],
            }
          : { type: "text", value },
    );
  });
  return parts;
}

/**
 * A picture inside the change mark that covers it whole, so a picture
 * written in or struck out reads as the change it is; one no mark covers is
 * left as it is, since a picture holds no words to cut.
 */
function markedPicture(picture: HastNode, start: number, end: number, walk: EditWalk): HastNode {
  const mark = walk.edit.marks?.find((each) => each.from <= start && end <= each.to);
  if (mark === undefined || picture.type !== "element") return picture;
  const drawn = MARK_DRAWN[mark.kind];
  return {
    type: "element",
    tagName: drawn.tagName,
    properties: { className: [drawn.className] },
    children: [picture],
  };
}

/**
 * Draws an edit over a parent's children in place. Every node carries its
 * place in the words, so the edit is made on the drawn tree rather than on
 * the Markdown, and a half-typed emphasis or list is still drawn whole. The
 * breaks between blocks carry no place of their own and take the gap they
 * stand in. The caret goes in the first run of text that reaches its offset,
 * or into the innermost element holding it when no run does, as in a list
 * item typed as far as its marker.
 */
function editChildren(
  parent: HastParent,
  parentStart: number,
  parentEnd: number,
  walk: EditWalk,
): void {
  const original = [...parent.children];
  const kept: HastNode[] = [];
  original.forEach((child, index) => {
    const start = child.position?.start.offset;
    const end = child.position?.end.offset;
    if (start === undefined || end === undefined) {
      const gapStart = original.slice(0, index).findLast((node) => node.position)?.position;
      const gapEnd = original.slice(index + 1).find((node) => node.position)?.position;
      const from = gapStart?.end.offset ?? parentStart;
      const to = gapEnd?.start.offset ?? parentEnd;
      if (!insideHidden(walk, from, Math.max(from, to))) kept.push(child);
      return;
    }
    if (end > start && insideHidden(walk, start, end)) return;
    if (child.type === "text") {
      const reaches = walk.edit.caret !== undefined && walk.edit.caret <= end;
      kept.push(
        ...editedText(child, start, { ...walk, caretPlaced: walk.caretPlaced || !reaches }),
      );
      if (reaches) walk.caretPlaced = true;
      return;
    }
    if (child.type === "element" && child.tagName === "img") {
      kept.push(markedPicture(child, start, end, walk));
      return;
    }
    if (child.type === "element") {
      editChildren(child, start, end, walk);
      const caret = walk.edit.caret;
      if (!walk.caretPlaced && caret !== undefined && start <= caret && caret <= end) {
        child.children.push(structuredClone(CARET));
        walk.caretPlaced = true;
      }
    }
    kept.push(child);
  });
  // SAFETY: every node kept is one of this parent's own children, or a run of
  // text, a mark, or the caret cut from one, each a child any parent holds.
  parent.children.splice(0, original.length, ...(kept as typeof parent.children));
}

/** The lines a fenced block opens on. */
const FENCE_OPENINGS = ["```", "~~~"] as const;

/** Whether a run of text inside a block is that block's code. */
function isCodeOf(parent: HastParent, code: HastElement): boolean {
  return parent.type === "element" && parent.tagName === "pre" && code.tagName === "code";
}

/**
 * Gives each fenced block's code its place in the words, which the tree
 * leaves off the run of text the code is, so an edit marks, hides, and
 * places the caret inside code as it does anywhere else. A fence's code is
 * the words letter for letter from the line after its opening one, unless
 * it stands in a list or a quote, whose lines lose their indent; a code that
 * does not read back from there keeps no place, and is drawn whole.
 */
function placeFencedCode(parent: HastParent, words: string): void {
  for (const child of parent.children) {
    if (child.type !== "element") continue;
    const opened = child.position?.start;
    const [text, ...rest] = child.children;
    if (!isCodeOf(parent, child) || opened?.offset === undefined) {
      placeFencedCode(child, words);
      continue;
    }
    if (text?.type !== "text" || rest.length > 0 || text.position !== undefined) continue;
    const fenced = FENCE_OPENINGS.some((opening) => words.startsWith(opening, opened.offset));
    const from = words.indexOf("\n", opened.offset) + 1;
    if (!fenced || from === 0 || !words.startsWith(text.value, from)) continue;
    const lines = text.value.split("\n");
    text.position = {
      start: { line: opened.line + 1, column: 1, offset: from },
      end: {
        line: opened.line + lines.length,
        column: (lines.at(-1)?.length ?? 0) + 1,
        offset: from + text.value.length,
      },
    };
  }
}

/** The rehype step that draws a message mid-edit, the caret at the end of the drawing when its offset falls past every run. */
const drawEdit =
  (edit: MarkdownEdit, words: string) =>
  (tree: HastParent): void => {
    const end = words.length;
    const walk: EditWalk = { edit, end, caretPlaced: false };
    placeFencedCode(tree, words);
    editChildren(tree, 0, end, walk);
    if (edit.caret !== undefined && !walk.caretPlaced) {
      lastParent(tree).children.push(structuredClone(CARET));
    }
  };

/** An element of the tree, and what it may hold. */
type HastElement = Extract<HastNode, { type: "element" }>;
type HastElementChild = HastElement["children"][number];

/** The class a search's words are marked with, as `search-field.tsx`'s `Highlighted` marks them. */
const SEARCH_MATCH_CLASS = "search-match";

/** One run of text with the words a search asks for marked where they landed. */
function foundIn(text: HastText, tokens: readonly string[]): readonly HastElementChild[] {
  const ranges = matchRanges(text.value, tokens);
  if (ranges.length === 0) return [text];
  const parts: HastElementChild[] = [];
  let from = 0;
  for (const range of ranges) {
    if (range.start > from)
      parts.push({ type: "text", value: text.value.slice(from, range.start) });
    parts.push({
      type: "element",
      tagName: "mark",
      properties: { className: [SEARCH_MATCH_CLASS] },
      children: [{ type: "text", value: text.value.slice(range.start, range.end) }],
    });
    from = range.end;
  }
  if (from < text.value.length) parts.push({ type: "text", value: text.value.slice(from) });
  return parts;
}

/** Marks a search's words in every run of text under an element. */
function markFoundIn(element: HastElement, tokens: readonly string[]): void {
  element.children = element.children.flatMap((child) => {
    if (child.type === "text") return foundIn(child, tokens);
    if (child.type === "element") markFoundIn(child, tokens);
    return [child];
  });
}

/** The rehype step that marks where a search's words landed, block by block; the breaks between blocks hold no words. */
const markFound =
  (tokens: readonly string[]) =>
  (tree: HastParent): void => {
    for (const child of tree.children) if (child.type === "element") markFoundIn(child, tokens);
  };

/** Whether a node is a link the place draws itself, a mention's chip say. */
function isDrawnLink(node: HastElementChild, link: LinkDrawer): boolean {
  if (node.type !== "element" || node.tagName !== "a") return false;
  const href = node.properties.href;
  // Note that a link whose label a change marks in part is drawn as words, which must still wrap (`drawnMarked`).
  if (marksOf(node) === LINK_MARKS.MIXED) return false;
  return isWireString(href) && link(href, labelOf(node)) !== undefined;
}

/** An element's children, and theirs, with each link the place draws itself held with the punctuation written against it (`link-glue.ts`). */
function gluedChildren(element: HastElement, link: LinkDrawer): HastElementChild[] {
  for (const child of element.children) {
    if (child.type === "element" && !isDrawnLink(child, link))
      child.children = gluedChildren(child, link);
  }
  return gluedRun<HastElementChild>(element.children, {
    held: (child) => isDrawnLink(child, link),
    text: (value) => ({ type: "text", value }),
    box: (inside) => ({
      type: "element",
      tagName: "span",
      properties: { className: [LINK_GLUE.CLASS] },
      children: inside,
    }),
    markWords: (child) => (isMark(child) ? wordsOf(child) : undefined),
  });
}

/** The rehype step that holds every drawn link with the punctuation written against it, so a comma never starts a line alone after a chip. */
const glueDrawnLinks =
  (link: LinkDrawer) =>
  (tree: HastParent): void => {
    for (const child of tree.children) {
      if (child.type === "element") child.children = gluedChildren(child, link);
    }
  };

/** A task item's checkbox as drawn: the offset its item starts at in the words, and the item's own words, which name it. */
interface TaskItem {
  readonly at: number;
  readonly label: string;
}

/** Each task item's checkbox, by the tree's own node. */
const TASK_ITEMS = new WeakMap<HastElement, TaskItem>();

/** A list item's own words, a picture's alt text among them, without the words of a list nested in it. */
function itemWords(node: HastElementChild): string {
  if (node.type === "text") return node.value;
  if (node.type !== "element" || node.tagName === "ul" || node.tagName === "ol") return "";
  if (node.tagName === "img") return isWireString(node.properties.alt) ? node.properties.alt : "";
  return node.children.map(itemWords).join("");
}

/**
 * Gives each task item's checkbox the offset its list item starts at in the
 * words, its marker's, which the tree keeps on the item and not on the box,
 * and the item's words as its name. Note that the nearest item is the box's
 * own, so a nested list's box names its own item rather than the one around it.
 */
function placeTasks(parent: HastParent, item: HastElement | undefined): void {
  for (const child of parent.children) {
    if (child.type !== "element") continue;
    const own = child.tagName === "li" ? child : item;
    const at = own?.position?.start.offset;
    if (
      child.tagName === "input" &&
      child.properties.type === "checkbox" &&
      own &&
      at !== undefined
    ) {
      TASK_ITEMS.set(child, { at, label: own.children.map(itemWords).join("").trim() });
    }
    placeTasks(child, own);
  }
}

/** The rehype step that names each task item's checkbox by its item's offset. */
const placeTaskItems = () => (tree: HastParent) => placeTasks(tree, undefined);

/**
 * Ticks or clears the task item whose marker starts at an offset in the
 * words, answering whether the change was saved.
 */
export type TaskToggler = (at: number) => Promise<boolean>;

/**
 * A task item's checkbox that ticks or clears its item. It flips at the
 * press, since the words come back changed only once the change is saved,
 * and flips back where it was not. Note that it is keyed by the words' own
 * state, so a change arriving from anyone redraws it from the words.
 */
function TaskBox({
  item,
  checked,
  toggle,
}: {
  item: TaskItem;
  checked: boolean;
  toggle: TaskToggler;
}): React.JSX.Element {
  return (
    <input
      key={String(checked)}
      type="checkbox"
      aria-label={item.label}
      defaultChecked={checked}
      onChange={(event) => {
        const box = event.currentTarget;
        toggle(item.at).then((saved) => {
          if (!saved) box.checked = checked;
        });
      }}
    />
  );
}

/**
 * GitHub's dialect, which is the one coding agents write: tables,
 * strikethrough, and task lists, with a single tilde left as the character it
 * is, so two home-directory paths in one sentence do not strike the words
 * between them.
 */
const REMARK_PLUGINS: Options["remarkPlugins"] = [[remarkGfm, { singleTilde: false }]];

/**
 * How each element is drawn where the library's default would say the wrong
 * thing on this surface.
 *
 * A link is drawn as a plain link (`text-link.tsx`), naming its destination
 * on hover. It is pressed only where the place showing the words hands an
 * opener (`openLink`), as the task's page, its versions, and Luke's notes
 * do; elsewhere, as in a caption, it is words going nowhere, so a message's
 * words become an action only where a reader expects a link to open. Only
 * HTTP and HTTPS destinations survive `urlTransform` below, so anything else
 * arrives here as words alone. A place that draws its own links
 * (`LinkDrawer`), one showing a plan's words or Luke's notes, draws a link
 * naming a mention as the chip that opens what it names before it is ever
 * drawn as a plain one.
 *
 * A heading is styled, never announced: a reader walking the document's
 * headings should meet the panel's, not a reply's. An image has no picture
 * to draw in a caption, so its alternative words stand in for it. A fence
 * is its code, and a Mermaid one draws as its diagram only where the place
 * showing the words asks for it (`diagrams`), as a plan's page does.
 */
const COMPONENTS: Components = {
  a: ({ href, children, node }) => plainLink(href, children, node, undefined),
  h1: ({ children }) => heading(1, children),
  h2: ({ children }) => heading(2, children),
  h3: ({ children }) => heading(3, children),
  h4: ({ children }) => heading(4, children),
  h5: ({ children }) => heading(5, children),
  h6: ({ children }) => heading(6, children),
  img: ({ alt }) => <>{alt ?? ""}</>,
  blockquote: ({ children }) => <blockquote className={QUOTE_CLASS}>{children}</blockquote>,
};

/** A web link as a plain link, pressed where an opener is handed; anything else as its words alone. */
function plainLink(
  href: string | undefined,
  children: ReactNode,
  link: HastParent | undefined,
  openLink: ((href: string) => void) | undefined,
): ReactNode {
  if (href === undefined || !SAFE_LINK.test(href)) return children;
  return (
    <TextLink href={href} words={plainLabelOf(link)} onOpen={openLink}>
      {children}
    </TextLink>
  );
}

/**
 * Draws a link the place showing the words knows better than as words, a
 * mention's chip (`tasks/mention-chip.tsx`) say, from its destination
 * and its label's words; nothing for one it leaves drawn as any link is.
 */
export type LinkDrawer = (href: string, label: string) => ReactNode | undefined;

/**
 * Draws a picture the place showing the words knows how to, a plan's say,
 * from its address, its alt text, and its title; nothing for one it leaves
 * drawn as its alt text, as every picture is where no drawer is handed.
 */
export type PictureDrawer = (
  src: string,
  alt: string,
  title: string | undefined,
) => ReactNode | undefined;

/** The marks a link's words wear, drawn mid-edit: none, one over every word, or a change inside its label. */
const LINK_MARKS = {
  NONE: "none",
  MIXED: "mixed",
} as const;

type LinkMarks =
  | (typeof LINK_MARKS)[keyof typeof LINK_MARKS]
  | (typeof MARK_DRAWN)[MarkdownMarkKind];

/** Whether a node is a change mark drawn over words. */
function isMark(node: HastNode): boolean {
  return (
    node.type === "element" &&
    Object.values(MARK_DRAWN).some((mark) => mark.tagName === node.tagName)
  );
}

/** The marks a link's words wear: none, the one every word wears, or a change inside the label. */
function marksOf(link: HastParent | undefined): LinkMarks {
  const drawn = (link?.children ?? []).filter((child) => !isBlockBreak(child));
  if (!drawn.some(isMark)) return LINK_MARKS.NONE;
  const first = drawn[0];
  const mark = Object.values(MARK_DRAWN).find(
    (each) => first?.type === "element" && each.tagName === first.tagName,
  );
  const whole =
    mark !== undefined &&
    drawn.every((child) => child.type === "element" && child.tagName === mark.tagName);
  return whole ? mark : LINK_MARKS.MIXED;
}

/**
 * A link the place knows how to draw, a mention's chip say, drawn with the
 * change marks its words wore: a chip in the mark every word wore, so a
 * mention written in or struck out in a version reads as the change it is;
 * and, where the change is inside its label, the link drawn as words with
 * its marks, since one chip would join the words struck out and written in
 * into one name and hide what changed.
 */
function drawnMarked(
  drawn: ReactNode,
  link: HastParent | undefined,
  href: string,
  children: ReactNode,
  openLink: ((href: string) => void) | undefined,
): ReactNode {
  const marks = marksOf(link);
  if (marks === LINK_MARKS.NONE) return drawn;
  if (marks === LINK_MARKS.MIXED) return plainLink(href, children, link, openLink);
  const Mark = marks.tagName;
  return <Mark className={marks.className}>{drawn}</Mark>;
}

/** The words under a node of the tree, however they are formatted: a heading's emphasis copied into a label still reads as its words. */
function wordsOf(node: HastParent | HastNode): string {
  if (node.type === "text") return node.value;
  if (!("children" in node)) return "";
  return node.children.map((child) => wordsOf(child)).join("");
}

/** A link's label as its words. */
function labelOf(link: HastParent | undefined): string {
  return link === undefined ? "" : wordsOf(link);
}

/** A link's label as its words where it is words alone; nothing where an edit or a change marks inside it. */
function plainLabelOf(link: HastParent | undefined): string | undefined {
  const marked = link?.children.some((child) => child.type === "element") ?? false;
  return marked ? undefined : labelOf(link);
}

/** The class a fence's code wears when the fence names Mermaid as its language. */
const DIAGRAM_FENCE_CLASS = "language-mermaid";

/**
 * A fence's code where it may be drawn as its diagram: a Mermaid fence whose
 * code holds its words alone. Nothing for any other fence, or for one whose
 * code wears a change mark, the caret, a selection, or a search's match,
 * since a diagram drawn from marked words would hide what is marked, and
 * two diagrams side by side would hide what changed between them.
 */
function diagramCode(pre: HastElement | undefined): string | undefined {
  const [code, ...rest] = (pre?.children ?? []).filter((child) => !isBlockBreak(child));
  if (rest.length > 0 || code?.type !== "element" || code.tagName !== "code") return undefined;
  const classes = code.properties.className;
  if (!Array.isArray(classes) || !classes.includes(DIAGRAM_FENCE_CLASS)) return undefined;
  if (!code.children.every((child) => child.type === "text")) return undefined;
  // Note that the fence's closing line break is dropped, so the code is the editor's block's own and one picture serves both.
  return wordsOf(code).replace(/\n$/u, "");
}

/** The edit the words are drawn partway through, which a fence reads to know whether it is being changed. */
const FenceEdit = createContext<MarkdownEdit | undefined>(undefined);

/**
 * Whether an edit reaches into a block: a change mark, the caret, a
 * selection, or a stretch still hidden. Read off the block's own place, so
 * a fence whose code keeps no place of its own (`placeFencedCode`) is still
 * known to be changed.
 */
function editReaches(edit: MarkdownEdit | undefined, block: HastElement | undefined): boolean {
  const from = block?.position?.start.offset;
  const to = block?.position?.end.offset;
  if (edit === undefined || from === undefined || to === undefined) return false;
  if (edit.caret !== undefined && edit.caret >= from && edit.caret <= to) return true;
  const spans = [edit.hidden, edit.selection, ...(edit.marks ?? [])];
  return spans.some((span) => span !== undefined && span.from < to && span.to > from);
}

/** A fence drawn as its diagram where it may be, and as its code while an edit reaches into it. */
function DiagramFence({
  node,
  children,
}: {
  node?: HastElement | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  const edit = useContext(FenceEdit);
  const source = <pre>{children}</pre>;
  const code = editReaches(edit, node) ? undefined : diagramCode(node);
  return code === undefined ? source : <PlanDiagram code={code} source={source} />;
}

function heading(level: number, children: ReactNode): React.JSX.Element {
  return (
    <p className="markdown-heading" data-level={level}>
      {children}
    </p>
  );
}

function safeUrl(url: string): string {
  return SAFE_LINK.test(url) ? url : "";
}

function keptUrl(url: string): string {
  return url;
}

/**
 * A message's words drawn as the Markdown they were written in: inline emphasis, code, strikethrough, and web
 * links inside the paragraph, and the blocks a paragraph cannot hold —
 * headings, lists, quotes, fenced code, tables, rules — composed around it.
 * Raw HTML in the words is text. Every size in the stylesheet is in `em`, so
 * the same component reads at the caption's ten pixels and the plan's own
 * size.
 */
export function MarkdownMessage({
  words,
  className,
  edit,
  link,
  openLink,
  picture,
  found,
  diagrams,
  onTask,
}: {
  words: string;
  className?: string;
  /** The edit the words are drawn partway through; drawn whole without one. */
  edit?: MarkdownEdit | undefined;
  /** Draws the links the place knows better, a mention's chip say; every link is drawn as words without one. */
  link?: LinkDrawer | undefined;
  /** Opens a plain link pressed; every plain link is words going nowhere without one. */
  openLink?: ((href: string) => void) | undefined;
  /** Draws the pictures the place knows how to, a plan's say; every picture is its alt text without one. */
  picture?: PictureDrawer | undefined;
  /** The words a search asks for, marked where they landed. */
  found?: readonly string[] | undefined;
  /** Whether a Mermaid fence draws as its diagram, as on the plan's page and its versions; every fence is code without it. */
  diagrams?: boolean | undefined;
  /** Ticks or clears a task item pressed, as a plan the developer can edit does; every checkbox is read-only without it. */
  onTask?: TaskToggler | undefined;
}): React.JSX.Element {
  // Note that the toggler is read as a box is pressed, so a new one each render redraws nothing.
  const toggler = useRef(onTask);
  toggler.current = onTask;
  const toggles = onTask !== undefined;
  const rehypePlugins: NonNullable<Options["rehypePlugins"]> = [];
  if (toggles) rehypePlugins.push(placeTaskItems);
  if (edit !== undefined) rehypePlugins.push([drawEdit, edit, words]);
  if (found !== undefined && found.length > 0) rehypePlugins.push([markFound, found]);
  if (link !== undefined) rehypePlugins.push([glueDrawnLinks, link]);
  // Note that a place drawing its own links is handed every destination,
  // since only it knows which it draws; any it leaves is drawn as above,
  // so a destination that is not the web's is still words alone.
  const components = useMemo<Components>(() => {
    if (
      link === undefined &&
      openLink === undefined &&
      diagrams !== true &&
      picture === undefined &&
      !toggles
    ) {
      return COMPONENTS;
    }
    const drawing: Components = {
      ...COMPONENTS,
      a: ({ href, children, node }) => {
        const drawn =
          href === undefined || link === undefined ? undefined : link(href, labelOf(node));
        return drawn === undefined || href === undefined
          ? plainLink(href, children, node, openLink)
          : drawnMarked(drawn, node, href, children, openLink);
      },
    };
    if (diagrams === true) drawing.pre = DiagramFence;
    if (picture !== undefined) {
      drawing.img = ({ src, alt, title }) =>
        (isWireString(src) ? picture(src, alt ?? "", title) : undefined) ?? <>{alt ?? ""}</>;
    }
    if (toggles) {
      const toggle: TaskToggler = (at) => toggler.current?.(at) ?? Promise.resolve(false);
      drawing.input = ({ node, ...props }) => {
        const item = node === undefined ? undefined : TASK_ITEMS.get(node);
        return item === undefined ? (
          <input {...props} />
        ) : (
          <TaskBox item={item} checked={props.checked === true} toggle={toggle} />
        );
      };
    }
    return drawing;
  }, [link, openLink, diagrams, picture, toggles]);
  return (
    <div
      className={
        className === undefined ? "markdown luke-prose" : `markdown luke-prose ${className}`
      }
    >
      <FenceEdit.Provider value={edit}>
        <Markdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={rehypePlugins}
          components={components}
          urlTransform={link === undefined ? safeUrl : keptUrl}
        >
          {words}
        </Markdown>
      </FenceEdit.Provider>
    </div>
  );
}
