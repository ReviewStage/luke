import {
  ALIGN,
  BUTTON_VARIANT,
  Button,
  CARD_CORNER,
  CARD_ELEMENT,
  CARD_LOOK,
  CARD_PADDING,
  Card,
  CardHead,
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
 * edge; then long words in a narrow column; then cards set among lines,
 * at a control's corner: tinted, on the code's ground, and outlined; one
 * leaving its room to what it holds; a dashed one for what is missing; and
 * one standing in running words.
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
      <CatalogSection id="card-raised" title="Raised, with a head">
        <div className="catalog-column">
          <Card look={CARD_LOOK.RAISED} padding={CARD_PADDING.FLUSH}>
            <CardHead>
              <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION}>
                Decide
              </Text>
              <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION}>
                Answered
              </Text>
            </CardHead>
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
      <CatalogSection id="card-among-lines" title="Among lines: tinted, code, and outlined">
        <div className="catalog-column">
          <Stack gap={GAP.CONTROL}>
            <Card look={CARD_LOOK.TINT} corner={CARD_CORNER.CONTROL} padding={CARD_PADDING.FLUSH}>
              <div className="catalog-card-row">
                <Text>Ran pnpm test</Text>
              </div>
              <div className="catalog-card-row">
                <Text tone={TEXT_TONE.MUTED}>412 passed</Text>
              </div>
            </Card>
            <Card look={CARD_LOOK.CODE} corner={CARD_CORNER.CONTROL} padding={CARD_PADDING.FLUSH}>
              <div className="catalog-card-row">
                <Text>const seats = await readSeats(workspace);</Text>
              </div>
            </Card>
            <Card
              as={CARD_ELEMENT.ARTICLE}
              look={CARD_LOOK.OUTLINE}
              corner={CARD_CORNER.CONTROL}
              padding={CARD_PADDING.SNUG}
            >
              <Text>The retry loop starts before the first request is sent.</Text>
            </Card>
          </Stack>
        </div>
      </CatalogSection>
      <CatalogSection id="card-none" title="Room left to what it holds, nothing clipped">
        <div className="catalog-column">
          <Card corner={CARD_CORNER.CONTROL} padding={CARD_PADDING.NONE}>
            <div className="catalog-card-row">
              <Text>Comment on lines 12–18</Text>
            </div>
          </Card>
        </div>
      </CatalogSection>
      <CatalogSection id="card-dashed" title="Dashed, for what is missing">
        <div className="catalog-column">
          <Card corner={CARD_CORNER.CONTROL} padding={CARD_PADDING.SNUG} dashed>
            <Text tone={TEXT_TONE.MUTED}>Login screen · no longer available</Text>
          </Card>
        </div>
      </CatalogSection>
      <CatalogSection id="card-in-words" title="In running words">
        <div className="catalog-column">
          <Text>
            The screen as it stood:
            <Card as={CARD_ELEMENT.SPAN} corner={CARD_CORNER.CONTROL} padding={CARD_PADDING.SNUG}>
              A picture&apos;s frame stands here, in the paragraph.
            </Card>
          </Text>
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
