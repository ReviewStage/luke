import {
  AVATAR_SIZE,
  Avatar,
  BUTTON_VARIANT,
  Button,
  DocumentIcon,
  FolderIcon,
  GAP,
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardFigures,
  HoverCardHead,
  HoverCardList,
  HoverCardNote,
  HoverCardRow,
  HoverCardRule,
  HoverCardScroll,
  HoverCardSkeleton,
  Inline,
  PinIcon,
  Tooltip,
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
 * before the rows it lists, every one, scrolling and fading past a few rather
 * than counting the rest, each row a button the pointer crosses onto the
 * card to press, rows that open nothing yet hang a card of their own, and a
 * long body that is no list scrolling the same way; and a card's figures under a rule, each label at the card's edge
 * and its count at the other; and each card's skeleton beside it, its glyph or
 * its mark in the loaded card's slot, so its head stands still as what it says
 * is read. Each card shows once the pointer rests on
 * its control or the keyboard reaches it, and stands while the pointer is on
 * the control, on the card, or between them: the catalog's own stand-in for
 * the linger an app gives its cards.
 */

/** More agents than a card's list has height for, so the example scrolls. */
const CATALOG_AGENTS = [
  "Billing after downgrade",
  "Rate limit search",
  "Fix Safari login",
  "Onboarding checklist",
  "Self-hosting guide",
  "Migrate auth SDK",
  "Old onboarding copy",
] as const;

/** A server's tools, each hanging what it does from a row that opens nothing. */
const CATALOG_TOOLS = [
  { title: "List issues", summary: "List the team's issues." },
  { title: "Read an issue", summary: "Read one issue." },
  { title: "Comment", summary: "Comment on an issue." },
] as const;

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
                  corner="4m 12s"
                />
                <HoverCardHead
                  oneLine
                  name="A task standing in for a title, too long for its one line"
                  corner="12m"
                />
                <HoverCardNote oneLine>
                  Reading packages/service/src/maintenance/maintenance-sweep.ts and its tests
                </HoverCardNote>
                <HoverCardRow
                  look={HOVER_CARD_ROW_LOOK.DETAIL}
                  glyph={<FolderIcon />}
                  label="an-organisation-with-a-long-name/a-repository-named-at-length"
                />
              </HoverCard>
            }
          />
        </Inline>
      </CatalogSection>
      <CatalogSection id="hover-card-reading" title="Reading">
        <Inline gap={GAP.CONTROL}>
          <Carded
            label="Skill, reading"
            card={<HoverCardSkeleton glyph={<PinIcon />} name="/release" />}
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
            label="Agent, reading"
            card={
              <HoverCardSkeleton
                mark={<Avatar name="Prorate seat changes" size={AVATAR_SIZE.CARD} />}
                name="Prorate seat changes"
                sub
              />
            }
          />
          <Carded
            label="Agent"
            card={
              <HoverCard>
                <HoverCardHead
                  mark={<Avatar name="Prorate seat changes" size={AVATAR_SIZE.CARD} />}
                  name="Prorate seat changes"
                  sub="Opus 5.5"
                  corner="3m"
                />
                <HoverCardNote>Reading packages/billing/src/seats.ts</HoverCardNote>
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
                {/* Note that the list holds more rows than its height, so it scrolls and fades rather than counting the rest. */}
                <HoverCardList label="Agents">
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
                  {CATALOG_AGENTS.map((name) => (
                    <li key={name}>
                      <HoverCardRow
                        glyph={<DocumentIcon />}
                        label={name}
                        onPress={() => undefined}
                      />
                    </li>
                  ))}
                </HoverCardList>
              </HoverCard>
            }
          />
          <Carded
            label="Figures"
            card={
              <HoverCard>
                <HoverCardHead
                  name="Opus 5.5 High"
                  sub="Today, 9:34 – 9:43 PM · 9m 12s"
                  corner="Failed"
                />
                <HoverCardNote>Ran out of time.</HoverCardNote>
                <HoverCardRule />
                <HoverCardFigures
                  label="Tokens"
                  figures={[
                    { label: "Input", figure: "12,408" },
                    { label: "Output", figure: "3,921" },
                    { label: "Cache read", figure: "184,233" },
                    { label: "Cache write", figure: "9,870" },
                  ]}
                />
              </HoverCard>
            }
          />
          <Carded
            label="Tools"
            card={
              <HoverCard>
                <HoverCardHead glyph={<PinIcon />} name="Linear" sub="3 tools" />
                <HoverCardRule />
                <HoverCardList label="Linear tools">
                  {CATALOG_TOOLS.map(({ title, summary }) => (
                    <li key={title}>
                      <Tooltip
                        label={title}
                        card={
                          <HoverCard>
                            <HoverCardHead name={title} />
                            <HoverCardNote>{summary}</HoverCardNote>
                          </HoverCard>
                        }
                      >
                        <HoverCardRow glyph={null} label={title} />
                      </Tooltip>
                    </li>
                  ))}
                </HoverCardList>
              </HoverCard>
            }
          />
          <Carded
            label="Long body"
            card={
              <HoverCard>
                <HoverCardHead glyph={<PinIcon />} name="Linear" sub="7 tools" />
                <HoverCardRule />
                {/* Note that a body that is no list, as a server's tools are, scrolls and fades as a list does. */}
                <HoverCardScroll>
                  {CATALOG_AGENTS.map((name) => (
                    <HoverCardRow key={name} glyph={<DocumentIcon />} label={name} />
                  ))}
                </HoverCardScroll>
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
