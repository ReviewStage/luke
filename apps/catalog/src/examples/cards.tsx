import {
  ALIGN,
  BUTTON_VARIANT,
  Button,
  CARD_PADDING,
  Card,
  GAP,
  Inline,
  JUSTIFY,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * cards.tsx -- a card at each padding: a chart's regular inset, a figure's
 * compact one, a band's snug one, and a flush card a list fills to its
 * edge; then long words in a narrow column.
 */

/** A press the catalog has nowhere to take. */
function stay(): void {}

const ROWS = ["Ada Lovelace", "Grace Hopper", "Katherine Johnson"] as const;

function Cards(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="card-regular" title="Regular">
        <div className="catalog-column">
          <Card>
            <Stack gap={GAP.FIELD}>
              <Text as={TEXT_ELEMENT.H3} variant={TEXT_VARIANT.LABEL} tone={TEXT_TONE.MUTED}>
                Calls per day
              </Text>
              <Text tone={TEXT_TONE.MUTED}>No calls in this window.</Text>
            </Stack>
          </Card>
        </div>
      </CatalogSection>
      <CatalogSection id="card-compact" title="Compact">
        <div className="catalog-column">
          <Card padding={CARD_PADDING.COMPACT} title="Accounts that signed in this week">
            <Stack gap={GAP.CONTROL}>
              <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.LABEL} tone={TEXT_TONE.MUTED}>
                Weekly actives
              </Text>
              <Text variant={TEXT_VARIANT.TITLE}>1,204</Text>
            </Stack>
          </Card>
        </div>
      </CatalogSection>
      <CatalogSection id="card-snug" title="Snug">
        <Card padding={CARD_PADDING.SNUG}>
          <Inline justify={JUSTIFY.BETWEEN} align={ALIGN.CENTER}>
            <Text>Refresh failed. Still showing the earlier answer.</Text>
            <Button variant={BUTTON_VARIANT.OUTLINE} onClick={stay}>
              Try again
            </Button>
          </Inline>
        </Card>
      </CatalogSection>
      <CatalogSection id="card-flush" title="Flush">
        <div className="catalog-column">
          <Card padding={CARD_PADDING.FLUSH}>
            <Stack gap={GAP.NONE}>
              {ROWS.map((name) => (
                <div key={name} className="catalog-card-row">
                  <Text>{name}</Text>
                </div>
              ))}
            </Stack>
          </Card>
        </div>
      </CatalogSection>
      <CatalogSection id="card-narrow" title="Narrow column, long words">
        <div className="catalog-card-narrow">
          <Card>
            <Text>Every account that placed a hosted-tier call on this day, busiest first.</Text>
          </Card>
        </div>
      </CatalogSection>
    </>
  );
}

export const CARDS_EXAMPLE: Example = {
  id: "cards",
  title: "Cards",
  Render: Cards,
};
