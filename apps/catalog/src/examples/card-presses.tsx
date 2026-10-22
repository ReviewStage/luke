import {
  ALIGN,
  CARD_PRESS_CORNER,
  CARD_PRESS_REACH,
  Card,
  CardPress,
  type CardPressEvent,
  EllipsisIcon,
  GAP,
  IconButton,
  Inline,
  JUSTIFY,
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
 * words the card's; and unavailable. The line under them says which press
 * landed, and with which modifier.
 */

/** What the last press was, as the line under the cards says it. */
function said(card: string, event: CardPressEvent): string {
  return event.metaKey || event.ctrlKey ? `${card}, with ⌘ or Ctrl` : card;
}

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
                <IconButton
                  icon={<EllipsisIcon />}
                  label="Actions for Ship the release"
                  onClick={stay}
                />
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
      <Text tone={TEXT_TONE.MUTED}>Pressed: {pressed}</Text>
    </>
  );
}

export const CARD_PRESSES_EXAMPLE: Example = {
  id: "card-presses",
  title: "Card presses",
  Render: CardPresses,
};
