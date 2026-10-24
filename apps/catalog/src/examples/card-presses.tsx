import {
  ALIGN,
  CARD_CORNER,
  CARD_ELEMENT,
  CARD_HOVER,
  CARD_LOOK,
  CARD_PADDING,
  CARD_PRESS_CORNER,
  CARD_PRESS_REACH,
  CARD_SHADOW,
  Card,
  CardPress,
  type CardPressEvent,
  GAP,
  Inline,
  JUSTIFY,
  MoreButton,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextLink,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * card-presses.tsx -- a whole card as one press: over the card, its own ⋯
 * standing above the press; through the card, its link its own and its
 * words the card's; and unavailable. Then how a pressed card answers the
 * pointer resting on it: a thread at rest washed, on the column's ground and
 * raised over the page; and a board's cards lifting off their well, one held
 * lifted as while its menu stands. The line under them says which press
 * landed, and with which modifier.
 */

/** What the last press was, as the line under the cards says it. */
function said(card: string, event: CardPressEvent): string {
  return event.metaKey || event.ctrlKey ? `${card}, with ⌘ or Ctrl` : card;
}

/** A board's cards, the second held lifted as while its menu is open. */
const LIFTED = ["Draft the launch post", "Its menu open"] as const;

/** A press the catalog has nowhere to take. */
function stay(): void {}

function CardPresses(): React.JSX.Element {
  const [pressed, setPressed] = useState("Nothing yet");
  return (
    <>
      <CatalogSection id="card-press-overlay" title="Over the card">
        <div className="catalog-column">
          <Card>
            <Inline justify={JUSTIFY.BETWEEN} align={ALIGN.START} wrap={false}>
              <CardPress onPress={(event) => setPressed(said("Ship the release", event))}>
                <Stack gap={GAP.TIGHT}>
                  <Text variant={TEXT_VARIANT.LABEL}>Ship the release</Text>
                  <Text tone={TEXT_TONE.MUTED}>Pressed anywhere but its ⋯, the card opens.</Text>
                </Stack>
              </CardPress>
              <span className="catalog-card-press-lift">
                <MoreButton thing="Ship the release" onClick={stay} />
              </span>
            </Inline>
          </Card>
        </div>
      </CatalogSection>
      <CatalogSection id="card-press-through" title="Through the card">
        <div className="catalog-column">
          <Card>
            <Text>
              Charles: see <TextLink href="#card-press-through">the goal</TextLink> before we cut
              it.
            </Text>
            <CardPress
              reach={CARD_PRESS_REACH.CARD}
              corner={CARD_PRESS_CORNER.MENU}
              onPress={(event) => setPressed(said("The thread", event))}
            >
              <Text tone={TEXT_TONE.MUTED}>2 replies</Text>
            </CardPress>
          </Card>
        </div>
      </CatalogSection>
      <CatalogSection id="card-press-disabled" title="Unavailable">
        <div className="catalog-column">
          <Card>
            <CardPress disabled onPress={() => setPressed("The deleting card")}>
              <Text tone={TEXT_TONE.MUTED}>Deleting…</Text>
            </CardPress>
          </Card>
        </div>
      </CatalogSection>
      <CatalogSection id="card-press-wash" title="Washed under the pointer">
        <div className="catalog-column">
          <Stack gap={GAP.CONTROL}>
            <Card
              look={CARD_LOOK.OUTLINE}
              corner={CARD_CORNER.MENU}
              padding={CARD_PADDING.SNUG}
              hover={CARD_HOVER.WASH}
            >
              <Text>Ada: can we keep the old route for a week?</Text>
              <CardPress
                reach={CARD_PRESS_REACH.CARD}
                corner={CARD_PRESS_CORNER.MENU}
                onPress={(event) => setPressed(said("The thread at rest", event))}
              >
                <Text tone={TEXT_TONE.MUTED}>1 reply</Text>
              </CardPress>
            </Card>
            <Card
              look={CARD_LOOK.RAISED}
              corner={CARD_CORNER.MENU}
              padding={CARD_PADDING.SNUG}
              shadow={CARD_SHADOW.MENU}
              hover={CARD_HOVER.WASH}
              lit
            >
              <Text>Grace: the copy reads well now.</Text>
              <CardPress
                reach={CARD_PRESS_REACH.CARD}
                corner={CARD_PRESS_CORNER.MENU}
                onPress={(event) => setPressed(said("The raised thread", event))}
              >
                <Text tone={TEXT_TONE.MUTED}>Its words pointed at elsewhere</Text>
              </CardPress>
            </Card>
          </Stack>
        </div>
      </CatalogSection>
      <CatalogSection id="card-press-lift" title="Lifting off a well">
        <div className="catalog-column">
          <Card
            as={CARD_ELEMENT.SECTION}
            look={CARD_LOOK.WELL}
            corner={CARD_CORNER.CONTROL}
            padding={CARD_PADDING.SNUG}
            aria-label="In progress"
          >
            <Stack gap={GAP.CONTROL}>
              {LIFTED.map((name) => (
                <Card
                  key={name}
                  corner={CARD_CORNER.CONTROL}
                  padding={CARD_PADDING.SNUG}
                  shadow={CARD_SHADOW.SOFT}
                  hover={CARD_HOVER.LIFT}
                  lit={name === LIFTED[1]}
                >
                  <CardPress onPress={(event) => setPressed(said(name, event))}>
                    <Text variant={TEXT_VARIANT.LABEL}>{name}</Text>
                  </CardPress>
                </Card>
              ))}
            </Stack>
          </Card>
        </div>
      </CatalogSection>
      <Text tone={TEXT_TONE.MUTED}>Pressed: {pressed}</Text>
    </>
  );
}

export const CARD_PRESSES_EXAMPLE: Example = {
  id: "card-presses",
  title: "Card presses",
  Render: CardPresses,
};
