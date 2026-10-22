import {
  BUTTON_SHAPE,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  ComposeIcon,
  ExternalIcon,
  FoldingButton,
  GAP,
  Inline,
  PlusIcon,
  Stack,
  UpdateIcon,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * folding-buttons.tsx -- a toolbar's folding buttons with their words drawn,
 * folded to their glyphs, busy either way, round in the tinted looks a
 * release's presses wear, and in a toolbar that folds them once it is
 * narrower than 360px, which its corner resizes. Folded, each
 * raises its words in the window's tooltip once the pointer rests on it or
 * the keyboard reaches it.
 */

/** A toolbar's acts: the way back, Send feedback, and an outlined Run now, busy where asked. */
function Acts({ busy = false }: { busy?: boolean }): React.JSX.Element {
  return (
    <Inline gap={GAP.CONTROL}>
      <FoldingButton label="Automations" icon={<ComposeIcon />} />
      <FoldingButton label="Send feedback" icon={<PlusIcon />} />
      <FoldingButton
        label="Run now"
        icon={<PlusIcon />}
        variant={BUTTON_VARIANT.OUTLINE}
        busy={busy ? "Running" : undefined}
      />
    </Inline>
  );
}

/** A release's presses: Restart on the working wash, and Download on the danger wash, round and compact. */
function Tinted(): React.JSX.Element {
  return (
    <Inline gap={GAP.CONTROL}>
      <FoldingButton
        label="Restart"
        icon={<UpdateIcon />}
        variant={BUTTON_VARIANT.WORKING_TINT}
        shape={BUTTON_SHAPE.ROUND}
        size={BUTTON_SIZE.COMPACT}
      />
      <FoldingButton
        label="Download"
        icon={<ExternalIcon />}
        variant={BUTTON_VARIANT.DANGER_TINT}
        shape={BUTTON_SHAPE.ROUND}
        size={BUTTON_SIZE.COMPACT}
      />
    </Inline>
  );
}

/** A group's fold: a row-wide press, its glyph then its words, and a count inside its fill. */
function Counted(): React.JSX.Element {
  return (
    <FoldingButton
      label="Todo"
      icon={<PlusIcon />}
      variant={BUTTON_VARIANT.ROW}
      trailing={3}
      aria-expanded
    />
  );
}

function FoldingButtons(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="folding-drawn" title="Words drawn">
        <Acts />
      </CatalogSection>
      <CatalogSection id="folding-folded" title="Folded">
        <div className="catalog-folded">
          <Acts />
        </div>
      </CatalogSection>
      <CatalogSection id="folding-busy" title="Busy, drawn and folded">
        <Stack gap={GAP.CONTROL}>
          <Acts busy />
          <div className="catalog-folded">
            <Acts busy />
          </div>
        </Stack>
      </CatalogSection>
      <CatalogSection id="folding-tinted" title="Round and tinted, drawn and folded">
        <Stack gap={GAP.CONTROL}>
          <Tinted />
          <div className="catalog-folded">
            <Tinted />
          </div>
        </Stack>
      </CatalogSection>
      <CatalogSection id="folding-counted" title="Row look with a count">
        <Counted />
      </CatalogSection>
      <CatalogSection id="folding-toolbar" title="Folding with its toolbar">
        <div className="catalog-folding-toolbar">
          <div>
            <Acts />
          </div>
        </div>
      </CatalogSection>
    </>
  );
}

export const FOLDING_BUTTONS_EXAMPLE: Example = {
  id: "folding-buttons",
  title: "Folding buttons",
  Render: FoldingButtons,
};
