import type { ReactNode } from "react";
import Markdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";

const SAFE_LINK = /^https?:\/\//i;

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
 * an arbitrary address, and a message's words must not become an act by
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
      <>{children}</>
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
 * twelve and a half. `trailing` is the stamp a chat puts under a message,
 * drawn on a line of its own after the words.
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
      <Markdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS} urlTransform={safeUrl}>
        {words}
      </Markdown>
      {trailing === undefined ? null : <p className="markdown-trailing">{trailing}</p>}
    </div>
  );
}
