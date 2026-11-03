import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  BUTTON_VARIANT,
  Button,
  LANDING_SCENE,
  LandingFacts,
  LandingPage,
  LandingSection,
  LostPage,
  ScrollArea,
} from "@repo/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * landing.tsx -- the product's landing: its bar, the one line beside the
 * copper ball, a feature over its scene, a feature with facts beside its
 * stage, and the close over the wordmark in dots, and the page an unknown
 * address is answered with, each in a frame that scrolls as a document would.
 * Every name and line is made up.
 */

function Bar(): React.JSX.Element {
  return (
    <nav className="catalog-public-banner" aria-label="Site">
      <span className="catalog-public-wordmark">{PRODUCT_NAME}</span>
      <span className="catalog-public-links">
        <span>Changelog</span>
        <span>Sign in</span>
      </span>
    </nav>
  );
}

function Landing(): React.JSX.Element {
  return (
    <LandingPage
      bar={<Bar />}
      title="An inbox for all your coding agents."
      lead="Agents post when they need you, and you answer them there."
      actions={<Button variant={BUTTON_VARIANT.PRIMARY}>Download for macOS</Button>}
      close={{
        title: "Free and open source.",
        lead: "The app and the service behind it are one repository.",
        actions: <Button variant={BUTTON_VARIANT.OUTLINE}>View on GitHub</Button>,
      }}
      footer={<span className="catalog-public-footer">Apache-2.0 · About · Privacy</span>}
    >
      <LandingSection
        title="One inbox for every agent."
        lead="Agents post only when something needs you."
        scene={LANDING_SCENE.INBOX}
      />
      <LandingSection
        title="Bring your own subscription."
        lead="Pick the model and effort for each agent."
        scene={LANDING_SCENE.MODELS}
        aside={
          <LandingFacts
            facts={[
              {
                title: "Your plan or your key",
                detail: "A plan you already pay for, or an API key.",
              },
              { title: "Per agent", detail: "Each agent runs on the model you pick for it." },
            ]}
          />
        }
      />
    </LandingPage>
  );
}

function Lost(): React.JSX.Element {
  return (
    <LostPage
      bar={<Bar />}
      footer={<span className="catalog-public-footer">Apache-2.0 · About · Privacy</span>}
      address="/docs/getting-startd"
      title="No agent could find this page."
      lead="It searched every branch and came back empty-handed."
      actions={<Button variant={BUTTON_VARIANT.PRIMARY}>Back to home</Button>}
    />
  );
}

function LandingExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="landing-page" title="The landing, its features, and its close">
        <div className="catalog-screen catalog-screen-public">
          <ScrollArea>
            <Landing />
          </ScrollArea>
        </div>
      </CatalogSection>
      <CatalogSection id="lost-page" title="The page an unknown address is answered with">
        <div className="catalog-screen catalog-screen-public">
          <ScrollArea>
            <Lost />
          </ScrollArea>
        </div>
      </CatalogSection>
    </>
  );
}

export const LANDING_EXAMPLE: Example = {
  id: "landing",
  title: "Landing",
  Render: LandingExample,
};
