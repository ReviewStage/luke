import {
  BUTTON_VARIANT,
  ButtonLink,
  PUBLIC_TITLE,
  PublicPage,
  PublicSection,
  TEXT_FONT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
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
      banner={<SiteNavigation current={{ page: SITE_PAGE.HOME }} />}
      footer={<SiteFooterLinks current={{ page: SITE_PAGE.HOME }} />}
      title="A better way to plan with agents."
      titleStyle={PUBLIC_TITLE.HERO}
      lead="Talk through a feature with Luke. He reads the code while you talk and writes a plan you can paste into Claude Code or Codex."
    >
      <PublicSection>
        <div className="flex flex-wrap items-center gap-3">
          <ButtonLink
            variant={BUTTON_VARIANT.PRIMARY}
            href={DMG_URL}
            onClick={() => captureSiteEvent(SITE_EVENT.DOWNLOAD_PRESS)}
          >
            Download for macOS
          </ButtonLink>
          <ButtonLink variant={BUTTON_VARIANT.OUTLINE} href={REPOSITORY_URL} icon={<GitHubMark />}>
            View on GitHub
          </ButtonLink>
        </div>

        {/* A requirement, not a sentence: mono is what the page reserves for
            technical tokens. */}
        <div className="mt-3">
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} font={TEXT_FONT.MONO}>
            macOS 14+ · Apple silicon
          </Text>
        </div>

        <DemoVideo />
      </PublicSection>
    </PublicPage>
  );
}
