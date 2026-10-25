import { WRITING_MARK } from "@luke/settings/shortcuts";
import { FormatToolbar, LinkField, POPOVER_SIDE, RectFloat } from "@luke/ui";
import { useRef } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * rect-float.tsx -- layers that stand by a box in the window rather than by
 * a button: a toolbar over words, and a link field under them, each laid in
 * the positioned box the words stand in.
 */

const ignore = () => undefined;

/** Words with a stretch of them marked as selected, a toolbar over the stretch and a link field under it. */
function FloatsByWords(): React.JSX.Element {
  const words = useRef<HTMLElement>(null);
  const box = () => words.current?.getBoundingClientRect();
  return (
    <div className="catalog-anchor catalog-popover-stage">
      <p>
        An admin invites a teammate by email, and the invite lands as a{" "}
        <mark ref={words}>single-use link</mark> that expires after a week.
      </p>
      <RectFloat open anchor={box}>
        <FormatToolbar marks={[WRITING_MARK.BOLD]} onMark={ignore} />
      </RectFloat>
      <RectFloat open anchor={box} side={POPOVER_SIDE.BELOW}>
        <LinkField onApply={ignore} onCancel={ignore} />
      </RectFloat>
    </div>
  );
}

function RectFloatExample(): React.JSX.Element {
  return (
    <CatalogSection id="rect-float" title="Over and under selected words">
      <FloatsByWords />
    </CatalogSection>
  );
}

export const RECT_FLOAT_EXAMPLE: Example = {
  id: "rect-float",
  title: "Rect float",
  Render: RectFloatExample,
};
