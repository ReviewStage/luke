import {
  BUTTON_SHAPE,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  ComposeIcon,
  ExternalIcon,
  FoldingButton,
  type FoldingButtonHint,
  GAP,
  Inline,
  PlusIcon,
  Stack,
  TooltipPill,
  UpdateIcon,
} from "@luke/ui";
import { cloneElement, useId, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * folding-buttons.tsx -- a toolbar's folding buttons with their words drawn,
 * folded to their glyphs, busy either way, round in the tinted looks a
 * release's presses wear, and in a toolbar that folds them once it is
 * narrower than 360px, which its corner resizes. Folded, each
 * raises its words in a pill while the pointer rests on it or the keyboard
 * reaches it: the catalog's own stand-in for the timing an app gives its
 * hints.
 */

/** The catalog's hint: a pill over the button while the pointer or the keyboard is on it, where it is handed words. */
const Hint: FoldingButtonHint = ({ label, children }) => {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | undefined>(undefined);
  const show = (event: { currentTarget: HTMLElement }) => setAnchor(event.currentTarget);
  const hide = () => setAnchor(undefined);
  return (
    <>
      {cloneElement(children, {
        onPointerEnter: show,
        onPointerLeave: hide,
        onFocus: show,
        onBlur: hide,
      })}
      {anchor === undefined || label === undefined ? null : (
        <TooltipPill id={id} anchor={anchor} instant={false} label={label} />
      )}
    </>
  );
};

/** A toolbar's acts: the way back, Send feedback, and an outlined Run now, busy where asked. */
function Acts({ busy = false }: { busy?: boolean }): React.JSX.Element {
  return (
    <Inline gap={GAP.CONTROL}>
      <FoldingButton label="Automations" icon={<ComposeIcon />} hint={Hint} />
      <FoldingButton label="Send feedback" icon={<PlusIcon />} hint={Hint} />
      <FoldingButton
        label="Run now"
        icon={<PlusIcon />}
        variant={BUTTON_VARIANT.OUTLINE}
        busy={busy ? "Running" : undefined}
        hint={Hint}
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
        hint={Hint}
      />
      <FoldingButton
        label="Download"
        icon={<ExternalIcon />}
        variant={BUTTON_VARIANT.DANGER_TINT}
        shape={BUTTON_SHAPE.ROUND}
        size={BUTTON_SIZE.COMPACT}
        hint={Hint}
      />
    </Inline>
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
