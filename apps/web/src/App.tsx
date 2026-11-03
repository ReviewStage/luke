import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  BUTTON_VARIANT,
  ButtonLink,
  LANDING_SCENE,
  LandingFacts,
  LandingPage,
  LandingSection,
  MARK_PROVIDER,
  ProviderMark,
  TEXT_LINK_HEIGHT,
  TEXT_VARIANT,
  TextLink,
} from "@repo/ui";
import { captureSiteEvent, SITE_EVENT } from "./analytics";
import {
  DMG_URL,
  REPOSITORY_URL,
  SITE_PAGE,
  SiteFooterLinks,
  SiteNavigation,
  WEB_APP_URL,
} from "./SiteChrome";

/** The download, the one call every part of the landing makes, counted wherever it is pressed. */
function Download(): React.JSX.Element {
  return (
    <ButtonLink
      variant={BUTTON_VARIANT.PRIMARY}
      href={DMG_URL}
      onClick={() => captureSiteEvent(SITE_EVENT.DOWNLOAD_PRESS)}
    >
      Download for macOS
    </ButtonLink>
  );
}

/**
 * The landing: the one line beside the copper ball, then a section for each
 * of the product's features over the app's own screens at work, and the
 * close. A reader with an account signs in from the bar or under the hero's
 * download.
 */
export function App(): React.JSX.Element {
  return (
    <LandingPage
      bar={
        <SiteNavigation
          current={{ page: SITE_PAGE.HOME }}
          calls={
            <TextLink
              href={WEB_APP_URL}
              variant={TEXT_VARIANT.LABEL}
              height={TEXT_LINK_HEIGHT.CONTROL}
            >
              Sign in
            </TextLink>
          }
        />
      }
      barCall={<Download />}
      title="An inbox for all your coding agents."
      lead="Agents post to your Inbox when they need a decision, a manual step, or your eyes on something, and you answer them there. They work in cloud sandboxes on your own Claude or ChatGPT subscription or API key."
      actions={
        <>
          <Download />
          <TextLink href={WEB_APP_URL} height={TEXT_LINK_HEIGHT.CONTROL}>
            or sign in on the web
          </TextLink>
        </>
      }
      close={{
        title: "Free and open source.",
        lead: "Apache 2.0. The Mac app, the web app, and the service behind them are one repository.",
        actions: (
          <>
            <Download />
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
        title="One inbox for every agent."
        lead="Agents post only when something needs you: a decision, a to-do, or something to look at. Answer in the thread, and they carry on."
        scene={LANDING_SCENE.INBOX}
      />
      <LandingSection
        title="Agents work together."
        lead="They start other agents, message each other, and keep your board current, while you get on with something else."
        scene={LANDING_SCENE.AGENTS}
      />
      <LandingSection
        title="Start agents from your tools."
        lead="A schedule, a GitHub event, a Sentry issue, or a webhook starts an agent on a task of its own, with the prompt and repository you set."
        scene={LANDING_SCENE.AUTOMATIONS}
      />
      <LandingSection
        title="On every device."
        lead="The Mac app, your browser, and your phone show the same tasks and threads."
        scene={LANDING_SCENE.DEVICES}
      />
      <LandingSection
        title="Bring your own subscription."
        lead="Agents run on Claude Code or Codex, on your Claude or ChatGPT plan or your own API key. Pick the model and effort for each agent."
        scene={LANDING_SCENE.MODELS}
        aside={
          <LandingFacts
            facts={[
              {
                title: "Your plan or your key",
                detail:
                  "Claude Code runs on your Claude plan, Codex on your ChatGPT plan, or either on an API key.",
              },
              {
                title: "No tokens billed by us",
                detail: `${PRODUCT_NAME} pays for no model calls, and charges for none.`,
              },
              {
                title: "Per agent",
                detail:
                  "Mix them in one task: each agent runs on the model and effort you pick for it.",
              },
            ]}
          />
        }
      />
    </LandingPage>
  );
}
