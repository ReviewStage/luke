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
import { PrivacyPage } from "./PrivacyPage";

/**
 * The pages a crawler should be able to read without running JavaScript,
 * keyed by the HTML file Vite emits for each. The changelog is not one of them
 * but many: every page of releases and every release on its own, each
 * written from the one `changelog.html` Vite emits. Sign-in, consent, and admin
 * are app surfaces rather than documents, so they stay client-rendered: a
 * static render of them would only ever describe a form.
 */
const PRERENDERED_PAGES = {
  "index.html": App,
  "about.html": AboutPage,
  "privacy.html": PrivacyPage,
} as const satisfies Readonly<Record<string, () => React.JSX.Element>>;

export interface PrerenderedPage {
  /** The built HTML file the page is written to, relative to the build's root. */
  readonly file: string;
  /** The built HTML file it is written from, when that is not `file` itself. */
  readonly template: string | undefined;
  readonly markup: string;
  /** The head the page's route has, when it is not the template's own. */
  readonly head: PageHead | undefined;
}

/**
 * Renders every prerendered page to static markup for `scripts/prerender.ts`,
 * which learns the page list from here rather than keeping one of its own.
 * These pages' client entries hydrate that markup rather than replacing it,
 * so a page component here must render the same tree in Node and in the
 * browser: anything that depends on the window is read in an effect.
 */
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

/** The changelog's RSS feed, and the built file it is written to, relative to the build's root. */
export function renderChangelogFeed() {
  return { file: CHANGELOG_FEED_PATH.slice(1), xml: changelogFeed(RELEASES) };
}
