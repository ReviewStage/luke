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
      lead="Agents work in cloud sandboxes, open pull requests, and post to your Inbox when they need you."
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
        title="Answer from the Inbox."
        lead="Pick an option or reply, and the agent carries on."
        scene={LANDING_SCENE.INBOX}
      />
      <LandingSection
        title="Agents start other agents."
        lead="They hand off work, message each other, and split tasks into sub-tasks."
        scene={LANDING_SCENE.AGENTS}
      />
      <LandingSection
        title="Automations start agents."
        lead="On a schedule, a GitHub event, a Sentry issue, or a webhook."
        scene={LANDING_SCENE.AUTOMATIONS}
      />
      <LandingSection
        title="On your Mac and your phone."
        lead="The Mac app and the web app show the same tasks and threads."
        scene={LANDING_SCENE.DEVICES}
      />
      <LandingSection
        title="Your plan or your API key."
        lead="Claude Code on your Claude plan, or Codex on your ChatGPT plan."
        scene={LANDING_SCENE.MODELS}
      />
    </LandingPage>
  );
}
