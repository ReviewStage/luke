/**
 * changelog-releases.ts -- CHANGELOG.md read as releases, and the changelog's pages and per-release routes over them.
 *
 * CHANGELOG.md at the repo root is the only place the release notes are
 * written — every release adds its entry there before its tag is pushed, and
 * a copy pasted into JSX would drift from it. The changelog is served as pages
 * of CHANGELOG_PAGE_SIZE releases, newest first, and every release on a page
 * of its own at its version, which never changes once tagged, so a link to a
 * release outlives any later edit to its words. The prerender writes one HTML
 * file per route and the client reads its route back from the address it was
 * served at, so both render the same view.
 */

import { Marked, type Token, type Tokens } from "marked";
import { REPOSITORY_URL } from "./SiteChrome";

export const CHANGELOG_PATH = "/changelog";
/** The changelog's RSS feed, every release an item linking to its own page. */
export const CHANGELOG_FEED_PATH = "/changelog/rss.xml";
const CHANGELOG_FEED_TITLE = "Luke changelog";
const CHANGELOG_PAGE_SIZE = 10;
const SITE_ORIGIN = "https://tryluke.dev";

/** What a changelog address shows: a page of releases, or one release alone. */
export const CHANGELOG_VIEW = {
  PAGE: "page",
  RELEASE: "release",
} as const;

/** The standing sections every release may end on, which name no feature. */
const STANDING_SECTIONS: ReadonlySet<string> = new Set(["Improvements", "Fixes", "Misc"]);

/** The longest description a share card is given before it is cut at a word. */
const DESCRIPTION_LIMIT = 200;

const PAGE_DESCRIPTION = "What changed in each Luke release.";

/**
 * The heading shape is CHANGELOG.md's contract with this page: the version
 * becomes the sticky rail and the release's own address. repository-checks.sh
 * refuses a heading that does not parse, so the throw here is the backstop,
 * not the gate.
 */
const RELEASE_HEADING = /^## (\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})$/;
const RELEASE_PATH = /^\/changelog\/(\d+\.\d+\.\d+)$/;
const PAGE_PATH = /^\/changelog\/page\/(\d+)$/;
const PUBLIC_PREFIX = "apps/web/public";

const escapeAttribute = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

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

const changelogMarked = new Marked({
  walkTokens: (token) => {
    if (token.type === "image") token.href = servedPath(token.href);
    if (token.type === "link") token.href = repositoryFile(token.href);
  },
  /* A screenshot drawn at the column's measure is a preview of the full
     capture, so it links out to the file itself, the same way GitHub wraps a
     rendered markdown image. Lazy, because every release adds images above
     the ones already here. */
  renderer: {
    image({ href, title, text }) {
      const source = escapeAttribute(href);
      const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : "";
      return (
        `<a href="${source}" target="_blank" rel="noreferrer">` +
        `<img src="${source}" alt="${escapeAttribute(text)}"${titleAttribute} loading="lazy"></a>`
      );
    },
  },
});

interface ReleaseImage {
  /** The image's address on the site, from its root. */
  readonly src: string;
  readonly alt: string;
}

export interface Release {
  readonly version: string;
  /** The release's calendar day, `YYYY-MM-DD`. */
  readonly date: string;
  readonly html: string;
  /** The release's first feature section's name, when it has one. */
  readonly headline: string | undefined;
  /** The first paragraph of the release's notes, as plain text. */
  readonly summary: string;
  /** The release's first screenshot, which its share card shows. */
  readonly image: ReleaseImage | undefined;
}

export type ChangelogView =
  | {
      readonly kind: typeof CHANGELOG_VIEW.PAGE;
      /** One-based. */
      readonly page: number;
      readonly pageCount: number;
      readonly releases: readonly Release[];
    }
  | {
      readonly kind: typeof CHANGELOG_VIEW.RELEASE;
      readonly release: Release;
      readonly newer: Release | undefined;
      readonly older: Release | undefined;
    };

/** What a route's `<head>` says about it to a browser tab and a share card. */
export interface PageHead {
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly image: ReleaseImage | undefined;
}

export interface ChangelogRoute {
  readonly path: string;
  /** The built HTML file the route is served from, relative to the site's root. */
  readonly file: string;
  readonly view: ChangelogView;
  readonly head: PageHead;
}

/** The plain words of a run of inline tokens: links, emphasis, and code read as their text. */
function plainText(tokens: readonly Token[] | undefined): string {
  if (tokens === undefined) return "";
  return tokens
    .map((token) => {
      if (token.type === "image") return "";
      if (token.type === "codespan" || token.type === "escape") return token.text;
      if (token.type === "br") return " ";
      if ("tokens" in token && Array.isArray(token.tokens)) return plainText(token.tokens);
      return token.raw;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** A description cut at a word before the limit, with an ellipsis, or whole when it fits. */
function shortened(text: string): string {
  if (text.length <= DESCRIPTION_LIMIT) return text;
  const cut = text.slice(0, DESCRIPTION_LIMIT);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

/** The headline, summary, and first screenshot a release's notes open on. */
function releaseHighlights(body: string): Pick<Release, "headline" | "summary" | "image"> {
  const tokens = changelogMarked.lexer(body);
  const heading = tokens.find(
    (token): token is Tokens.Heading => token.type === "heading" && token.depth === 3,
  );
  const headline =
    heading !== undefined && !STANDING_SECTIONS.has(heading.text) ? heading.text : undefined;
  const paragraph = tokens.find(
    (token): token is Tokens.Paragraph =>
      token.type === "paragraph" &&
      !(token.tokens ?? []).every((inline) => inline.type === "image"),
  );
  const list = tokens.find((token): token is Tokens.List => token.type === "list");
  const summary = plainText(paragraph?.tokens ?? list?.items[0]?.tokens);
  let image: ReleaseImage | undefined;
  changelogMarked.walkTokens(tokens, (token) => {
    if (image === undefined && token.type === "image") {
      image = { src: servedPath(token.href), alt: token.text };
    }
  });
  return { headline, summary, image };
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
      // SAFETY: `async: false` makes marked.parse synchronous; the return is a string, not a Promise.
      html: changelogMarked.parse(body, { async: false }) as string,
      ...releaseHighlights(body),
    };
  });
}

/** How many pages the releases fill, never fewer than one. */
function changelogPageCount(releases: readonly Release[]): number {
  return Math.max(1, Math.ceil(releases.length / CHANGELOG_PAGE_SIZE));
}

/** A page's address: the first page is the changelog itself. */
export function changelogPagePath(page: number): string {
  return page === 1 ? CHANGELOG_PATH : `${CHANGELOG_PATH}/page/${page}`;
}

/** A release's own address, at its version. */
export function changelogReleasePath(version: string): string {
  return `${CHANGELOG_PATH}/${version}`;
}

function pageView(releases: readonly Release[], page: number): ChangelogView {
  const start = (page - 1) * CHANGELOG_PAGE_SIZE;
  return {
    kind: CHANGELOG_VIEW.PAGE,
    page,
    pageCount: changelogPageCount(releases),
    releases: releases.slice(start, start + CHANGELOG_PAGE_SIZE),
  };
}

function releaseView(releases: readonly Release[], index: number): ChangelogView | undefined {
  const release = releases[index];
  if (release === undefined) return undefined;
  return {
    kind: CHANGELOG_VIEW.RELEASE,
    release,
    newer: releases[index - 1],
    older: releases[index + 1],
  };
}

/**
 * The view an address shows, or nothing for an address the changelog has no
 * page at. An address may name its built file (`/changelog/page/2.html`), as
 * a static server and the dev server serve them, and reads as the route it
 * was written for.
 */
export function changelogViewForPath(
  releases: readonly Release[],
  pathname: string,
): ChangelogView | undefined {
  const path = pathname.replace(/\/+$/, "").replace(/\.html$/, "");
  if (path === CHANGELOG_PATH) return pageView(releases, 1);
  const pageMatch = PAGE_PATH.exec(path);
  if (pageMatch?.[1] !== undefined) {
    const page = Number(pageMatch[1]);
    return page >= 2 && page <= changelogPageCount(releases) ? pageView(releases, page) : undefined;
  }
  const releaseMatch = RELEASE_PATH.exec(path);
  if (releaseMatch?.[1] === undefined) return undefined;
  return releaseView(
    releases,
    releases.findIndex((release) => release.version === releaseMatch[1]),
  );
}

/** A release's name where it stands alone: its version, and its first feature when it has one. */
function releaseTitle(release: Release): string {
  return release.headline === undefined
    ? `Luke ${release.version}`
    : `Luke ${release.version}: ${release.headline}`;
}

function releaseHead(release: Release): PageHead {
  return {
    title: `${releaseTitle(release)} — Changelog`,
    description: shortened(release.summary || PAGE_DESCRIPTION),
    url: `${SITE_ORIGIN}${changelogReleasePath(release.version)}`,
    image: release.image,
  };
}

function pageHead(page: number): PageHead {
  return {
    title: page === 1 ? "Changelog — Luke" : `Changelog, page ${page} — Luke`,
    description: PAGE_DESCRIPTION,
    url: `${SITE_ORIGIN}${changelogPagePath(page)}`,
    image: undefined,
  };
}

/** Every address the changelog serves, each with its view, its built file, and its head. */
export function changelogRoutes(releases: readonly Release[]): readonly ChangelogRoute[] {
  const pages = Array.from({ length: changelogPageCount(releases) }, (_, index) => index + 1).map(
    (page): ChangelogRoute => ({
      path: changelogPagePath(page),
      file: page === 1 ? "changelog.html" : `changelog/page/${page}.html`,
      view: pageView(releases, page),
      head: pageHead(page),
    }),
  );
  const singles = releases.flatMap((release, index): ChangelogRoute[] => {
    const view = releaseView(releases, index);
    if (view === undefined) return [];
    return [
      {
        path: changelogReleasePath(release.version),
        file: `changelog/${release.version}.html`,
        view,
        head: releaseHead(release),
      },
    ];
  });
  return [...pages, ...singles];
}

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/* A feed reader shows an item's HTML away from the site, so its root-relative
   screenshots and links carry the site's origin. */
const withAbsoluteUrls = (html: string) =>
  html.replace(/(src|href)="\/(?!\/)/g, `$1="${SITE_ORIGIN}/`);

/* A CDATA section ends at the first `]]>`, so one inside the notes is split across two sections. */
const asCdata = (html: string) => `<![CDATA[${html.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;

/** A release day as RSS dates it: RFC 822, at the day's UTC midnight. */
const rssDate = (date: string) => new Date(`${date}T00:00:00Z`).toUTCString();

/**
 * The changelog as an RSS 2.0 feed, newest release first, each item its
 * release's whole notes and a link to its own page. Its build date is the
 * newest release's day rather than the build's, so the feed changes only when
 * a release does.
 */
export function changelogFeed(releases: readonly Release[]): string {
  const items = releases.map((release) => {
    const url = `${SITE_ORIGIN}${changelogReleasePath(release.version)}`;
    return [
      "    <item>",
      `      <title>${escapeXml(releaseTitle(release))}</title>`,
      `      <link>${url}</link>`,
      `      <guid isPermaLink="true">${url}</guid>`,
      `      <pubDate>${rssDate(release.date)}</pubDate>`,
      `      <description>${asCdata(withAbsoluteUrls(release.html))}</description>`,
      "    </item>",
    ].join("\n");
  });
  const newest = releases[0];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${CHANGELOG_FEED_TITLE}</title>`,
    `    <link>${SITE_ORIGIN}${CHANGELOG_PATH}</link>`,
    `    <description>${PAGE_DESCRIPTION}</description>`,
    "    <language>en</language>",
    `    <atom:link href="${SITE_ORIGIN}${CHANGELOG_FEED_PATH}" rel="self" type="application/rss+xml" />`,
    ...(newest === undefined ? [] : [`    <lastBuildDate>${rssDate(newest.date)}</lastBuildDate>`]),
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
