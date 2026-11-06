import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  BUTTON_VARIANT,
  Button,
  CheckIcon,
  CodeIcon,
  DocumentIcon,
  GAP,
  GLYPH_ARRIVAL,
  GLYPH_INK,
  GlyphSlot,
  ProductMark,
  Stack,
  TEXT_VARIANT,
  Text,
  UserIcon,
} from "@repo/ui";
import { ICON_SIZE } from "@repo/ui/icons";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

function ArrivingStep(): React.JSX.Element {
  const [done, setDone] = useState(false);
  const [moved, setMoved] = useState(false);
  return (
    <Stack gap={GAP.CONTROL}>
      <span className="catalog-glyph-line">
        <GlyphSlot
          key={String(done)}
          ink={done ? GLYPH_INK.MUTED : GLYPH_INK.TEXT}
          label={done ? "Done" : "In progress"}
          arrival={moved ? (done ? GLYPH_ARRIVAL.CHECK : GLYPH_ARRIVAL.STEP) : undefined}
        >
          {done ? <CheckIcon /> : <CodeIcon />}
        </GlyphSlot>
        <Text variant={TEXT_VARIANT.CAPTION}>Send the invite email</Text>
      </span>
      <Button
        variant={BUTTON_VARIANT.OUTLINE}
        onClick={() => {
          setMoved(true);
          setDone((now) => !now);
        }}
      >
        {done ? "Take it up again" : "Mark it done"}
      </Button>
    </Stack>
  );
}

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
              <ProductMark fill inherit />
            </GlyphSlot>
            <Text variant={TEXT_VARIANT.CAPTION}>{PRODUCT_NAME}'s note on lines 3–4</Text>
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
      <CatalogSection id="glyph-slots-inset" title="Inset, an outline beside a person's mark">
        <Stack gap={GAP.CONTROL}>
          <span className="catalog-glyph-line">
            <GlyphSlot size={ICON_SIZE.MEDIUM} inset>
              <DocumentIcon />
            </GlyphSlot>
            <Text variant={TEXT_VARIANT.CAPTION}>Teammate invitations</Text>
          </span>
          <span className="catalog-glyph-line">
            <GlyphSlot size={ICON_SIZE.MEDIUM}>
              <UserIcon />
            </GlyphSlot>
            <Text variant={TEXT_VARIANT.CAPTION}>Ada Lovelace</Text>
          </span>
        </Stack>
      </CatalogSection>
      <CatalogSection id="glyph-slots-arrival" title="Arriving as its step changes">
        <ArrivingStep />
      </CatalogSection>
      <CatalogSection id="glyph-slots-sized" title="Sized by its container">
        <span className="catalog-glyph-line catalog-glyph-large">
          <GlyphSlot ink={GLYPH_INK.VOICE}>
            <ProductMark fill inherit />
          </GlyphSlot>
          <Text variant={TEXT_VARIANT.CAPTION}>{PRODUCT_NAME}</Text>
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
