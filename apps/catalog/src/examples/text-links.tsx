import {
  GAP,
  Inline,
  TEXT_LINK_CURRENT,
  TEXT_LINK_HEIGHT,
  TEXT_LINK_LOOK,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextLink,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * text-links.tsx -- a quiet row of links at a control's height with the
 * reader's place lifted, a quiet row in the surrounding caption type, an
 * underlined link and an external one in a sentence, and a long link in a
 * narrow column.
 */

function TextLinks(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="text-links-quiet" title="Quiet, where the reader is">
        <Inline gap={GAP.SECTION}>
          <TextLink
            href="#text-links-quiet"
            variant={TEXT_VARIANT.LABEL}
            height={TEXT_LINK_HEIGHT.CONTROL}
            current={TEXT_LINK_CURRENT.PAGE}
          >
            About
          </TextLink>
          <TextLink
            href="#text-links-quiet"
            variant={TEXT_VARIANT.LABEL}
            height={TEXT_LINK_HEIGHT.CONTROL}
          >
            Changelog
          </TextLink>
        </Inline>
      </CatalogSection>
      <CatalogSection id="text-links-caption" title="In the surrounding type">
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          <TextLink href="#text-links-caption">Privacy</TextLink> ·{" "}
          <TextLink href="#text-links-caption">Contact</TextLink>
        </Text>
      </CatalogSection>
      <CatalogSection id="text-links-sentence" title="In a sentence">
        <div className="catalog-column">
          <Text tone={TEXT_TONE.MUTED}>
            Nothing opened?{" "}
            <TextLink href="#text-links-sentence" look={TEXT_LINK_LOOK.UNDERLINED}>
              Get Luke
            </TextLink>{" "}
            and press again, or read the numbers in{" "}
            <TextLink href="#text-links-sentence" look={TEXT_LINK_LOOK.UNDERLINED} external newTab>
              the analytics processor
            </TextLink>
            .
          </Text>
        </div>
      </CatalogSection>
      <CatalogSection id="text-links-narrow" title="Narrow column, long words">
        <div className="catalog-narrow">
          <TextLink href="#text-links-narrow" variant={TEXT_VARIANT.LABEL}>
            ← Every release of Luke since the first public preview
          </TextLink>
        </div>
      </CatalogSection>
    </>
  );
}

export const TEXT_LINKS_EXAMPLE: Example = {
  id: "text-links",
  title: "Text links",
  Render: TextLinks,
};
