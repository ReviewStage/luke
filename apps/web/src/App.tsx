import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  BUTTON_VARIANT,
  ButtonLink,
  LANDING_SCENE,
  LandingPage,
  LandingSection,
  MARK_PROVIDER,
  ProviderMark,
  TEXT_LINK_HEIGHT,
  TextLink,
} from "@repo/ui";
import {
  REPOSITORY_URL,
  SITE_PAGE,
  SiteDownload,
  SiteFooterLinks,
  SiteNavigation,
  WEB_APP_URL,
} from "./SiteChrome";

/**
 * The landing: the one line beside the copper ball, then a section for each
 * of the product's features over the app's own screens at work, and the
 * close. A reader with an account signs in from the bar or under the hero's
 * download.
 */
export function App(): React.JSX.Element {
  return (
    <LandingPage
      bar={<SiteNavigation current={{ page: SITE_PAGE.HOME }} />}
      barCall={<SiteDownload />}
      title="An inbox for all your coding agents."
      actions={
        <>
          <SiteDownload />
          <TextLink href={WEB_APP_URL} height={TEXT_LINK_HEIGHT.CONTROL}>
            or sign in on the web
          </TextLink>
        </>
      }
      close={{
        title: "Free and open source.",
        actions: (
          <>
            <SiteDownload />
            <ButtonLink
              variant={BUTTON_VARIANT.OUTLINE}
              href={REPOSITORY_URL}
              icon={<ProviderMark provider={MARK_PROVIDER.GITHUB} />}
            >
              View on GitHub
            </ButtonLink>
          </>
        ),
      }}
      footer={<SiteFooterLinks current={{ page: SITE_PAGE.HOME }} />}
    >
      <LandingSection
        title="Monitor all your agents with one inbox."
        lead="Agents only post to your inbox when something needs your attention."
        scene={LANDING_SCENE.INBOX}
      />
      <LandingSection
        title="Agents work together."
        lead="They hand off work, message each other, and split tasks into sub-tasks."
        scene={LANDING_SCENE.AGENTS}
      />
      <LandingSection
        title="On every device."
        lead={`Use ${PRODUCT_NAME} on Mac or the web.`}
        scene={LANDING_SCENE.DEVICES}
      />
      <LandingSection
        title="Bring your own keys."
        lead="Use your Claude Code/Codex subscriptions or bring your own API keys."
        scene={LANDING_SCENE.KEYS}
      />
    </LandingPage>
  );
}
