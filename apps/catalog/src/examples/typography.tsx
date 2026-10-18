import { TEXT_ELEMENT, TEXT_FONT, TEXT_TONE, TEXT_VARIANT, Text } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * typography.tsx -- every type role in each ink and each face, then roles set
 * on elements of other levels, and a long line set in a narrow column, both
 * wrapped and cut to one line, on synthetic words.
 */

const LONG =
  "A plan's summary runs as long as the developer talked, so it wraps rather than stretching its column: unbrokenwordslikethisoneareweighedtoo.";

function Typography(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="typography-roles" title="Roles">
        <div className="catalog-stack">
          {Object.values(TEXT_VARIANT).map((variant) => (
            <Text key={variant} variant={variant} as={TEXT_ELEMENT.DIV}>
              The {variant} role sets these words
            </Text>
          ))}
        </div>
      </CatalogSection>
      <CatalogSection id="typography-tones" title="Tones">
        <div className="catalog-stack">
          {Object.values(TEXT_TONE).map((tone) => (
            <Text key={tone} tone={tone}>
              Body words in the {tone} ink
            </Text>
          ))}
        </div>
      </CatalogSection>
      <CatalogSection id="typography-faces" title="Faces">
        <div className="catalog-stack">
          {Object.values(TEXT_FONT).map((font) => (
            <Text key={font} variant={TEXT_VARIANT.CAPTION} font={font}>
              v0.42.0 · macOS 14+ in the {font} face
            </Text>
          ))}
        </div>
      </CatalogSection>
      <CatalogSection id="typography-levels" title="Roles apart from levels">
        <div className="catalog-stack">
          <Text variant={TEXT_VARIANT.TITLE} as={TEXT_ELEMENT.H3}>
            A title at heading level three
          </Text>
          <Text variant={TEXT_VARIANT.CAPTION} as={TEXT_ELEMENT.H2}>
            A caption at heading level two
          </Text>
        </div>
      </CatalogSection>
      <CatalogSection id="typography-narrow" title="Narrow column, long words">
        <div className="catalog-narrow">
          <Text variant={TEXT_VARIANT.SECTION} as={TEXT_ELEMENT.H3}>
            {LONG}
          </Text>
          <Text tone={TEXT_TONE.MUTED}>{LONG}</Text>
        </div>
      </CatalogSection>
      <CatalogSection id="typography-truncated" title="Narrow column, cut to one line">
        <div className="catalog-narrow">
          <Text variant={TEXT_VARIANT.SECTION} as={TEXT_ELEMENT.H3} truncate>
            {LONG}
          </Text>
          <Text tone={TEXT_TONE.MUTED} truncate>
            {LONG}
          </Text>
        </div>
      </CatalogSection>
    </>
  );
}

export const TYPOGRAPHY_EXAMPLE: Example = {
  id: "typography",
  title: "Typography",
  Render: Typography,
};
