import { LINK_ORIGIN } from "@repo/features/link-home";
import { renderToString } from "react-dom/server";
import { AboutPage } from "./AboutPage";
import { App } from "./App";
import { ChangelogPage, RELEASES } from "./ChangelogPage";
import {
  CHANGELOG_FEED_PATH,
  changelogFeed,
  changelogRoutes,
  type PageHead,
} from "./changelog-releases";
import { NotFoundPage } from "./NotFoundPage";
import { PrivacyPage } from "./PrivacyPage";
import { SITE_PAGE } from "./SiteChrome";

const PRERENDERED_PAGES = {
  "index.html": App,
  "about.html": AboutPage,
  "privacy.html": PrivacyPage,
  "404.html": NotFoundPage,
} as const satisfies Readonly<Record<string, () => React.JSX.Element>>;

export interface PrerenderedPage {
  readonly file: string;
  readonly template: string | undefined;
  readonly markup: string;
  readonly head: PageHead | undefined;
}

export function renderPrerenderedPages(): readonly PrerenderedPage[] {
  const pages = Object.entries(PRERENDERED_PAGES).map(
    ([file, Page]): PrerenderedPage => ({
      file,
      template: undefined,
      markup: renderToString(<Page />),
      head: undefined,
    }),
  );
  const changelog = changelogRoutes(RELEASES).map(
    (route): PrerenderedPage => ({
      file: route.file,
      template: "changelog.html",
      markup: renderToString(<ChangelogPage view={route.view} />),
      head: route.head,
    }),
  );
  return [...pages, ...changelog];
}

export function renderChangelogFeed() {
  return { file: CHANGELOG_FEED_PATH.slice(1), xml: changelogFeed(RELEASES) };
}

const SITEMAP_FILE = "sitemap.xml";

export function renderSitemap() {
  const paths = new Set([
    ...Object.values(SITE_PAGE),
    ...changelogRoutes(RELEASES).map((route) => route.path),
  ]);
  const urls = [...paths].map((path) => `  <url><loc>${LINK_ORIGIN}${path}</loc></url>`);
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
  return { file: SITEMAP_FILE, xml };
}
