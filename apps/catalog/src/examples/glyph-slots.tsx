import {
  CheckIcon,
  CodeIcon,
  GAP,
  GLYPH_INK,
  GlyphSlot,
  Stack,
  TEXT_VARIANT,
  Text,
  WingFace,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * glyph-slots.tsx -- a glyph's seat before a line's words in each ink: a
 * call's muted glyph, the full ink of the one item in progress, the ink its
 * holder sets, and Luke's face in his blue; a to-do's seat as tall as its
 * first line before words that wrap; and a slot its container sizes larger.
 */

function GlyphSlots(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="glyph-slots-inks" title="Each ink, before a line's words">
        <Stack gap={GAP.CONTROL}>
          <span className="catalog-glyph-line">
            <GlyphSlot>
              <CodeIcon />
            </GlyphSlot>
            <Text variant={TEXT_VARIANT.CAPTION}>Read src/invites/send.ts</Text>
          </span>
          <span className="catalog-glyph-line">
            <GlyphSlot ink={GLYPH_INK.TEXT} label="In progress">
              <CheckIcon />
            </GlyphSlot>
            <Text variant={TEXT_VARIANT.CAPTION}>Send the invite email</Text>
          </span>
          <span className="catalog-glyph-line catalog-glyph-line-accent">
            <GlyphSlot ink={GLYPH_INK.INHERIT}>
              <CheckIcon />
            </GlyphSlot>
            <Text variant={TEXT_VARIANT.CAPTION}>In its holder's ink</Text>
          </span>
          <span className="catalog-glyph-line">
            <GlyphSlot ink={GLYPH_INK.VOICE}>
              <WingFace fill inherit />
            </GlyphSlot>
            <Text variant={TEXT_VARIANT.CAPTION}>Luke's note on lines 3–4</Text>
          </span>
        </Stack>
      </CatalogSection>
      <CatalogSection
        id="glyph-slots-line"
        title="As tall as its first line, before words that wrap"
      >
        <div className="catalog-narrow">
          <span className="catalog-glyph-line catalog-glyph-line-top">
            <GlyphSlot line label="Done">
              <CheckIcon />
            </GlyphSlot>
            <Text>Fold every copy of the 16px icon box into one seat the design system owns</Text>
          </span>
        </div>
      </CatalogSection>
      <CatalogSection id="glyph-slots-sized" title="Sized by its container">
        <span className="catalog-glyph-line catalog-glyph-large">
          <GlyphSlot ink={GLYPH_INK.VOICE}>
            <WingFace fill inherit />
          </GlyphSlot>
          <Text variant={TEXT_VARIANT.CAPTION}>Luke</Text>
        </span>
      </CatalogSection>
    </>
  );
}

export const GLYPH_SLOTS_EXAMPLE: Example = {
  id: "glyph-slots",
  title: "Glyph slots",
  Render: GlyphSlots,
};
