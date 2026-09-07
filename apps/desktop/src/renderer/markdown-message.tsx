import type { Element, Root } from "hast";
import { createContext, type ReactNode, useContext } from "react";
import Markdown, { type Components, type Options } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

const SAFE_LINK = /^https?:\/\//i;
const TASK_ITEM_CLASS = "task-list-item";

/**
 * The plugins that make the dialect coding agents write: GitHub's tables,
 * strikethrough, and task lists, with a single tilde left as the character
 * it is (two home-directory paths in one sentence must not strike the words
 * between them), and a line break in the source kept as one line break,
 * because a message is a chat's words rather than a manuscript whose soft
 * breaks a typesetter joins.
 */
const REMARK_PLUGINS: Options["remarkPlugins"] = [
  [remarkGfm, { singleTilde: false }],
  remarkBreaks,
];

/**
 * The stamp a chat puts on a message's last line. It rides inside the last
 * paragraph where there is one, and on a line of its own after a block that
 * cannot hold it. The paragraph is marked here, on the tree, because the
 * paragraph component cannot see whether it is the last.
 */
const TRAILING_PROPERTY = "dataTrailing";

function markTrailingParagraph() {
  return (tree: Root): void => {
    let last: Element | undefined;
    for (const child of tree.children) {
      if (child.type === "element") last = child;
    }
    if (last !== undefined && last.tagName === "p") {
      last.properties[TRAILING_PROPERTY] = "";
      return;
    }
    tree.children.push({
      type: "element",
      tagName: "p",
      properties: { className: ["markdown-trailing"], [TRAILING_PROPERTY]: "" },
      children: [],
    });
  };
}

const REHYPE_PLUGINS_WITH_TRAILING: Options["rehypePlugins"] = [markTrailingParagraph];
const REHYPE_PLUGINS_WITHOUT_TRAILING: Options["rehypePlugins"] = [];

const TrailingContext = createContext<ReactNode>(undefined);

/** Whether the item's task box is ticked, read from the box GitHub's list handler put in it. */
function taskChecked(node: Element): boolean | undefined {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (child.tagName === "input") return child.properties.checked === true;
    if (child.tagName === "p") {
      const inner = taskChecked(child);
      if (inner !== undefined) return inner;
    }
  }
  return undefined;
}

function isTaskItem(node: Element | undefined): node is Element {
  const className = node?.properties.className;
  return Array.isArray(className) && className.includes(TASK_ITEM_CLASS);
}

/**
 * How each element is drawn where the library's default would say the wrong
 * thing on this surface.
 *
 * A link is drawn as one and names its destination on hover, but it is not a
 * control: the renderer refuses every navigation and has no door for opening
 * an arbitrary address, and a message's words must not become an act by
 * being pressed. Only HTTP and HTTPS destinations survive `urlTransform`
 * below, so anything else arrives here as words alone.
 *
 * A heading is styled, never announced: a reader walking the document's
 * headings should meet the panel's, not a reply's. An image has no picture
 * to draw in a caption, so its alternative words stand in for it. A task box
 * is the library's disabled checkbox, drawn instead as the list item's own
 * square in CSS, with the state read out for a reader.
 */
const COMPONENTS: Components = {
  a: ({ href, children }) =>
    href !== undefined && SAFE_LINK.test(href) ? (
      <span className="markdown-link" title={href}>
        {children}
      </span>
    ) : (
      <>{children}</>
    ),
  h1: ({ children }) => heading(1, children),
  h2: ({ children }) => heading(2, children),
  h3: ({ children }) => heading(3, children),
  h4: ({ children }) => heading(4, children),
  h5: ({ children }) => heading(5, children),
  h6: ({ children }) => heading(6, children),
  img: ({ alt }) => <>{alt ?? ""}</>,
  input: ({ checked }) => <span className="visually-hidden">{checked ? "Done: " : "To do: "}</span>,
  li: ({ node, children }) =>
    isTaskItem(node) ? (
      <li className="markdown-task" data-checked={taskChecked(node) ? "true" : "false"}>
        {children}
      </li>
    ) : (
      <li>{children}</li>
    ),
  p: ({ node, className, children }) => {
    const trailing = useContext(TrailingContext);
    const carriesTrailing = node?.properties[TRAILING_PROPERTY] !== undefined;
    return (
      <p className={className}>
        {children}
        {carriesTrailing ? trailing : null}
      </p>
    );
  },
  table: ({ children }) => (
    <div className="markdown-table-scroll">
      <table>{children}</table>
    </div>
  ),
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
  trailing,
}: {
  words: string;
  className?: string;
  trailing?: ReactNode;
}): React.JSX.Element {
  return (
    <div className={className === undefined ? "markdown" : `markdown ${className}`}>
      <TrailingContext value={trailing}>
        <Markdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={
            trailing === undefined ? REHYPE_PLUGINS_WITHOUT_TRAILING : REHYPE_PLUGINS_WITH_TRAILING
          }
          components={COMPONENTS}
          urlTransform={safeUrl}
        >
          {words}
        </Markdown>
      </TrailingContext>
    </div>
  );
}
