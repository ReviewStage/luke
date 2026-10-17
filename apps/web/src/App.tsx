import { PUBLIC_TITLE, PublicPage, PublicSection } from "@luke/ui";
import { captureSiteEvent, SITE_EVENT } from "./analytics";
import { DemoVideo } from "./DemoVideo";
import {
  DMG_URL,
  GitHubMark,
  REPOSITORY_URL,
  SITE_PAGE,
  SiteFooterLinks,
  SiteNavigation,
} from "./SiteChrome";

/**
 * The landing: the copy runs left, the way a page of prose does. The demo is
 * wider than the column and centers itself on the page.
 */
export function App(): React.JSX.Element {
  return (
    <PublicPage
      banner={<SiteNavigation current={SITE_PAGE.HOME} />}
      footer={<SiteFooterLinks current={SITE_PAGE.HOME} />}
      title="A better way to plan with agents."
      titleStyle={PUBLIC_TITLE.HERO}
      lead="Talk through a feature with Luke. He reads the code while you talk and writes a plan you can paste into Claude Code or Codex."
    >
      <PublicSection>
        <div className="flex flex-wrap items-center gap-3">
          <a
            className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground no-underline transition-[filter,transform] duration-150 hover:brightness-95 active:translate-y-px motion-reduce:transition-none"
            href={DMG_URL}
            onClick={() => captureSiteEvent(SITE_EVENT.DOWNLOAD_PRESS)}
          >
            Download for macOS
          </a>
          <a
            className="inline-flex items-center gap-2 rounded-md border border-border px-[23px] py-[11px] text-sm font-semibold text-muted-foreground no-underline transition-colors duration-150 hover:border-muted-foreground hover:text-foreground motion-reduce:transition-none"
            href={REPOSITORY_URL}
          >
            <GitHubMark />
            View on GitHub
          </a>
        </div>

        {/* A requirement, not a sentence: mono is what the page reserves for
            technical tokens. */}
        <p className="mt-3 mb-0 font-mono text-xs text-muted-foreground">
          macOS 14+ · Apple silicon
        </p>

        <DemoVideo />
      </PublicSection>
    </PublicPage>
  );
}
