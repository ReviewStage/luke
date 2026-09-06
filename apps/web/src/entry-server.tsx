import { renderToString } from "react-dom/server";
import { AboutPage } from "./AboutPage";
import { App } from "./App";
import { ChangelogPage } from "./ChangelogPage";
import { PrivacyPage } from "./PrivacyPage";

/**
 * The pages a crawler should be able to read without running JavaScript,
 * keyed by the HTML file Vite emits for each. Sign-in, consent, and admin
 * are app surfaces rather than documents, so they stay client-rendered: a
 * static render of them would only ever describe a form.
 */
const PRERENDERED_PAGES = {
  "index.html": App,
  "about.html": AboutPage,
  "changelog.html": ChangelogPage,
  "privacy.html": PrivacyPage,
} as const satisfies Readonly<Record<string, () => React.JSX.Element>>;

export interface PrerenderedPage {
  /** The built HTML file whose `#root` the markup fills. */
  readonly file: string;
  readonly markup: string;
}

/**
 * Renders every prerendered page to static markup for `scripts/prerender.ts`,
 * which learns the page list from here rather than keeping one of its own.
 * These pages' client entries hydrate that markup rather than replacing it,
 * so a page component here must render the same tree in Node and in the
 * browser: anything that depends on the window is read in an effect.
 */
export function renderPrerenderedPages(): readonly PrerenderedPage[] {
  return Object.entries(PRERENDERED_PAGES).map(([file, Page]) => ({
    file,
    markup: renderToString(<Page />),
  }));
}
