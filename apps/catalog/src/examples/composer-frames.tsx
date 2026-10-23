import {
  BUTTON_VARIANT,
  COMPOSER_ELEMENT,
  COMPOSER_LOOK,
  ComposerFrame,
  type ComposerLook,
  GAP,
  IconButton,
  Inline,
  JUSTIFY,
  PlusIcon,
  Stack,
  SUBMIT_STATE,
  TEXT_TONE,
  Text,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * composer-frames.tsx -- a composer's frame at each look: the window's
 * message box on the sidebar's ground, a field in a card's well, and bare,
 * where the card around it is the frame; then a box with files dragged over
 * it, its edge brightened.
 */

const ignore = () => undefined;

/** A box's words over its foot: the + at its left and Send at its right. */
function Box({
  look,
  dropping = false,
}: {
  look: ComposerLook;
  dropping?: boolean;
}): React.JSX.Element {
  return (
    <ComposerFrame
      as={COMPOSER_ELEMENT.FORM}
      look={look}
      dropping={dropping}
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="catalog-composer">
        <Stack gap={GAP.CONTROL}>
          <Text tone={TEXT_TONE.MUTED}>Ask Luke to change something…</Text>
          <Inline justify={JUSTIFY.BETWEEN}>
            <IconButton label="Attach files" icon={<PlusIcon />} onClick={ignore} />
            <IconButton
              label="Send"
              variant={BUTTON_VARIANT.INK}
              submit={SUBMIT_STATE.READY}
              onClick={ignore}
            />
          </Inline>
        </Stack>
      </div>
    </ComposerFrame>
  );
}

function ComposerFrames(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="composer-looks" title="Looks">
        <div className="catalog-column">
          <Stack gap={GAP.FIELD}>
            {Object.values(COMPOSER_LOOK).map((look) => (
              <Box key={look} look={look} />
            ))}
          </Stack>
        </div>
      </CatalogSection>
      <CatalogSection id="composer-dropping" title="Files dragged over it">
        <div className="catalog-column">
          <Box look={COMPOSER_LOOK.CARD} dropping />
        </div>
      </CatalogSection>
    </>
  );
}

export const COMPOSER_FRAMES_EXAMPLE: Example = {
  id: "composer-frames",
  title: "Composer frames",
  Render: ComposerFrames,
};
