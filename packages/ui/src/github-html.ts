import { githubImageOf } from "@repo/features/github-image";

type PropertyValue = string | number | boolean | readonly (string | number)[] | null | undefined;

interface HtmlNode {
  type: string;
  tagName?: string;
  properties?: Record<string, PropertyValue>;
  children?: HtmlNode[];
  value?: string;
}

interface MarkdownRoot {
  children: unknown[];
}

const HIGHLIGHT_LANGUAGE = /^highlight-(?:source|text)-(.+)$/u;

function classesOf(node: HtmlNode): readonly string[] {
  const named = node.properties?.className;
  return Array.isArray(named) ? named.map(String) : [];
}

function textOf(node: HtmlNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

function fenced(language: string, code: string): HtmlNode {
  return {
    type: "element",
    tagName: "pre",
    properties: {},
    children: [
      {
        type: "element",
        tagName: "code",
        properties: { className: [`language-${language}`] },
        children: [{ type: "text", value: code }],
      },
    ],
  };
}

const SUGGESTION_BLOB = "js-suggested-changes-blob";

export const SUGGESTED_CHANGE_LANGUAGE = "suggested-change";

const SUGGESTION_ROW = [
  ["blob-code-deletion", "-"],
  ["blob-code-addition", "+"],
] as const;

function elementsOf(node: HtmlNode): readonly HtmlNode[] {
  if (node.type !== "element") return [];
  return [node, ...(node.children ?? []).flatMap(elementsOf)];
}

function suggestion(blob: HtmlNode): HtmlNode {
  const lines = elementsOf(blob).flatMap((cell) => {
    if (cell.tagName !== "td") return [];
    const classes = classesOf(cell);
    const mark = SUGGESTION_ROW.find(([name]) => classes.includes(name))?.[1];
    return mark === undefined ? [] : [`${mark}${textOf(cell)}`];
  });
  return fenced(SUGGESTED_CHANGE_LANGUAGE, lines.join("\n"));
}

export function linksToPicture(href: string, src: string): boolean {
  return href !== "" && (href === src || githubImageOf(href) !== undefined);
}

function blank(node: HtmlNode): boolean {
  return node.type === "text" && (node.value ?? "").trim() === "";
}

function selfLinkedPicture(link: HtmlNode): HtmlNode | undefined {
  const held = (link.children ?? []).filter((child) => !blank(child));
  const picture = held[0];
  if (held.length !== 1 || picture?.type !== "element" || picture.tagName !== "img") {
    return undefined;
  }
  const href = String(link.properties?.href ?? "");
  return linksToPicture(href, String(picture.properties?.src ?? "")) ? picture : undefined;
}

function reshaped(node: HtmlNode): readonly HtmlNode[] {
  if (node.type !== "element") return [node];
  if (node.tagName === "source") return [];
  const picture = node.tagName === "a" ? selfLinkedPicture(node) : undefined;
  if (picture !== undefined) return [picture];
  const classes = classesOf(node);
  if (node.tagName === "div" && classes.includes(SUGGESTION_BLOB)) return [suggestion(node)];
  const named = node.tagName === "pre" ? node.properties?.lang : undefined;
  if (named !== undefined && named !== null) return [fenced(String(named), textOf(node))];
  const highlighted = classes.map((each) => HIGHLIGHT_LANGUAGE.exec(each)?.[1]).find(Boolean);
  if (node.tagName === "div" && highlighted !== undefined)
    return [fenced(highlighted, textOf(node))];
  node.children = reshapeChildren(node.children ?? []);
  return [node];
}

function reshapeChildren(children: readonly HtmlNode[]): HtmlNode[] {
  return children.flatMap(reshaped);
}

export function wholeRendering(): (tree: MarkdownRoot, file: { value: unknown }) => void {
  return (tree, file) => {
    tree.children = [{ type: "html", value: String(file.value) }];
  };
}

export function githubShapes(): (tree: HtmlNode) => void {
  return (tree) => {
    tree.children = reshapeChildren(tree.children ?? []);
  };
}
