import type { Element as HastElement, Nodes, Properties, RootContent } from "hast";
import { toHtml as writeHast } from "hast-util-to-html";
import { styleElementSheets, touchesStyle } from "../style-element-sheets.js";

const INLINE_STYLE_ATTRIBUTE = "data-inline-style";

const INLINE_STYLE_PROPERTY = "dataInlineStyle";

type Tree = Nodes | RootContent[];

function restyledElement(element: HastElement): HastElement {
  const { style, ...rest } = element.properties;
  const properties: Properties =
    style === undefined || style === null ? rest : { ...rest, [INLINE_STYLE_PROPERTY]: style };
  const children = element.children.map((child) =>
    child.type === "element" ? restyledElement(child) : child,
  );
  return { ...element, properties, children };
}

function restyledContent(node: RootContent): RootContent {
  return node.type === "element" ? restyledElement(node) : node;
}

export function toHtml(tree: Tree, options?: Parameters<typeof writeHast>[1]): string {
  if (Array.isArray(tree)) return writeHast(tree.map(restyledContent), options);
  if (tree.type === "root") {
    return writeHast({ ...tree, children: tree.children.map(restyledContent) }, options);
  }
  return writeHast(tree.type === "element" ? restyledElement(tree) : tree, options);
}

/** @public */
export function hastToHtml(tree: Tree): string {
  return toHtml(tree);
}

function restyle(element: Element): void {
  const selector = `[${INLINE_STYLE_ATTRIBUTE}]`;
  const styled = element.matches(selector) ? [element] : [];
  for (const each of [...styled, ...element.querySelectorAll(selector)]) {
    if (!(each instanceof HTMLElement || each instanceof SVGElement)) continue;
    each.style.cssText = each.getAttribute(INLINE_STYLE_ATTRIBUTE) ?? "";
  }
}

export function adoptShadowStyles(root: ShadowRoot, look: CSSStyleSheet): () => void {
  const own = root.adoptedStyleSheets.filter((sheet) => sheet !== look);
  const sheets = styleElementSheets(root);
  const adopt = () => {
    root.adoptedStyleSheets = [...own, ...sheets(), look];
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) if (node instanceof Element) restyle(node);
    }
    if (records.some(touchesStyle)) adopt();
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  for (const child of root.children) restyle(child);
  adopt();
  return () => {
    observer.disconnect();
    root.adoptedStyleSheets = own;
  };
}
