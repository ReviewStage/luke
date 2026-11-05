/**
 * banners.tsx -- a notice in each look: a strip across a column in the
 * attention tone, a card over a document in either tone, a card whose glyph
 * is a failure's bare mark, and a quiet row in
 * its place's frame; then each in a narrow column, where the presses drop
 * beneath the words; and a strip whose words its column cuts short, fading
 * out at their end; and the strip a maintainer signed in as a member reads,
 * for a member with a name and one without.
 */

import {
  AlertIcon,
  ArchiveIcon,
  BANNER_GLYPH,
  BANNER_LOOK,
  Banner,
  BUTTON_VARIANT,
  Button,
  GAP,
  PauseIcon,
  PlayIcon,
  STATUS_TONE,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  ViewingAsBanner,
} from "@repo/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/** Every look, at the width the column gives them. */
function Looks(): React.JSX.Element {
  return (
    <Stack gap={GAP.FIELD}>
      <Banner
        look={BANNER_LOOK.STRIP}
        tone={STATUS_TONE.ATTENTION}
        glyph={<AlertIcon />}
        actions={<Button variant={BUTTON_VARIANT.OUTLINE}>Move to Acme</Button>}
      >
        This plan's repository, acme/relay, belongs to the Acme workspace.
      </Banner>
      <Banner
        look={BANNER_LOOK.CARD}
        glyph={<ArchiveIcon />}
        actions={<Button variant={BUTTON_VARIANT.PRIMARY}>Unarchive</Button>}
      >
        <Text variant={TEXT_VARIANT.SECTION}>This plan is archived</Text>
      </Banner>
      <Banner look={BANNER_LOOK.CARD} tone={STATUS_TONE.ATTENTION} glyph={<AlertIcon />}>
        <Text variant={TEXT_VARIANT.SECTION}>Every new plan starts from this template</Text>
        <Text tone={TEXT_TONE.MUTED}>Edit it to change what a plan holds when it is made.</Text>
      </Banner>
      <Banner
        look={BANNER_LOOK.CARD}
        tone={STATUS_TONE.DANGER}
        glyph={<AlertIcon />}
        glyphLook={BANNER_GLYPH.MARK}
        actions={
          <>
            <Button variant={BUTTON_VARIANT.OUTLINE}>Move to cloud</Button>
            <Button variant={BUTTON_VARIANT.PRIMARY}>Retry</Button>
          </>
        }
      >
        <Text variant={TEXT_VARIANT.LABEL}>Studio can't reach acme/relay on GitHub.</Text>
        <Text tone={TEXT_TONE.MUTED}>Sign in on that Mac, then retry.</Text>
      </Banner>
      <div className="catalog-frame">
        <Banner
          look={BANNER_LOOK.ROW}
          glyph={<ArchiveIcon />}
          actions={
            <>
              <Button>Stop</Button>
              <Button variant={BUTTON_VARIANT.PRIMARY}>Unarchive</Button>
            </>
          }
        >
          <Text>Sam archived this agent: superseded by the new flow</Text>
        </Banner>
      </div>
      <div className="catalog-frame">
        <Banner
          look={BANNER_LOOK.INSET}
          tone={STATUS_TONE.DANGER}
          glyph={<PauseIcon />}
          actions={<Button icon={<PlayIcon />}>Resume</Button>}
        >
          Queue paused: the next message could not be sent
        </Banner>
      </div>
    </Stack>
  );
}

function Banners(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="banner-looks" title="Looks and tones">
        <Looks />
      </CatalogSection>
      <CatalogSection id="banner-narrow" title="Narrow column">
        <div className="catalog-narrow">
          <Looks />
        </div>
      </CatalogSection>
      <CatalogSection id="banner-cut" title="A strip's words cut short">
        <div className="catalog-strip-room">
          <Banner
            look={BANNER_LOOK.STRIP}
            tone={STATUS_TONE.ATTENTION}
            glyph={<AlertIcon />}
            actions={<Button variant={BUTTON_VARIANT.OUTLINE}>Move to Acme</Button>}
          >
            This plan's repository, acme/relay, belongs to the Acme workspace, which this account
            cannot push to.
          </Banner>
        </div>
      </CatalogSection>
      <CatalogSection id="banner-viewing-as" title="Viewing as a member">
        <Stack gap={GAP.FIELD}>
          <ViewingAsBanner
            member={{ name: "Ada Lovelace", email: "ada@example.com" }}
            onStop={() => Promise.resolve("The sign-in could not be stopped.")}
          />
          <ViewingAsBanner
            member={{ email: "ada@example.com" }}
            onStop={() => Promise.resolve(undefined)}
          />
        </Stack>
      </CatalogSection>
    </>
  );
}

export const BANNERS_EXAMPLE: Example = { id: "banners", title: "Banners", Render: Banners };
