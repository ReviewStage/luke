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
 * reshapes the things GitHub dresses its own way that the window would
 * otherwise draw wrong: a highlighted block, or a diagram's source, which
 * GitHub writes as a `<pre>` of coloured spans with no `<code>` in it, so
 * that its lines would run together. Each becomes a fenced block in its
 * language, which the window draws and colours as it does any
 * (`transcript-markdown.tsx`). A review comment's suggested change, which
 * GitHub writes as a table of rows its own stylesheet tints, becomes a
 * fenced block of its lines (`SUGGESTED_CHANGE_LANGUAGE`), each removed one
 * marked `-` and each added one `+`, which the window tints itself, so none
 * of GitHub's classes need reach the sanitizer. It also drops every `<source>`, the themed
 * pictures a bot's badge is written as (`<picture>` with a dark and a light
 * `<source srcset>`) among them, because a browser draws a matching source
 * in place of its `<img>`: the window would ask GitHub's image proxy itself,
 * which its policy refuses, rather than draw the `<img>` the place reads
 * through the service, and the picture would stand broken. Everything else
 * GitHub writes, a heading's permalink included, the sanitizer already
 * leaves harmless.
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

/** The class GitHub wears on a suggested change, the diff table it renders a review comment's ```suggestion as. */
const SUGGESTION_BLOB = "js-suggested-changes-blob";

/**
 * The language a suggested change GitHub rendered is fenced as, its lines
 * marked `-` and `+`. Note that it is not `suggestion`, the language a
 * suggestion is written in, whose lines are the new ones alone and may
 * start with either mark as words of their own, as a list's do.
 */
export const SUGGESTED_CHANGE_LANGUAGE = "suggested-change";

/** The mark each of a suggested change's rows is written with, by the class its code cell wears: a line removed, or one added. */
const SUGGESTION_ROW = [
  ["blob-code-deletion", "-"],
  ["blob-code-addition", "+"],
] as const;

/** Every element under a node, in order, the node first. */
function elementsOf(node: HtmlNode): readonly HtmlNode[] {
  if (node.type !== "element") return [];
  return [node, ...(node.children ?? []).flatMap(elementsOf)];
}

/**
 * A suggested change's lines as a fenced block: each row of its
 * table in order, a line removed marked `-` and one added `+`, its words
 * as they stand, so its indentation and its empty lines are kept.
 */
function suggestion(blob: HtmlNode): HtmlNode {
  const lines = elementsOf(blob).flatMap((cell) => {
    if (cell.tagName !== "td") return [];
    const classes = classesOf(cell);
    const mark = SUGGESTION_ROW.find(([name]) => classes.includes(name))?.[1];
    return mark === undefined ? [] : [`${mark}${textOf(cell)}`];
  });
  return fenced(SUGGESTED_CHANGE_LANGUAGE, lines.join("\n"));
}

/** What one node of GitHub's rendering becomes: itself, nodes in its place, or nothing. */
function reshaped(node: HtmlNode): readonly HtmlNode[] {
  if (node.type !== "element") return [node];
  // A source is an address the window would read itself; its picture's `<img>` stands alone.
  if (node.tagName === "source") return [];
  const classes = classesOf(node);
  // A suggested change is GitHub's own diff table, whose looks are all its classes.
  if (node.tagName === "div" && classes.includes(SUGGESTION_BLOB)) return [suggestion(node)];
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
