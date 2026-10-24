import { GAP, GlyphSlot, Inline, TEXT_VARIANT, Text } from "@luke/ui";
import { GLYPH, ICON_SIZE } from "@luke/ui/icons";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * icons.tsx -- every concept the app draws as an icon, each with the one
 * glyph that stands for it, and the four seats an icon is drawn at: 12 beside
 * a caption's words, 16 in a button or a menu row, 20 as a row's lead, and 40
 * over an empty state.
 */

const SEAT_CONCEPTS = ["TASK", "AGENT", "PULL_REQUEST", "INBOX"] as const;

function Icons(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="icons-registry" title="One glyph for each concept">
        <div className="catalog-icon-grid">
          {Object.entries(GLYPH).map(([concept, Glyph]) => (
            <span key={concept} className="catalog-glyph-line">
              <GlyphSlot size={ICON_SIZE.MEDIUM}>
                <Glyph />
              </GlyphSlot>
              <Text variant={TEXT_VARIANT.CAPTION}>{concept}</Text>
            </span>
          ))}
        </div>
      </CatalogSection>
      <CatalogSection id="icons-seats" title="Four seats">
        <Inline gap={GAP.SECTION}>
          {Object.values(ICON_SIZE).map((seat) => (
            <Inline key={seat} gap={GAP.CONTROL}>
              {SEAT_CONCEPTS.map((concept) => {
                const Glyph = GLYPH[concept];
                return (
                  <GlyphSlot key={concept} size={seat}>
                    <Glyph />
                  </GlyphSlot>
                );
              })}
              <Text variant={TEXT_VARIANT.CAPTION}>{seat}</Text>
            </Inline>
          ))}
        </Inline>
      </CatalogSection>
    </>
  );
}

export const ICONS_EXAMPLE: Example = {
  id: "icons",
  title: "Icons",
  Render: Icons,
};
