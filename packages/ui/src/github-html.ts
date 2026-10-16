/**
 * github-html.ts -- GitHub's own rendering of a pull request's words (`body_html`), read into the window's markdown drawing: the steps that hand it over whole and shape what GitHub dresses its way into what the window draws its own.
 *
 * The window draws markdown through Streamdown, whose steps parse raw HTML
 * (`rehype-raw`), sanitize it to GitHub's own allowlist, and harden its
 * links, so GitHub's rendering is drawn through those same steps rather
 * than set as HTML: `wholeRendering` hands the words to them as one HTML
 * node, never as markdown, which would split the rendering at a blank line
 * inside a code block. `githubShapes` runs between the parse and the
 * sanitizer, while GitHub's classes still say what each part is, and
 * reshapes what GitHub dresses its way into what the window draws its own:
 * a highlighted block into a fenced one in its language, which the window
 * colours as it colours any (`transcript-markdown.tsx`), a diagram into a
 * fenced `mermaid` block of its source, and a heading's permalink, and the
 * wrappers around a heading or a block, taken out.
 */

/** A property's value as the parsed tree holds it: HTML's own attribute values. */
type PropertyValue = string | number | boolean | readonly (string | number)[] | null | undefined;

/** A node of the HTML tree as these steps read it. */
interface HtmlNode {
  type: string;
  tagName?: string;
  properties?: Record<string, PropertyValue>;
  children?: HtmlNode[];
  value?: string;
}

/** The markdown tree's root as the first step reads it. */
interface MarkdownRoot {
  children: unknown[];
}

/** The language GitHub's highlighting names on a block: `highlight-source-ts` and `highlight-text-md` alike. */
const HIGHLIGHT_LANGUAGE = /^highlight-(?:source|text)-(.+)$/u;

/** GitHub's classes on the parts these steps reshape. */
const GITHUB_CLASS = {
  ANCHOR: "anchor",
  HIGHLIGHT: "highlight",
  HEADING: "markdown-heading",
  SNIPPET: "snippet-clipboard-content",
} as const;

const MERMAID = "mermaid";

/** A node's classes, as the parsed tree holds them. */
function classesOf(node: HtmlNode): readonly string[] {
  const named = node.properties?.className;
  return Array.isArray(named) ? named.map(String) : [];
}

/** All the words a node holds, in order. */
function textOf(node: HtmlNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

/** A fenced block of `code` in `language`, as markdown's own parse would give it. */
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

/** The first descendant the test admits, depth first. */
function findIn(node: HtmlNode, test: (each: HtmlNode) => boolean): HtmlNode | undefined {
  for (const child of node.children ?? []) {
    if (test(child)) return child;
    const found = findIn(child, test);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** What one node of GitHub's rendering becomes: itself, nodes in its place, or nothing. */
function reshaped(node: HtmlNode): readonly HtmlNode[] {
  if (node.type !== "element") return [node];
  const classes = classesOf(node);
  if (node.tagName === "a" && classes.includes(GITHUB_CLASS.ANCHOR)) return [];
  if (node.tagName === "section" && node.properties?.dataType === MERMAID) {
    const source = findIn(node, (each) => (each.properties?.dataPlain ?? undefined) !== undefined);
    const code = String(source?.properties?.dataPlain ?? textOf(node)).trim();
    return [fenced(MERMAID, code)];
  }
  if (node.tagName === "div" && classes.includes(GITHUB_CLASS.HIGHLIGHT)) {
    const language = classes.map((each) => HIGHLIGHT_LANGUAGE.exec(each)?.[1]).find(Boolean);
    const pre = findIn(node, (each) => each.tagName === "pre");
    if (language !== undefined && pre !== undefined) return [fenced(language, textOf(pre))];
  }
  if (
    node.tagName === "div" &&
    (classes.includes(GITHUB_CLASS.HEADING) || classes.includes(GITHUB_CLASS.SNIPPET))
  ) {
    return reshapeChildren(node.children ?? []);
  }
  node.children = reshapeChildren(node.children ?? []);
  return [node];
}

function reshapeChildren(children: readonly HtmlNode[]): HtmlNode[] {
  return children.flatMap(reshaped);
}

/** The step that hands the words to the HTML steps whole, as one HTML node, never read as markdown. */
export function wholeRendering(): (tree: MarkdownRoot, file: { value: unknown }) => void {
  return (tree, file) => {
    tree.children = [{ type: "html", value: String(file.value) }];
  };
}

/** The step that reshapes what GitHub dresses its way into what the window draws its own, run between the parse and the sanitizer. */
export function githubShapes(): (tree: HtmlNode) => void {
  return (tree) => {
    tree.children = reshapeChildren(tree.children ?? []);
  };
}
