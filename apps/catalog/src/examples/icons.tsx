import * as ui from "@repo/ui";
import { GAP, GlyphSlot, Inline, TEXT_VARIANT, Text } from "@repo/ui";
import { GLYPH, ICON_SIZE } from "@repo/ui/icons";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const GLYPH_EXPORTS = Object.entries(ui)
  .filter(([name, value]) => name.endsWith("Icon") && typeof value === "function")
  .map(([name, value]) => [name, value as () => React.JSX.Element] as const)
  .sort(([left], [right]) => left.localeCompare(right));

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
      <CatalogSection id="icons-exports" title="Every glyph the barrel exports">
        <div className="catalog-icon-grid">
          {GLYPH_EXPORTS.map(([name, Glyph]) => (
            <span key={name} className="catalog-glyph-line">
              <GlyphSlot size={ICON_SIZE.MEDIUM}>
                <Glyph />
              </GlyphSlot>
              <Text variant={TEXT_VARIANT.CAPTION}>{name}</Text>
            </span>
          ))}
        </div>
      </CatalogSection>
    </>
  );
}

export const ICONS_EXAMPLE: Example = {
  id: "icons",
  title: "Icons",
  Render: Icons,
};
