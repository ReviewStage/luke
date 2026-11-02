import { PRODUCT_NAME } from "@luke/features/product-name";
import {
  BUTTON_VARIANT,
  ButtonLink,
  MARK_PROVIDER,
  ProviderMark,
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
  REPOSITORY_URL,
  SITE_PAGE,
  SiteFooterLinks,
  SiteNavigation,
  WEB_APP_URL,
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
      title="An inbox for all your coding agents."
      titleStyle={PUBLIC_TITLE.HERO}
      lead="Agents post to your Inbox when they need a decision, a manual step, or your eyes on something, and you answer them there. They work in cloud sandboxes on your own Claude or ChatGPT subscription or API key."
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
          <ButtonLink variant={BUTTON_VARIANT.OUTLINE} href={WEB_APP_URL}>
            Open {PRODUCT_NAME} on the web
          </ButtonLink>
          <ButtonLink
            variant={BUTTON_VARIANT.OUTLINE}
            href={REPOSITORY_URL}
            icon={<ProviderMark provider={MARK_PROVIDER.GITHUB} />}
          >
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
