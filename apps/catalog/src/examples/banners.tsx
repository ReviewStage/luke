/**
 * banners.tsx -- a notice in each look: a strip across a column in the
 * attention tone, a card over a document in either tone, and a quiet row in
 * its place's frame; then each in a narrow column, where the presses drop
 * beneath the words.
 */

import {
  AlertIcon,
  ArchiveIcon,
  BANNER_LOOK,
  BANNER_TONE,
  Banner,
  BUTTON_VARIANT,
  Button,
  GAP,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/** Every look, at the width the column gives them. */
function Looks(): React.JSX.Element {
  return (
    <Stack gap={GAP.FIELD}>
      <Banner
        look={BANNER_LOOK.STRIP}
        tone={BANNER_TONE.ATTENTION}
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
      <Banner look={BANNER_LOOK.CARD} tone={BANNER_TONE.ATTENTION} glyph={<AlertIcon />}>
        <Text variant={TEXT_VARIANT.SECTION}>Every new plan starts from this template</Text>
        <Text tone={TEXT_TONE.MUTED}>Edit it to change what a plan holds when it is made.</Text>
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
    </>
  );
}

export const BANNERS_EXAMPLE: Example = { id: "banners", title: "Banners", Render: Banners };
