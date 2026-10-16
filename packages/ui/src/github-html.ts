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
 * reshapes the one thing GitHub dresses its own way that the window would
 * otherwise draw wrong: a highlighted block, or a diagram's source, which
 * GitHub writes as a `<pre>` of coloured spans with no `<code>` in it, so
 * that its lines would run together. Each becomes a fenced block in its
 * language, which the window draws and colours as it does any
 * (`transcript-markdown.tsx`). Everything else GitHub writes, a heading's
 * permalink included, the sanitizer already leaves harmless.
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

/** What one node of GitHub's rendering becomes: itself, nodes in its place, or nothing. */
function reshaped(node: HtmlNode): readonly HtmlNode[] {
  if (node.type !== "element") return [node];
  const classes = classesOf(node);
  // A diagram's source stands in a block naming its language (`<pre lang="mermaid">`).
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
