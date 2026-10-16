import {
  BUTTON_VARIANT,
  Button,
  GAP,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  HoverCardRule,
  Inline,
  PinIcon,
  TooltipCard,
} from "@luke/ui";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * hover-cards.tsx -- the words of a card hung in a pill's place: a head with
 * its glyph, line, and corner; notes wrapped and on one line faded at its
 * end; and a rule before the rows it lists, one of them a button the pointer
 * crosses onto the card to press. Each card shows once the pointer rests on
 * its control or the keyboard reaches it, and stands while the pointer is on
 * the control, on the card, or between them: the catalog's own stand-in for
 * the linger an app gives its cards.
 */

/** Whether the point `x`, `y` stands within the box spanning both rectangles, the gap between them included. */
function withinBoth(x: number, y: number, one: DOMRect, other: DOMRect): boolean {
  return (
    x >= Math.min(one.left, other.left) &&
    x <= Math.max(one.right, other.right) &&
    y >= Math.min(one.top, other.top) &&
    y <= Math.max(one.bottom, other.bottom)
  );
}

/** A control hanging `card` for itself while the pointer rests on it, on the card, or between them, or it has the keyboard's focus. */
function Carded({ label, card }: { label: string; card: ReactNode }): React.JSX.Element {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | undefined>(undefined);
  const hung = useRef<HTMLElement | null>(null);
  const show = (event: { currentTarget: HTMLElement }) => setAnchor(event.currentTarget);
  const hide = () => setAnchor(undefined);
  useEffect(() => {
    if (anchor === undefined) return;
    const follow = (event: PointerEvent) => {
      const at = hung.current?.getBoundingClientRect();
      if (at === undefined) return;
      if (!withinBoth(event.clientX, event.clientY, anchor.getBoundingClientRect(), at)) {
        setAnchor(undefined);
      }
    };
    document.addEventListener("pointermove", follow);
    return () => document.removeEventListener("pointermove", follow);
  }, [anchor]);
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the wrapper hears the pointer and the focus its button's own events bubble, because a shared button takes no handlers but its press. */}
      <span
        className="catalog-hinted"
        onPointerEnter={show}
        onFocus={show}
        onBlur={(event) => {
          // Note that focus moving onto the card's own button keeps it hung, so the press lands.
          if (
            !(event.relatedTarget instanceof Node && hung.current?.contains(event.relatedTarget))
          ) {
            hide();
          }
        }}
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
      {anchor === undefined ? null : (
        <TooltipCard
          id={id}
          anchor={anchor}
          instant={false}
          ref={(element) => {
            hung.current = element;
          }}
          onChoice={hide}
        >
          {card}
        </TooltipCard>
      )}
    </>
  );
}

function HoverCards(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="hover-card-heads" title="Heads">
        <Inline gap={GAP.CONTROL}>
          <Carded
            label="Plan"
            card={
              <HoverCard>
                <HoverCardHead name="Teammate invitations" sub="acme/relay" corner="3h" />
                <HoverCardNote>
                  Expire an invitation after a week, and let its sender send it again.
                </HoverCardNote>
              </HoverCard>
            }
          />
          <Carded
            label="Skill"
            card={
              <HoverCard>
                <HoverCardHead glyph={<PinIcon />} name="/release" />
                <HoverCardNote>Cut a release.</HoverCardNote>
              </HoverCard>
            }
          />
          <Carded
            label="Long names"
            card={
              <HoverCard>
                <HoverCardHead
                  name="Move every scheduled automation onto the workspace's own timezone, and say which ones ran late"
                  corner="Working…"
                />
                <HoverCardHead
                  oneLine
                  name="A task standing in for a title, too long for its one line"
                  corner="12m"
                />
                <HoverCardNote oneLine>
                  Reading packages/service/src/maintenance/maintenance-sweep.ts and its tests
                </HoverCardNote>
              </HoverCard>
            }
          />
        </Inline>
      </CatalogSection>
      <CatalogSection id="hover-card-rows" title="Rows under a rule">
        <Inline gap={GAP.CONTROL}>
          <Carded
            label="Agents"
            card={
              <HoverCard>
                <HoverCardHead name="Teammate invitations" corner="2 working" />
                <HoverCardRule />
                <Inline gap={GAP.CONTROL}>
                  <Button variant={BUTTON_VARIANT.OUTLINE}>Open Invite flow</Button>
                  <Button variant={BUTTON_VARIANT.OUTLINE}>Open Expiry sweep</Button>
                </Inline>
              </HoverCard>
            }
          />
        </Inline>
      </CatalogSection>
    </>
  );
}

export const HOVER_CARDS_EXAMPLE: Example = {
  id: "hover-cards",
  title: "Hover cards",
  Render: HoverCards,
};
