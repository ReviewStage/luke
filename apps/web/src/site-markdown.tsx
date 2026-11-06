import {
  MARKDOWN_HTML_STEP,
  MARKDOWN_LOOK,
  Markdown,
  type MarkdownComponents,
} from "@repo/ui/markdown";
import { markdownTree } from "@repo/ui/markdown-words";
import type { Heading, Nodes, PhrasingContent, RootContent } from "mdast";
import { renderToStaticMarkup } from "react-dom/server";
import type { Release, ReleaseImage } from "./changelog-releases";
import { REPOSITORY_URL } from "./SiteChrome";

export interface PolicySection {
  readonly title: string | null;
  readonly html: string;
}

export interface Policy {
  readonly title: string;
  readonly sections: readonly PolicySection[];
}

const STANDING_SECTIONS: ReadonlySet<string> = new Set(["Improvements", "Fixes", "Misc"]);

const RELEASE_HEADING = /^## (\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})$/;
const PUBLIC_PREFIX = "apps/web/public";

const DOCUMENT_STEPS = [MARKDOWN_HTML_STEP.PARSE];

const servedPath = (href: string) =>
  href.startsWith(`${PUBLIC_PREFIX}/`) ? href.slice(PUBLIC_PREFIX.length) : href;

const RELATIVE_LINK = /^(?![a-z][a-z0-9+.-]*:|\/|#)/i;
const repositoryFile = (href: string) =>
  RELATIVE_LINK.test(href) ? `${REPOSITORY_URL}/blob/main/${href}` : href;

function siteUrl(url: string, key: string): string {
  return key === "src" ? servedPath(url) : repositoryFile(url);
}

const RELEASE_COMPONENTS: MarkdownComponents = {
  img: ({ src, alt, title }) => (
    <a href={src} target="_blank" rel="noreferrer">
      <img src={src} alt={alt} title={title} loading="lazy" />
    </a>
  ),
};

const INLINE_COMPONENTS: MarkdownComponents = { p: ({ children }) => <>{children}</> };

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

function writtenAs(markdown: string, nodes: readonly Nodes[]): string {
  const from = nodes[0]?.position?.start.offset;
  const to = nodes.at(-1)?.position?.end.offset;
  return from === undefined || to === undefined ? "" : markdown.slice(from, to);
}

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

function picturesAlone(node: RootContent): boolean {
  return (
    node.type === "paragraph" &&
    node.children.every((child) => child.type === "image" || child.type === "imageReference")
  );
}

function firstImage(nodes: readonly Nodes[]): ReleaseImage | undefined {
  for (const node of nodes) {
    if (node.type === "image") return { src: servedPath(node.url), alt: node.alt ?? "" };
    const inside = "children" in node ? firstImage(node.children) : undefined;
    if (inside !== undefined) return inside;
  }
  return undefined;
}

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
