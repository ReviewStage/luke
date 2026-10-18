import {
  BUTTON_VARIANT,
  Button,
  GAP,
  Inline,
  PUBLIC_PAGE_WIDTH,
  PUBLIC_TITLE,
  PublicPage,
  PublicSection,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * public-page.tsx -- the landing's shape, a hero over its lead, acts, and
 * sections; a plain page under the profile's page title; a wide page with a
 * rail beside its words; and the landing in a phone's width, each in a frame that scrolls as a document would,
 * with the site's banner and footer. Every name and line is made up.
 */

const SECTIONS = [
  {
    id: "talk",
    title: "Talk it through",
    body: "Say what the feature is for. Luke asks what he needs to and reads the code while you talk.",
  },
  {
    id: "plan",
    title: "Get a plan",
    body: "The plan is written as you go, in steps an agent can follow, with the files each step touches.",
  },
  {
    id: "hand",
    title: "Hand it off",
    body: "Paste it into your coding agent of choice, or start one from Luke on acme-corporation-engineering-platform.",
  },
] as const;

function Banner(): React.JSX.Element {
  return (
    <nav className="catalog-public-banner" aria-label="Site">
      <span className="catalog-public-wordmark">Luke</span>
      <span className="catalog-public-links">
        <span>About</span>
        <span>Changelog</span>
      </span>
    </nav>
  );
}

function Footer(): React.JSX.Element {
  return <span className="catalog-public-footer">Apache-2.0 · macOS 14+ · About · Privacy</span>;
}

function Sections(): React.JSX.Element {
  return (
    <>
      {SECTIONS.map((section) => (
        <PublicSection key={section.id} title={section.title}>
          <Text>{section.body}</Text>
        </PublicSection>
      ))}
    </>
  );
}

function Landing(): React.JSX.Element {
  return (
    <PublicPage
      banner={<Banner />}
      footer={<Footer />}
      title="A better way to plan with agents."
      titleStyle={PUBLIC_TITLE.HERO}
      lead="Talk through a feature with Luke. He reads the code while you talk and writes a plan you can paste into your coding agent."
    >
      <PublicSection>
        <Inline gap={GAP.CONTROL}>
          <Button variant={BUTTON_VARIANT.PRIMARY}>Download for macOS</Button>
          <Button variant={BUTTON_VARIANT.OUTLINE}>View on GitHub</Button>
        </Inline>
      </PublicSection>
      <Sections />
    </PublicPage>
  );
}

function About(): React.JSX.Element {
  return (
    <PublicPage banner={<Banner />} footer={<Footer />} title="About">
      <PublicSection title="Who we are">
        <Stack gap={GAP.FIELD}>
          <Text>Ada Lovelace and Grace Hopper build Luke from a small room in Acme City.</Text>
          <Text>Both spent years writing the agents they now plan with.</Text>
        </Stack>
      </PublicSection>
      <PublicSection title="Contact">
        <Text>Write to founders@acme-corporation.example.</Text>
      </PublicSection>
    </PublicPage>
  );
}

const RELEASES = [
  {
    version: "2.4.0",
    date: "October 9",
    body: "Tasks keep their place when you switch workspaces, and a long step wraps instead of running off the card.",
  },
  {
    version: "2.3.1",
    date: "September 30",
    body: "Starting an agent from acme-corporation-engineering-platform no longer asks twice for the repository.",
  },
] as const;

function Changelog(): React.JSX.Element {
  return (
    <PublicPage
      banner={<Banner />}
      footer={<Footer />}
      title="Changelog"
      width={PUBLIC_PAGE_WIDTH.WIDE}
    >
      {RELEASES.map((release) => (
        <PublicSection key={release.version}>
          <div className="catalog-public-release">
            <Stack gap={GAP.TIGHT}>
              <Text variant={TEXT_VARIANT.LABEL}>v{release.version}</Text>
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {release.date}
              </Text>
            </Stack>
            <Text>{release.body}</Text>
          </div>
        </PublicSection>
      ))}
    </PublicPage>
  );
}

function PublicPages(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="public-page-hero" title="A hero, its lead, and sections">
        <div className="catalog-screen catalog-screen-public">
          <Landing />
        </div>
      </CatalogSection>
      <CatalogSection id="public-page-title" title="A plain page title">
        <div className="catalog-screen catalog-screen-public">
          <About />
        </div>
      </CatalogSection>
      <CatalogSection id="public-page-wide" title="A wide page with a rail">
        <div className="catalog-screen catalog-screen-public">
          <Changelog />
        </div>
      </CatalogSection>
      <CatalogSection id="public-page-phone" title="A phone's width">
        <div className="catalog-screen catalog-screen-phone catalog-screen-public">
          <Landing />
        </div>
      </CatalogSection>
    </>
  );
}

export const PUBLIC_PAGE_EXAMPLE: Example = {
  id: "public-page",
  title: "Public page",
  Render: PublicPages,
};
