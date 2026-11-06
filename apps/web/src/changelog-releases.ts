import { LINK_ORIGIN } from "@repo/features/link-home";
import { PRODUCT_NAME } from "@repo/features/product-name";

export const CHANGELOG_PATH = "/changelog";
export const CHANGELOG_FEED_PATH = "/changelog/rss.xml";
const CHANGELOG_FEED_TITLE = `${PRODUCT_NAME} changelog`;
const CHANGELOG_PAGE_SIZE = 10;
const SITE_ORIGIN = LINK_ORIGIN;

export const CHANGELOG_VIEW = {
  PAGE: "page",
  RELEASE: "release",
} as const;

const DESCRIPTION_LIMIT = 200;

const PAGE_DESCRIPTION = `What changed in each ${PRODUCT_NAME} release.`;

const RELEASE_PATH = /^\/changelog\/(\d+\.\d+\.\d+)$/;
const PAGE_PATH = /^\/changelog\/page\/(\d+)$/;

export interface ReleaseImage {
  readonly src: string;
  readonly alt: string;
}

export interface Release {
  readonly version: string;
  readonly date: string;
  readonly html: string;
  readonly headline: string | undefined;
  readonly summary: string;
  readonly image: ReleaseImage | undefined;
}

export type ChangelogView =
  | {
      readonly kind: typeof CHANGELOG_VIEW.PAGE;
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

export interface PageHead {
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly image: ReleaseImage | undefined;
}

export interface ChangelogRoute {
  readonly path: string;
  readonly file: string;
  readonly view: ChangelogView;
  readonly head: PageHead;
}

function shortened(text: string): string {
  if (text.length <= DESCRIPTION_LIMIT) return text;
  const cut = text.slice(0, DESCRIPTION_LIMIT);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

function changelogPageCount(releases: readonly Release[]): number {
  return Math.max(1, Math.ceil(releases.length / CHANGELOG_PAGE_SIZE));
}

export function changelogPagePath(page: number): string {
  return page === 1 ? CHANGELOG_PATH : `${CHANGELOG_PATH}/page/${page}`;
}

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

function releaseTitle(release: Release): string {
  return release.headline === undefined
    ? `${PRODUCT_NAME} ${release.version}`
    : `${PRODUCT_NAME} ${release.version}: ${release.headline}`;
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
    title: page === 1 ? `Changelog — ${PRODUCT_NAME}` : `Changelog, page ${page} — ${PRODUCT_NAME}`,
    description: PAGE_DESCRIPTION,
    url: `${SITE_ORIGIN}${changelogPagePath(page)}`,
    image: undefined,
  };
}

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

const withAbsoluteUrls = (html: string) =>
  html.replace(/(src|href)="\/(?!\/)/g, `$1="${SITE_ORIGIN}/`);

const asCdata = (html: string) => `<![CDATA[${html.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;

const rssDate = (date: string) => new Date(`${date}T00:00:00Z`).toUTCString();

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
