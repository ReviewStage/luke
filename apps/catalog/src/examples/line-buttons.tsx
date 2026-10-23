import {
  Disclosure,
  DisclosureBody,
  LINE_BUTTON_LOOK,
  LineButton,
  LineSummary,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * line-buttons.tsx -- a LineButton as a call's row that opens a tab, a row
 * whose every word is muted brightening under the pointer, a LineSummary
 * folding a call's body open under it, and a quote that shows its words,
 * cut short after two lines in a narrow column, and a band naming the lines
 * a card is on across its top.
 */

/** Does nothing, for a press the catalog only draws. */
function pressed(): void {}

/** A call's glyph, in the 16px seat a row's icon stands in. */
function CallGlyph(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 17l6-6-6-6" />
      <path d="M12 19h8" />
    </svg>
  );
}

function LineButtons(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="line-buttons-row" title="Row, a call's line that opens a tab">
        <div className="catalog-transcript">
          <Stack>
            <LineButton onClick={pressed}>
              <CallGlyph />
              <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION}>
                Ran
              </Text>
              <span>pnpm exec vitest run</span>
            </LineButton>
            <LineButton brightens onClick={pressed}>
              <CallGlyph />
              <span>Webhook body</span>
            </LineButton>
          </Stack>
        </div>
      </CatalogSection>
      <CatalogSection id="line-buttons-summary" title="Summary, a fold's line">
        <div className="catalog-transcript">
          <Disclosure>
            <LineSummary brightens>
              <CallGlyph />
              <span>Thought for 4s</span>
            </LineSummary>
            <DisclosureBody>
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                The retry loop starts before the first request is sent, so a refusal never waits.
              </Text>
            </DisclosureBody>
          </Disclosure>
        </div>
      </CatalogSection>
      <CatalogSection id="line-buttons-quote" title="Quote, words that show where they stand">
        <div className="catalog-narrow">
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            <LineButton look={LINE_BUTTON_LOOK.QUOTE} onClick={pressed}>
              Every behavior change ships with a test that fails without it, in the same pull
              request, and a test that breaks on a refactor is deleted rather than fixed.
            </LineButton>
          </Text>
        </div>
      </CatalogSection>
      <CatalogSection id="line-buttons-band" title="Band, a strip across a card">
        <div className="catalog-band-card">
          <LineButton
            look={LINE_BUTTON_LOOK.BAND}
            onClick={pressed}
            aria-label="View in Files changed: src/invites/send.ts lines 3–4"
          >
            <span className="catalog-band-words">src/invites/send.ts · lines 3–4</span>
          </LineButton>
          <Text className="catalog-band-body">Should this retry on a 429 as well?</Text>
        </div>
      </CatalogSection>
    </>
  );
}

export const LINE_BUTTONS_EXAMPLE: Example = {
  id: "line-buttons",
  title: "Line buttons",
  Render: LineButtons,
};
