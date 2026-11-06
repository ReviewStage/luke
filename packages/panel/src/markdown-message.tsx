import { keySpansIn } from "@repo/features/workspace-key";
import { SEARCH_MATCH_CLASS } from "@repo/ui";
import { gluedRun, LINK_GLUE } from "@repo/ui/link-glue";
import {
  MARKDOWN_LOOK,
  Markdown,
  type MarkdownComponents,
  type MarkdownSteps,
  type MarkdownTaskBox,
  markdownStep,
} from "@repo/ui/markdown";
import { matchRanges } from "@repo/ui/search-tokens";
import { isWireString } from "@repo/wire";
import type { Element, ElementContent, Root, RootContent, Text } from "hast";
import { createContext, memo, type ReactNode, useContext, useMemo } from "react";
import { DescriptionDiagram } from "./description-diagram.js";
import { useWordTargets } from "./tasks/use-known-names.js";
import { TextLink } from "./text-link.js";

const SAFE_LINK = /^(?:https?:\/\/|mailto:)/i;

type HastParent = Root | Element;
type HastNode = RootContent;
type HastChild = ElementContent;
type HastText = Text;

export interface MarkdownSpan {
  from: number;
  to: number;
}

export const MARKDOWN_MARK = {
  INSERTED: "inserted",
  DELETED: "deleted",
  COMMENT: "comment",
} as const;

type MarkdownMarkKind = (typeof MARKDOWN_MARK)[keyof typeof MARKDOWN_MARK];

export interface MarkdownMark extends MarkdownSpan {
  kind: MarkdownMarkKind;
  thread?: string | undefined;
  active?: boolean | undefined;
  block?: boolean | undefined;
}

export interface MarkdownEdit {
  marks?: readonly MarkdownMark[] | undefined;
}

const MARK_DRAWN = {
  [MARKDOWN_MARK.INSERTED]: { tagName: "ins", className: "markdown-inserted" },
  [MARKDOWN_MARK.DELETED]: { tagName: "del", className: "markdown-deleted" },
  [MARKDOWN_MARK.COMMENT]: { tagName: "mark", className: "description-comment-mark" },
} as const satisfies Record<MarkdownMarkKind, { tagName: string; className: string }>;

function isBlockBreak(node: HastNode): boolean {
  return node.type === "text" && node.value.trim() === "";
}

function editedText(text: HastText, start: number, edit: MarkdownEdit): readonly HastChild[] {
  const { marks = [] } = edit;
  const local = (offset: number) => Math.min(Math.max(offset - start, 0), text.value.length);
  const cuts = new Set([0, text.value.length]);
  for (const span of marks) cuts.add(local(span.from)).add(local(span.to));
  const bounds = [...cuts].sort((left, right) => left - right);
  const parts: HastChild[] = [];
  bounds.forEach((from, index) => {
    const to = bounds[index + 1];
    if (to === undefined || to === from) return;
    const value = text.value.slice(from, to);
    const covering = marks.filter((each) => from >= local(each.from) && to <= local(each.to));
    const mark = covering.find((each) => each.kind !== MARKDOWN_MARK.COMMENT) ?? covering[0];
    const threads = covering.flatMap((each) =>
      each.kind === MARKDOWN_MARK.COMMENT && each.thread !== undefined ? [each.thread] : [],
    );
    const drawn = mark === undefined ? undefined : MARK_DRAWN[mark.kind];
    parts.push(
      drawn !== undefined
        ? {
            type: "element",
            tagName: drawn.tagName,
            properties: {
              className: [drawn.className],
              ...(threads.length === 0 ? undefined : { dataThreads: threads.join(" ") }),
              ...(covering.some((each) => each.active === true)
                ? { dataActive: "true" }
                : undefined),
            },
            children: [{ type: "text", value }],
          }
        : { type: "text", value },
    );
  });
  return parts;
}

function markedPicture(
  picture: HastNode,
  start: number,
  end: number,
  edit: MarkdownEdit,
): HastNode {
  const mark = edit.marks?.find((each) => each.from <= start && end <= each.to);
  if (mark === undefined || picture.type !== "element") return picture;
  const drawn = MARK_DRAWN[mark.kind];
  return {
    type: "element",
    tagName: drawn.tagName,
    properties: { className: [drawn.className] },
    children: [picture],
  };
}

function editChildren(parent: HastParent, edit: MarkdownEdit): void {
  const original = [...parent.children];
  const kept: HastNode[] = [];
  for (const child of original) {
    const start = child.position?.start.offset;
    const end = child.position?.end.offset;
    if (start === undefined || end === undefined) {
      kept.push(child);
      continue;
    }
    if (child.type === "text") {
      kept.push(...editedText(child, start, edit));
      continue;
    }
    if (child.type === "element" && child.tagName === "img") {
      kept.push(markedPicture(child, start, end, edit));
      continue;
    }
    if (child.type === "element") editChildren(child, edit);
    kept.push(child);
  }
  parent.children.splice(0, original.length, ...(kept as typeof parent.children));
}

const FENCE_OPENINGS = ["```", "~~~"] as const;

function isCodeOf(parent: HastParent, code: HastElement): boolean {
  return parent.type === "element" && parent.tagName === "pre" && code.tagName === "code";
}

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

const drawEdit =
  (edit: MarkdownEdit, words: string) =>
  (tree: HastParent): void => {
    placeFencedCode(tree, words);
    editChildren(tree, edit);
  };

type HastElement = Element;
type HastElementChild = ElementContent;

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
      properties: { className: SEARCH_MATCH_CLASS.split(" ") },
      children: [{ type: "text", value: text.value.slice(range.start, range.end) }],
    });
    from = range.end;
  }
  if (from < text.value.length) parts.push({ type: "text", value: text.value.slice(from) });
  return parts;
}

function markFoundIn(element: HastElement, tokens: readonly string[]): void {
  element.children = element.children.flatMap((child) => {
    if (child.type === "text") return foundIn(child, tokens);
    if (child.type === "element") markFoundIn(child, tokens);
    return [child];
  });
}

const markFound =
  (tokens: readonly string[]) =>
  (tree: HastParent): void => {
    for (const child of tree.children) if (child.type === "element") markFoundIn(child, tokens);
  };

const KEYLESS_TAGS: ReadonlySet<string> = new Set(["a", "code", "pre"]);

function keyedText(
  text: HastText,
  targets: ReadonlyMap<string, string>,
): readonly HastElementChild[] {
  const spans = keySpansIn(text.value, targets);
  if (spans.length === 0) return [text];
  const parts: HastElementChild[] = [];
  let from = 0;
  for (const span of spans) {
    if (span.start > from) parts.push({ type: "text", value: text.value.slice(from, span.start) });
    parts.push({
      type: "element",
      tagName: "a",
      properties: { href: span.known },
      children: [{ type: "text", value: span.key }],
    });
    from = span.end;
  }
  if (from < text.value.length) parts.push({ type: "text", value: text.value.slice(from) });
  return parts;
}

function linkKeysIn(element: HastElement, targets: ReadonlyMap<string, string>): void {
  element.children = element.children.flatMap((child) => {
    if (child.type === "text") return keyedText(child, targets);
    if (child.type === "element" && !KEYLESS_TAGS.has(child.tagName)) linkKeysIn(child, targets);
    return [child];
  });
}

const linkTaskKeys =
  (targets: ReadonlyMap<string, string>) =>
  (tree: HastParent): void => {
    for (const child of tree.children) {
      if (child.type === "element" && !KEYLESS_TAGS.has(child.tagName)) {
        linkKeysIn(child, targets);
      }
    }
  };

function isDrawnLink(node: HastElementChild, link: LinkDrawer): boolean {
  if (node.type !== "element" || node.tagName !== "a") return false;
  const href = node.properties.href;
  if (marksOf(node) === LINK_MARKS.MIXED) return false;
  return isWireString(href) && link(href, labelOf(node)) !== undefined;
}

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

const glueDrawnLinks =
  (link: LinkDrawer) =>
  (tree: HastParent): void => {
    for (const child of tree.children) {
      if (child.type === "element") child.children = gluedChildren(child, link);
    }
  };

const COMPONENTS: MarkdownComponents = {
  a: ({ href, children, node }) => plainLink(href, children, node, undefined),
};

const LINE_CODE: MarkdownComponents["code"] = ({ children }) => (
  <code className="transcript-inline-code">{children}</code>
);

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

export type LinkDrawer = (
  href: string,
  label: string,
  at?: MarkdownSpan | undefined,
) => ReactNode | undefined;

function writtenAt(node: HastParent | undefined): MarkdownSpan | undefined {
  const from = node?.position?.start.offset;
  const to = node?.position?.end.offset;
  return from === undefined || to === undefined ? undefined : { from, to };
}

export type PictureDrawer = (
  src: string,
  alt: string,
  title: string | undefined,
) => ReactNode | undefined;

const LINK_MARKS = {
  NONE: "none",
  MIXED: "mixed",
} as const;

type LinkMarks =
  | (typeof LINK_MARKS)[keyof typeof LINK_MARKS]
  | (typeof MARK_DRAWN)[MarkdownMarkKind];

function isMark(node: HastNode): boolean {
  return (
    node.type === "element" &&
    Object.values(MARK_DRAWN).some((mark) => mark.tagName === node.tagName)
  );
}

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
  const first = link?.children.find((child) => !isBlockBreak(child));
  const threads =
    first?.type === "element" && isWireString(first.properties.dataThreads)
      ? { "data-threads": first.properties.dataThreads }
      : undefined;
  const active =
    first?.type === "element" && first.properties.dataActive === "true"
      ? { "data-active": "true" }
      : undefined;
  return (
    <Mark className={marks.className} {...threads} {...active}>
      {drawn}
    </Mark>
  );
}

function wordsOf(node: HastParent | HastNode): string {
  if (node.type === "text") return node.value;
  if (!("children" in node)) return "";
  return node.children.map((child) => wordsOf(child)).join("");
}

function labelOf(link: HastParent | undefined): string {
  return link === undefined ? "" : wordsOf(link);
}

function plainLabelOf(link: HastParent | undefined): string | undefined {
  const marked = link?.children.some((child) => child.type === "element") ?? false;
  return marked ? undefined : labelOf(link);
}

const DIAGRAM_FENCE_CLASS = "language-mermaid";

function diagramCode(pre: HastElement | undefined): string | undefined {
  const [code, ...rest] = (pre?.children ?? []).filter((child) => !isBlockBreak(child));
  if (rest.length > 0 || code?.type !== "element" || code.tagName !== "code") return undefined;
  const classes = code.properties.className;
  if (!Array.isArray(classes) || !classes.includes(DIAGRAM_FENCE_CLASS)) return undefined;
  if (!code.children.every((child) => child.type === "text")) return undefined;
  return wordsOf(code).replace(/\n$/u, "");
}

const FenceEdit = createContext<MarkdownEdit | undefined>(undefined);

function editReaches(edit: MarkdownEdit | undefined, block: HastElement | undefined): boolean {
  const from = block?.position?.start.offset;
  const to = block?.position?.end.offset;
  if (edit === undefined || from === undefined || to === undefined) return false;
  return (edit.marks ?? []).some((span) => span.from < to && span.to > from);
}

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
  return code === undefined ? source : <DescriptionDiagram code={code} source={source} />;
}

function safeUrl(url: string): string {
  return SAFE_LINK.test(url) ? url : "";
}

function keptUrl(url: string): string {
  return url;
}

export const MarkdownMessage = memo(function MarkdownMessage({
  words,
  className,
  edit,
  link,
  openLink,
  picture,
  found,
  diagrams,
  taskBox,
  inline,
}: {
  words: string;
  className?: string;
  edit?: MarkdownEdit | undefined;
  link?: LinkDrawer | undefined;
  openLink?: ((href: string) => void) | undefined;
  picture?: PictureDrawer | undefined;
  found?: readonly string[] | undefined;
  diagrams?: boolean | undefined;
  taskBox?: MarkdownTaskBox | undefined;
  inline?: boolean | undefined;
}): React.JSX.Element {
  const keyTargets = useWordTargets();
  const rehypePlugins = useMemo(() => {
    const plugins: MarkdownSteps = [];
    if (edit !== undefined) plugins.push(markdownStep(drawEdit, edit, words));
    if (link !== undefined && keyTargets.size > 0) {
      plugins.push(markdownStep(linkTaskKeys, keyTargets));
    }
    if (found !== undefined && found.length > 0) plugins.push(markdownStep(markFound, found));
    if (link !== undefined) plugins.push(markdownStep(glueDrawnLinks, link));
    return plugins;
  }, [edit, words, found, link, keyTargets]);
  const components = useMemo<MarkdownComponents>(() => {
    if (
      link === undefined &&
      openLink === undefined &&
      diagrams !== true &&
      picture === undefined &&
      inline !== true
    ) {
      return COMPONENTS;
    }
    const drawing: MarkdownComponents = {
      ...COMPONENTS,
      ...(inline === true ? { code: LINE_CODE } : {}),
      a: ({ href, children, node }) => {
        const drawn =
          href === undefined || link === undefined
            ? undefined
            : link(href, labelOf(node), writtenAt(node));
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
    return drawing;
  }, [link, openLink, diagrams, picture, inline]);
  return (
    <FenceEdit.Provider value={edit}>
      <Markdown
        look={inline === true ? MARKDOWN_LOOK.INLINE : MARKDOWN_LOOK.NOTE}
        words={words}
        className={className}
        rehypePlugins={rehypePlugins}
        components={components}
        urlTransform={link === undefined ? safeUrl : keptUrl}
        taskBox={taskBox}
      />
    </FenceEdit.Provider>
  );
});
