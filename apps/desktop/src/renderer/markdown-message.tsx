import { type ReactNode, useMemo } from "react";
import Markdown, { type AllowElement, type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";

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

/** The rehype step that draws a message mid-edit, the caret at the end of the drawing when its offset falls past every run. */
const drawEdit =
  (edit: MarkdownEdit, end: number) =>
  (tree: HastParent): void => {
    const walk: EditWalk = { edit, end, caretPlaced: false };
    editChildren(tree, 0, end, walk);
    if (edit.caret !== undefined && !walk.caretPlaced) {
      lastParent(tree).children.push(structuredClone(CARET));
    }
  };

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
 * A link is drawn as one and names its destination on hover, but it is not a
 * control: the renderer refuses every navigation and has no door for opening
 * an arbitrary address, and a message's words must not become an action by
 * being pressed. Only HTTP and HTTPS destinations survive `urlTransform`
 * below, so anything else arrives here as words alone. The one exception is
 * a place that draws its own links (`LinkDrawer`): a plan's page draws a
 * mention as the chip that opens what it names.
 *
 * A heading is styled, never announced: a reader walking the document's
 * headings should meet the panel's, not a reply's. An image has no picture
 * to draw in a caption, so its alternative words stand in for it.
 */
const COMPONENTS: Components = {
  a: ({ href, children }) => plainLink(href, children),
  h1: ({ children }) => heading(1, children),
  h2: ({ children }) => heading(2, children),
  h3: ({ children }) => heading(3, children),
  h4: ({ children }) => heading(4, children),
  h5: ({ children }) => heading(5, children),
  h6: ({ children }) => heading(6, children),
  img: ({ alt }) => <>{alt ?? ""}</>,
};

/** A link as words drawn as one, naming a web destination on hover; anything else as its words alone. */
function plainLink(href: string | undefined, children: ReactNode): ReactNode {
  if (href === undefined || !SAFE_LINK.test(href)) return children;
  return (
    <span className="markdown-link" title={href}>
      {children}
    </span>
  );
}

/**
 * Draws a link the place showing the words knows better than as words, a
 * mention's chip (`planning/mention-chip.tsx`) say, from its destination
 * and its label's words; nothing for one it leaves drawn as any link is.
 */
export type LinkDrawer = (href: string, label: string) => ReactNode | undefined;

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
}: {
  words: string;
  className?: string;
  /** The edit the words are drawn partway through; drawn whole without one. */
  edit?: MarkdownEdit | undefined;
  /** Draws the links the place knows better, a mention's chip say; every link is drawn as words without one. */
  link?: LinkDrawer | undefined;
}): React.JSX.Element {
  const rehypePlugins: NonNullable<Options["rehypePlugins"]> = [];
  if (edit !== undefined) rehypePlugins.push([drawEdit, edit, words.length]);
  // Note that a place drawing its own links is handed every destination,
  // since only it knows which it draws; any it leaves is drawn as above,
  // so a destination that is not the web's is still words alone.
  const components = useMemo<Components>(
    () =>
      link === undefined
        ? COMPONENTS
        : {
            ...COMPONENTS,
            a: ({ href, children, node }) =>
              (href === undefined ? undefined : link(href, labelOf(node))) ??
              plainLink(href, children),
          },
    [link],
  );
  return (
    <div className={className === undefined ? "markdown" : `markdown ${className}`}>
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={rehypePlugins}
        components={components}
        urlTransform={link === undefined ? safeUrl : keptUrl}
      >
        {words}
      </Markdown>
    </div>
  );
}
