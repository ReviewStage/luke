import {
  BoardIcon,
  CircleCheckIcon,
  DISCLOSURE_BODY,
  DISCLOSURE_LOOK,
  DISCLOSURE_SUMMARY,
  Disclosure,
  DisclosureAction,
  DisclosureBody,
  DisclosureChevron,
  DisclosureSummary,
  FoldChevronIcon,
  IconButton,
  MoreButton,
  Stack,
  Text,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * disclosures.tsx -- a fold closed and open, its body indented under the
 * summary's words or flush with the row, a fold whose holder keeps its
 * state, a summary long enough to wrap in a pane narrower than its words,
 * a summary holding a control that is pressed without folding it, a
 * chip at the end of its row counting the threads it folds, a fold
 * drawn as a card, its chevron leading its head or ending it, and a
 * transcript's line, bare, which the skin around its fold draws.
 */

/** A fold whose summary ends with a ⋯ in its action slot, which counts its presses rather than folding the row. */
function ActionDisclosure(): React.JSX.Element {
  const [presses, setPresses] = useState(0);
  return (
    <Disclosure>
      <DisclosureSummary>
        <span>Review thread · ⋯ pressed {presses}×</span>
        <DisclosureAction>
          <MoreButton thing="Review thread" onClick={() => setPresses((count) => count + 1)} />
        </DisclosureAction>
      </DisclosureSummary>
      <DisclosureBody>
        <Text>Pressing the ⋯ leaves this fold as it stood; the rest of the row folds it.</Text>
      </DisclosureBody>
    </Disclosure>
  );
}

/** A fold that is only its row, as a file's header: its own chevron button among its controls, a rule under it while open. */
function RowDisclosure(): React.JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <Disclosure open={open} onOpenChange={setOpen}>
      <DisclosureSummary look={DISCLOSURE_SUMMARY.ROW}>
        <DisclosureAction>
          <IconButton
            icon={<FoldChevronIcon />}
            label={open ? "Collapse file" : "Expand file"}
            onClick={() => setOpen(!open)}
          />
        </DisclosureAction>
        <span>src/seats.ts</span>
      </DisclosureSummary>
    </Disclosure>
  );
}

/** A line's threads minimized to a chip at the row's end: resolved, and how many comments, the threads under it once shown. */
function ChipDisclosure(): React.JSX.Element {
  return (
    <Disclosure>
      <DisclosureSummary look={DISCLOSURE_SUMMARY.CHIP} aria-label="2 comments, all resolved, show">
        <CircleCheckIcon />2
      </DisclosureSummary>
      <DisclosureBody>
        <Text>Dana: Should this retry on a 429 too?</Text>
        <Text>Sam: Yes, with the same backoff.</Text>
      </DisclosureBody>
    </Disclosure>
  );
}

/** A fold whose open state its holder keeps, as a tab keeps which of its notes it folded. */
function HeldDisclosure(): React.JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <Disclosure open={open} onOpenChange={setOpen}>
      <DisclosureSummary>
        <span>Luke · Lines 12–18</span>
      </DisclosureSummary>
      <DisclosureBody>
        <Text>The retry loop starts here, before the first request is sent.</Text>
      </DisclosureBody>
    </Disclosure>
  );
}

function Disclosures(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="disclosure-indented" title="Body under the words">
        <div className="catalog-frame catalog-frame-wide">
          <Stack>
            <Disclosure>
              <DisclosureSummary>
                <span>3 tools called</span>
              </DisclosureSummary>
              <DisclosureBody>
                <Text>Read package.json</Text>
                <Text>Searched for “Disclosure”</Text>
                <Text>Edited disclosure.tsx</Text>
              </DisclosureBody>
            </Disclosure>
            <Disclosure defaultOpen>
              <DisclosureSummary>
                <span>2 tools called</span>
              </DisclosureSummary>
              <DisclosureBody>
                <Text>Ran the tests</Text>
                <Text>Opened a pull request</Text>
              </DisclosureBody>
            </Disclosure>
          </Stack>
        </div>
      </CatalogSection>
      <CatalogSection id="disclosure-flush" title="Body flush with the row">
        <div className="catalog-frame catalog-frame-wide">
          <Disclosure defaultOpen>
            <DisclosureSummary>
              <span>Summary of 12 earlier steps</span>
            </DisclosureSummary>
            <DisclosureBody inset={DISCLOSURE_BODY.FLUSH}>
              <Text>
                Luke read the plan, split it into three tasks, and started an agent on each.
              </Text>
            </DisclosureBody>
          </Disclosure>
        </div>
      </CatalogSection>
      <CatalogSection id="disclosure-held" title="Held by its holder">
        <div className="catalog-frame catalog-frame-wide">
          <HeldDisclosure />
        </div>
      </CatalogSection>
      <CatalogSection id="disclosure-action" title="Control in the summary">
        <div className="catalog-frame">
          <ActionDisclosure />
        </div>
      </CatalogSection>
      <CatalogSection id="disclosure-row" title="File row">
        <div className="catalog-frame">
          <RowDisclosure />
        </div>
      </CatalogSection>
      <CatalogSection id="disclosure-chip" title="Chip at the row's end">
        <div className="catalog-frame catalog-frame-wide">
          <ChipDisclosure />
        </div>
      </CatalogSection>
      <CatalogSection id="disclosure-card" title="A card, its head the line it shows closed">
        <div className="catalog-frame catalog-frame-wide">
          <Stack>
            <Disclosure look={DISCLOSURE_LOOK.CARD} defaultOpen>
              <DisclosureSummary look={DISCLOSURE_SUMMARY.HEAD}>
                <DisclosureChevron />
                <span>Plan · Fix token refresh on wake</span>
              </DisclosureSummary>
              <DisclosureBody inset={DISCLOSURE_BODY.CARD}>
                <Text>Refresh the token before the first request after the Mac wakes.</Text>
              </DisclosureBody>
            </Disclosure>
            <Disclosure look={DISCLOSURE_LOOK.CARD}>
              <DisclosureSummary look={DISCLOSURE_SUMMARY.HEAD}>
                <BoardIcon />
                <span>2 of 5 done</span>
                <DisclosureChevron />
              </DisclosureSummary>
              <DisclosureBody inset={DISCLOSURE_BODY.CARD}>
                <Text>Write the failing test</Text>
                <Text>Refresh on wake</Text>
              </DisclosureBody>
            </Disclosure>
          </Stack>
        </div>
      </CatalogSection>
      <CatalogSection
        id="disclosure-transcript"
        title="A transcript's line, drawn by its fold's skin"
      >
        <div className="catalog-frame catalog-frame-wide catalog-transcript-fold">
          <Disclosure>
            <DisclosureSummary look={DISCLOSURE_SUMMARY.TRANSCRIPT}>
              <DisclosureChevron />
              <span>Conversation</span>
            </DisclosureSummary>
            <DisclosureBody inset={DISCLOSURE_BODY.FLUSH}>
              <Text>Dana: Should this retry on a 429 too?</Text>
            </DisclosureBody>
          </Disclosure>
        </div>
      </CatalogSection>
      <CatalogSection id="disclosure-long" title="Long summary, narrow pane">
        <div className="catalog-frame">
          <Disclosure>
            <DisclosureSummary>
              <span>
                4 options offered · Dana picked “Keep the old endpoint until every client has moved”
              </span>
            </DisclosureSummary>
            <DisclosureBody>
              <Text>Keep the old endpoint until every client has moved</Text>
            </DisclosureBody>
          </Disclosure>
        </div>
      </CatalogSection>
    </>
  );
}

export const DISCLOSURES_EXAMPLE: Example = {
  id: "disclosures",
  title: "Disclosures",
  Render: Disclosures,
};
