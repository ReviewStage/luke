/**
 * site-markdown.tsx -- the site's two Markdown documents drawn as HTML when it is built: CHANGELOG.md read as releases and PRIVACY.md as a policy, both by `@luke/ui/markdown`, the renderer every Markdown in Luke is drawn with.
 *
 * Only the build reads this module (`scripts/site-markdown.ts`, which hands
 * a page what it answers as a module of finished values), so the pages
 * carry their markup and no parser rides into the site's bundle. Both
 * documents are written in this repository, so their HTML is ours: it is
 * parsed (a release's `<kbd>` keys say a chord) and never sanitised, as a
 * visitor's words would be.
 */

import {
  MARKDOWN_HTML_STEP,
  MARKDOWN_LOOK,
  Markdown,
  type MarkdownComponents,
} from "@luke/ui/markdown";
import { markdownTree } from "@luke/ui/markdown-words";
import type { Heading, Nodes, PhrasingContent, RootContent } from "mdast";
import { renderToStaticMarkup } from "react-dom/server";
import type { Release, ReleaseImage } from "./changelog-releases";
import { REPOSITORY_URL } from "./SiteChrome";

/** One `##` section of the policy, its heading and body as HTML; the opening one has no heading. */
export interface PolicySection {
  readonly title: string | null;
  readonly html: string;
}

/** The policy cut at its headings: the `#` title, and the sections under it. */
export interface Policy {
  readonly title: string;
  readonly sections: readonly PolicySection[];
}

/** The standing sections every release may end on, which name no feature. */
const STANDING_SECTIONS: ReadonlySet<string> = new Set(["Improvements", "Fixes", "Misc"]);

/**
 * The heading shape is CHANGELOG.md's contract with this page: the version
 * becomes the sticky rail and the release's own address. repository-checks.sh
 * refuses a heading that does not parse, so the throw here is the backstop,
 * not the gate.
 */
const RELEASE_HEADING = /^## (\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})$/;
const PUBLIC_PREFIX = "apps/web/public";

/** The steps a document's tree takes: its own HTML parsed, as written. */
const DOCUMENT_STEPS = [MARKDOWN_HTML_STEP.PARSE];

/* Screenshots are written repository-relative in the markdown so GitHub
   renders them too; here the public prefix comes off, because Vite serves
   that directory at the root. */
const servedPath = (href: string) =>
  href.startsWith(`${PUBLIC_PREFIX}/`) ? href.slice(PUBLIC_PREFIX.length) : href;

/* A link to a file beside CHANGELOG.md (`PRIVACY.md`) reads on GitHub as the
   repository's file, and anywhere else would resolve under whatever page or
   feed holds it, so it is written as that file on GitHub. */
const RELATIVE_LINK = /^(?![a-z][a-z0-9+.-]*:|\/|#)/i;
const repositoryFile = (href: string) =>
  RELATIVE_LINK.test(href) ? `${REPOSITORY_URL}/blob/main/${href}` : href;

/** Each address a document names, as the site serves it: a screenshot from the site's root, a file beside the document on GitHub. */
function siteUrl(url: string, key: string): string {
  return key === "src" ? servedPath(url) : repositoryFile(url);
}

/**
 * A screenshot drawn at the column's measure is a preview of the full
 * capture, so it links out to the file itself, the same way GitHub wraps a
 * rendered markdown image. Lazy, because every release adds images above
 * the ones already here.
 */
const RELEASE_COMPONENTS: MarkdownComponents = {
  img: ({ src, alt, title }) => (
    <a href={src} target="_blank" rel="noreferrer">
      <img src={src} alt={alt} title={title} loading="lazy" />
    </a>
  ),
};

/** Inline words drawn bare, for a heading the page sets itself. */
const INLINE_COMPONENTS: MarkdownComponents = { p: ({ children }) => <>{children}</> };

/** Markdown drawn as a document's HTML, with no root of its own: the page's `Prose` is its root. */
function documentHtml(words: string, components?: MarkdownComponents): string {
  return renderToStaticMarkup(
    <Markdown
      look={MARKDOWN_LOOK.DOCUMENT}
      words={words}
      components={components}
      rehypePlugins={DOCUMENT_STEPS}
      urlTransform={siteUrl}
    />,
  );
}

/** The words a run of nodes was written as, from the first's start to the last's end. */
function writtenAs(markdown: string, nodes: readonly Nodes[]): string {
  const from = nodes[0]?.position?.start.offset;
  const to = nodes.at(-1)?.position?.end.offset;
  return from === undefined || to === undefined ? "" : markdown.slice(from, to);
}

/** The plain words of inline nodes: links, emphasis, and code read as their text, a picture as nothing. */
function plainText(nodes: readonly PhrasingContent[]): string {
  return nodes
    .map((node): string => {
      if (node.type === "image" || node.type === "imageReference") return "";
      if (node.type === "break") return " ";
      if ("value" in node) return node.value;
      return "children" in node ? plainText(node.children) : "";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether a block is a paragraph of pictures alone. */
function picturesAlone(node: RootContent): boolean {
  return (
    node.type === "paragraph" &&
    node.children.every((child) => child.type === "image" || child.type === "imageReference")
  );
}

/** The first picture under some nodes, at its served address. */
function firstImage(nodes: readonly Nodes[]): ReleaseImage | undefined {
  for (const node of nodes) {
    if (node.type === "image") return { src: servedPath(node.url), alt: node.alt ?? "" };
    const inside = "children" in node ? firstImage(node.children) : undefined;
    if (inside !== undefined) return inside;
  }
  return undefined;
}

/** The headline, summary, and first screenshot a release's notes open on. */
function releaseHighlights(body: string): Pick<Release, "headline" | "summary" | "image"> {
  const blocks = markdownTree(body).children;
  const heading = blocks.find(
    (node): node is Heading => node.type === "heading" && node.depth === 3,
  );
  const named = heading === undefined ? undefined : writtenAs(body, heading.children);
  const headline = named !== undefined && !STANDING_SECTIONS.has(named) ? named : undefined;
  const paragraph = blocks.find((node) => node.type === "paragraph" && !picturesAlone(node));
  const list = blocks.find((node) => node.type === "list");
  const opening =
    paragraph?.type === "paragraph"
      ? paragraph.children
      : list?.type === "list" && list.children[0]?.children[0]?.type === "paragraph"
        ? list.children[0].children[0].children
        : [];
  return { headline, summary: plainText(opening), image: firstImage(blocks) };
}

/** Every release in CHANGELOG.md, newest first, as the file lists them. */
export function parseReleases(markdown: string): readonly Release[] {
  const sections = markdown.split(/^(?=## )/m);
  return sections.slice(1).map((section) => {
    const headingEnd = section.indexOf("\n");
    const heading = headingEnd === -1 ? section : section.slice(0, headingEnd);
    const match = RELEASE_HEADING.exec(heading.trimEnd());
    const version = match?.[1];
    const date = match?.[2];
    if (!version || !date) {
      throw new Error(`CHANGELOG.md release heading must be "## <version> — <date>": ${heading}`);
    }
    const body = headingEnd === -1 ? "" : section.slice(headingEnd + 1);
    return {
      version,
      date,
      html: documentHtml(body, RELEASE_COMPONENTS),
      ...releaseHighlights(body),
    };
  });
}

/**
 * PRIVACY.md cut at its `#` and `##` headings, so the page draws the title
 * and each section itself and the generated markup is only what lies
 * between.
 */
export function policyOf(markdown: string): Policy {
  let title: string | null = null;
  const sections: { title: string | null; blocks: RootContent[] }[] = [{ title: null, blocks: [] }];
  for (const node of markdownTree(markdown).children) {
    if (node.type === "heading" && node.depth === 1)
      title = documentHtml(writtenAs(markdown, node.children), INLINE_COMPONENTS);
    else if (node.type === "heading" && node.depth === 2)
      sections.push({
        title: documentHtml(writtenAs(markdown, node.children), INLINE_COMPONENTS),
        blocks: [],
      });
    else sections.at(-1)?.blocks.push(node);
  }
  if (title === null) throw new Error("PRIVACY.md has no `#` title");
  return {
    title,
    sections: sections
      .filter((section) => section.title !== null || section.blocks.length > 0)
      .map((section) => ({
        title: section.title,
        html: documentHtml(writtenAs(markdown, section.blocks)),
      })),
  };
}
