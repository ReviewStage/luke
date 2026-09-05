import { renderToString } from "react-dom/server";
import { AboutPage } from "./AboutPage";
import { App } from "./App";
import { ChangelogPage } from "./ChangelogPage";
import { DocsPage } from "./DocsPage";
import { PricingPage } from "./PricingPage";
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
  "docs.html": DocsPage,
  "pricing.html": PricingPage,
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
 * The client entries still mount with `createRoot` rather than `hydrateRoot`:
 * the prerendered markup is there for crawlers and for the first paint, and
 * the live app replaces it on load instead of negotiating a hydration match
 * with the notch mock's animation state.
 */
export function renderPrerenderedPages(): readonly PrerenderedPage[] {
  return Object.entries(PRERENDERED_PAGES).map(([file, Page]) => ({
    file,
    markup: renderToString(<Page />),
  }));
}
