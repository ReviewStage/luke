import {
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_TONE,
  TEXT_TRUNCATE,
  TEXT_VARIANT,
  Text,
  VISUALLY_HIDDEN_UNDER,
  VisuallyHidden,
} from "@luke/ui";
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
          <p className="catalog-inherited">
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.INHERIT} truncate>
              {LONG}
            </Text>
          </p>
        </div>
      </CatalogSection>
      <CatalogSection id="typography-truncated-start" title="A path, cut from its start">
        <div className="catalog-narrow">
          <Text
            as={TEXT_ELEMENT.SPAN}
            variant={TEXT_VARIANT.CAPTION}
            truncate={TEXT_TRUNCATE.START}
          >
            <bdi>packages/panel/src/tasks/cloud-browser/address-bar-model.ts</bdi>
          </Text>
        </div>
      </CatalogSection>
      <CatalogSection id="typography-under" title="Words that give way in a narrow room">
        <div className="catalog-narrow catalog-room">
          <p className="catalog-stack">
            Draws until its room is under the tight step
            <VisuallyHidden under={VISUALLY_HIDDEN_UNDER.TIGHT}>
              {" "}
              (and then is only read)
            </VisuallyHidden>
          </p>
        </div>
      </CatalogSection>
      <CatalogSection id="typography-hidden" title="Spoken and not drawn">
        <p className="catalog-stack">
          A glyph says its state
          <VisuallyHidden> (unread: this is read aloud and drawn nowhere)</VisuallyHidden>
        </p>
      </CatalogSection>
    </>
  );
}

export const TYPOGRAPHY_EXAMPLE: Example = {
  id: "typography",
  title: "Typography",
  Render: Typography,
};
