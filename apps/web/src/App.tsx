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
      lead="Agents plan your tasks with you, build them in cloud sandboxes, and open the pull requests. When one needs a decision, a manual step, or your review, it posts to your Inbox."
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
        lead="Pick an option, fill in a form, mark a step done, or reply. Your answer goes back to the agent that asked."
        scene={LANDING_SCENE.INBOX}
      />
      <LandingSection
        title="Agents start other agents."
        lead="An agent can hand part of its work to a new agent and message it. Agents also split tasks into sub-tasks and mark which tasks block others."
        scene={LANDING_SCENE.AGENTS}
      />
      <LandingSection
        title="Automations start agents."
        lead="Set a prompt and a repository, and an agent starts on a schedule, a GitHub event such as a failed check, a new Sentry issue, or a webhook call."
        scene={LANDING_SCENE.AUTOMATIONS}
      />
      <LandingSection
        title="On your Mac and your phone."
        lead="The Mac app and the web app show the same tasks and threads, and the web app runs in your phone's browser."
        scene={LANDING_SCENE.DEVICES}
      />
      <LandingSection
        title="Your plan or your API key."
        lead="Agents run on Claude Code with your Claude plan, Codex with your ChatGPT plan, or either with an Anthropic or OpenAI API key."
        scene={LANDING_SCENE.MODELS}
        aside={
          <LandingFacts
            facts={[
              {
                title: "A model per agent",
                detail: "Agents in one task can each run on a different model and effort.",
              },
              {
                title: `Nothing billed by ${PRODUCT_NAME}`,
                detail: "Anthropic or OpenAI bills your plan or key for model calls.",
              },
              {
                title: "Settings › Agents",
                detail: "Add your plan or API key there before you start an agent.",
              },
            ]}
          />
        }
      />
    </LandingPage>
  );
}
