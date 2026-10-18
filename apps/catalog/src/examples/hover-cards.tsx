import {
  BUTTON_VARIANT,
  Button,
  DocumentIcon,
  FolderIcon,
  GAP,
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardHead,
  HoverCardList,
  HoverCardNote,
  HoverCardRow,
  HoverCardRule,
  Inline,
  PinIcon,
  TooltipCard,
  UserIcon,
} from "@luke/ui";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * hover-cards.tsx -- the words of a card hung in a pill's place: a head with
 * its glyph, line, and corner; notes wrapped and on one line faded at its
 * end; quieter rows under the name, one a press and one text; and a rule
 * before the rows it lists, counting what it leaves out, each row a button
 * the pointer crosses onto the card to press. Each card shows once the pointer rests on
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
  useEffect(() => {
    if (anchor === undefined) return;
    const holds = (node: EventTarget | null) =>
      node instanceof Node && (anchor.contains(node) || hung.current?.contains(node) === true);
    // Note that the pointer leaving lets a card go only while the keyboard does not hold it.
    const follow = (event: PointerEvent) => {
      const at = hung.current?.getBoundingClientRect();
      if (at === undefined || holds(document.activeElement)) return;
      if (!withinBoth(event.clientX, event.clientY, anchor.getBoundingClientRect(), at))
        setAnchor(undefined);
    };
    // Note that focus let fall to nothing, as a press on the card's words drops it, leaves the pointer to decide.
    const refocus = (event: FocusEvent) => {
      if (event.relatedTarget !== null && !holds(event.relatedTarget)) setAnchor(undefined);
    };
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAnchor(undefined);
    };
    // Note that focus and keys are heard at the document, because the card is portalled outside the control.
    document.addEventListener("pointermove", follow);
    document.addEventListener("focusout", refocus);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointermove", follow);
      document.removeEventListener("focusout", refocus);
      document.removeEventListener("keydown", dismiss);
    };
  }, [anchor]);
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the wrapper hears the pointer and the focus its button's own events bubble, because a shared button takes no handlers but its press. */}
      <span className="catalog-hinted" onPointerEnter={show} onFocus={show}>
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
          onChoice={() => setAnchor(undefined)}
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
            label="Task"
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
                <HoverCardRow
                  look={HOVER_CARD_ROW_LOOK.DETAIL}
                  glyph={<FolderIcon />}
                  label="acme/relay"
                  onPress={() => undefined}
                />
                <HoverCardRow
                  look={HOVER_CARD_ROW_LOOK.DETAIL}
                  glyph={<UserIcon />}
                  label="Created by Sam Rivera · 3d ago"
                />
                <HoverCardRule />
                <HoverCardList label="Agents" more="2 more">
                  <li>
                    <HoverCardRow
                      glyph={<DocumentIcon />}
                      label="Invite flow"
                      onPress={() => undefined}
                    />
                  </li>
                  <li>
                    <HoverCardRow
                      glyph={<DocumentIcon />}
                      label="Expire every invitation a week after it was sent, and say so in the email"
                      end="+120 −14"
                      onPress={() => undefined}
                    />
                  </li>
                </HoverCardList>
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
