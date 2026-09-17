import type { ReactNode } from "react";
import Markdown, { type AllowElement, type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import { matchRanges } from "./session-model";

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

/** The class a marked stretch wears: the session rows' own, so a match reads the same everywhere. */
const MARK_CLASS = "row-match";

/**
 * One run of text with the query's words marked where they landed, as the
 * session rows mark theirs — the same ranges, so the two cannot disagree —
 * or the run as it was when none did.
 */
function markedText(text: HastText, tokens: readonly string[]): readonly HastChild[] {
  const ranges = matchRanges(text.value, tokens);
  if (ranges.length === 0) return [text];
  const parts: HastChild[] = [];
  let from = 0;
  for (const range of ranges) {
    if (range.start > from) {
      parts.push({ type: "text", value: text.value.slice(from, range.start) });
    }
    parts.push({
      type: "element",
      tagName: "mark",
      properties: { className: [MARK_CLASS] },
      children: [{ type: "text", value: text.value.slice(range.start, range.end) }],
    });
    from = range.end;
  }
  if (from < text.value.length) parts.push({ type: "text", value: text.value.slice(from) });
  return parts;
}

/**
 * Marks the query's words in every run of text under a node, code and
 * captions included, because a find that skipped a block would hide a match
 * the words say is there. Walked from the end so a run split into several
 * never moves the runs still to be read. A match spanning two runs — a word
 * in emphasis and the one after it — is not marked, since no single run
 * holds it.
 */
function markChildren(children: HastNode[], tokens: readonly string[]): void {
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (child === undefined) continue;
    if (child.type === "element") markChildren(child.children, tokens);
    else if (child.type === "text") children.splice(index, 1, ...markedText(child, tokens));
  }
}

/** The rehype step that marks a search's words in the drawn tree, run only while a search stands. */
const markMatches =
  (tokens: readonly string[]) =>
  (tree: HastParent): void => {
    markChildren(tree.children, tokens);
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
 * below, so anything else arrives here as words alone.
 *
 * A heading is styled, never announced: a reader walking the document's
 * headings should meet the panel's, not a reply's. An image has no picture
 * to draw in a caption, so its alternative words stand in for it.
 */
const COMPONENTS: Components = {
  a: ({ href, children }) =>
    href !== undefined && SAFE_LINK.test(href) ? (
      <span className="markdown-link" title={href}>
        {children}
      </span>
    ) : (
      children
    ),
  h1: ({ children }) => heading(1, children),
  h2: ({ children }) => heading(2, children),
  h3: ({ children }) => heading(3, children),
  h4: ({ children }) => heading(4, children),
  h5: ({ children }) => heading(5, children),
  h6: ({ children }) => heading(6, children),
  img: ({ alt }) => <>{alt ?? ""}</>,
};

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

/**
 * A message's words drawn as the Markdown they were written in, the way the
 * iOS app's bubbles draw them: inline emphasis, code, strikethrough, and web
 * links inside the paragraph, and the blocks a paragraph cannot hold —
 * headings, lists, quotes, fenced code, tables, rules — composed around it.
 * Raw HTML in the words is text. Every size in the stylesheet is in `em`, so
 * the same component reads at the caption's ten pixels and the thread's
 * twelve and a half.
 */
export function MarkdownMessage({
  words,
  className,
  highlight,
}: {
  words: string;
  className?: string;
  /** A search's words, marked wherever they land in the drawn text; nothing marks without one. */
  highlight?: readonly string[] | undefined;
}): React.JSX.Element {
  const rehypePlugins: Options["rehypePlugins"] =
    highlight !== undefined && highlight.length > 0 ? [[markMatches, highlight]] : undefined;
  return (
    <div className={className === undefined ? "markdown" : `markdown ${className}`}>
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={rehypePlugins}
        components={COMPONENTS}
        urlTransform={safeUrl}
      >
        {words}
      </Markdown>
    </div>
  );
}
