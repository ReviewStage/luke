import {
  BUTTON_VARIANT,
  Button,
  GAP,
  Inline,
  TEXT_TONE,
  Text,
  TooltipCard,
  TooltipPill,
} from "@luke/ui";
import { type ReactNode, useId, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * tooltips.tsx -- a pill naming a control, with and without its chord, a
 * long one held inside the window, and a card in a pill's place, under its
 * control and beside it. Each shows once the pointer rests on its control
 * or the keyboard reaches it, and goes when either leaves or on Escape: the
 * catalog's own stand-in for the timing an app gives its hints.
 */

/** A control showing `hint` for itself while the pointer rests on it or it has the keyboard's focus. */
function Hinted({
  label,
  hint,
}: {
  label: string;
  hint: (props: { id: string; anchor: HTMLElement; instant: boolean }) => ReactNode;
}): React.JSX.Element {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | undefined>(undefined);
  const show = (event: { currentTarget: HTMLElement }) => setAnchor(event.currentTarget);
  const hide = () => setAnchor(undefined);
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the wrapper hears the pointer and the focus its button's own events bubble, because a shared button takes no handlers but its press. */}
      <span
        className="catalog-hinted"
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(event) => {
          if (event.key === "Escape") hide();
        }}
      >
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
          aria-describedby={anchor === undefined ? undefined : id}
        >
          {label}
        </Button>
      </span>
      {anchor === undefined ? null : hint({ id, anchor, instant: false })}
    </>
  );
}

function Tooltips(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="tooltip-pills" title="Pills">
        <Inline gap={GAP.CONTROL}>
          <Hinted
            label="Archive"
            hint={(props) => (
              <TooltipPill {...props} label="Archive plan" shortcut={<kbd>⌘E</kbd>} />
            )}
          />
          <Hinted label="Share" hint={(props) => <TooltipPill {...props} label="Copy link" />} />
          <Hinted
            label="Long address"
            hint={(props) => (
              <TooltipPill
                {...props}
                label="https://example.com/a/very/long/address/that/is/wider/than/a/narrow/window/and/breaks/where/it/must"
              />
            )}
          />
        </Inline>
      </CatalogSection>
      <CatalogSection id="tooltip-cards" title="Cards">
        <Inline gap={GAP.CONTROL}>
          <Hinted
            label="Launch plan"
            hint={(props) => (
              <TooltipCard {...props}>
                <Text>Launch plan</Text>
                <Text tone={TEXT_TONE.MUTED}>
                  Draft the announcement, confirm the date with the team, and schedule the post.
                </Text>
              </TooltipCard>
            )}
          />
          <Hinted
            label="Beside"
            hint={(props) => (
              <TooltipCard {...props} beside>
                <Text>A row's card</Text>
                <Text tone={TEXT_TONE.MUTED}>Hung beside the row, so it covers none under it.</Text>
              </TooltipCard>
            )}
          />
        </Inline>
      </CatalogSection>
    </>
  );
}

export const TOOLTIPS_EXAMPLE: Example = { id: "tooltips", title: "Tooltips", Render: Tooltips };
