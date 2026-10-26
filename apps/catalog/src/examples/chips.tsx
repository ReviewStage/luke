import {
  ALIGN,
  Badge,
  BUTTON_VARIANT,
  Button,
  CHIP_CUT,
  CHIP_EDGE,
  CHIP_LOOK,
  CHIP_SIZE,
  CHIP_WIDTH,
  Chip,
  ChipCount,
  ChipName,
  GAP,
  Inline,
  MARK_PROVIDER,
  PlusIcon,
  ProviderMark,
  STATUS_TONE,
  Stack,
  TEXT_TONE,
  Text,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * chips.tsx -- each chip look at rest, with a mark and a chevron, with its
 * menu open, unavailable, and with a long name in a narrow column; a row of
 * filters, one pressed at a time; a row of compact counts, one pressed and
 * one busy; each tone, and each in a compact pill beside a badge of its size; each width; a chip drawn as
 * its mark alone; a name in the code face; removable filters, each
 * springing in as one is added and scaling out as its × lifts it; a
 * branch cut in its middle, its start fading where the cut stands; and a
 * toolbar chip hung on its line's edge, its + under the words over it.
 */

const FILTERS = ["All", "Tasks", "Agents", "Files"] as const;

/** A row of filter chips, the pressed one moving to whichever is pressed. */
function FilterRow(): React.JSX.Element {
  const [chosen, setChosen] = useState<string>(FILTERS[0]);
  return (
    <Inline gap={GAP.TIGHT}>
      {FILTERS.map((each) => (
        <Chip
          key={each}
          look={CHIP_LOOK.FILTER}
          aria-pressed={each === chosen}
          onClick={() => setChosen(each)}
        >
          {each}
        </Chip>
      ))}
    </Inline>
  );
}

/** Filters each saying what they would leave out: Hide resolved on, Hide bots off. */
function CountedFilters(): React.JSX.Element {
  const [resolved, setResolved] = useState(true);
  const [bots, setBots] = useState(false);
  return (
    <Inline gap={GAP.TIGHT}>
      <Chip
        look={CHIP_LOOK.FILTER}
        aria-pressed={resolved}
        onClick={() => setResolved((was) => !was)}
      >
        <ChipName>Hide resolved</ChipName>
        <ChipCount>4</ChipCount>
      </Chip>
      <Chip look={CHIP_LOOK.FILTER} aria-pressed={bots} onClick={() => setBots((was) => !was)}>
        <ChipName>Hide bots</ChipName>
        <ChipCount>12</ChipCount>
      </Chip>
    </Inline>
  );
}

/** A row of compact counts, a pull request's reactions: the reader's own pressed, and one whose change is out. */
function CompactRow(): React.JSX.Element {
  return (
    <Inline gap={GAP.TIGHT}>
      <Chip look={CHIP_LOOK.FILTER} size={CHIP_SIZE.COMPACT} aria-pressed>
        👍 12
      </Chip>
      <Chip look={CHIP_LOOK.FILTER} size={CHIP_SIZE.COMPACT} aria-pressed={false}>
        🚀 1
      </Chip>
      <Chip look={CHIP_LOOK.FILTER} size={CHIP_SIZE.COMPACT} aria-pressed={false} busy disabled>
        👀 2
      </Chip>
    </Inline>
  );
}

/** The filters the removable row can stand, in the order Add one brings them. */
const FILTER_NAMES = ["Created by me", "Archived", "Assigned to me", "Due this week"] as const;

/**
 * A row of removable filters, each springing in as Add one brings it and
 * scaling out as its × lifts it, and the first two back once none stands.
 */
function RemovableRow(): React.JSX.Element {
  const [standing, setStanding] = useState<readonly string[]>(FILTER_NAMES.slice(0, 2));
  const shown = standing.length === 0 ? FILTER_NAMES.slice(0, 2) : standing;
  const next = FILTER_NAMES.find((name) => !shown.includes(name));
  return (
    <Inline gap={GAP.TIGHT}>
      <Button
        variant={BUTTON_VARIANT.OUTLINE}
        disabled={next === undefined}
        onClick={() => {
          if (next !== undefined) setStanding([...shown, next]);
        }}
      >
        Add one
      </Button>
      {shown.map((each) => (
        <Chip
          key={each}
          look={CHIP_LOOK.FILTER}
          removeLabel={`Lift ${each}`}
          onRemove={() => setStanding(shown.filter((other) => other !== each))}
        >
          <ChipName>{each}</ChipName>
        </Chip>
      ))}
    </Inline>
  );
}

function Chips(): React.JSX.Element {
  return (
    <>
      {Object.values(CHIP_LOOK).map((look) => (
        <CatalogSection key={look} id={`chips-${look}`} title={look}>
          <Inline>
            <Chip look={look}>
              <ChipName>acme/relay</ChipName>
            </Chip>
            <Chip look={look} chevron>
              <ProviderMark provider={MARK_PROVIDER.GITHUB} />
              <ChipName>acme/relay</ChipName>
            </Chip>
            <Chip look={look} chevron aria-expanded>
              <ChipName>Menu open</ChipName>
            </Chip>
            <Chip look={look} disabled>
              <ChipName>Unavailable</ChipName>
            </Chip>
          </Inline>
        </CatalogSection>
      ))}
      <CatalogSection id="chips-filter-row" title="Filter row">
        <FilterRow />
      </CatalogSection>
      <CatalogSection id="chips-counted-filters" title="Filters with the count they leave out">
        <CountedFilters />
      </CatalogSection>
      <CatalogSection id="chips-compact" title="Compact counts">
        <CompactRow />
      </CatalogSection>
      <CatalogSection id="chips-tones" title="Tones">
        <Inline>
          {Object.values(STATUS_TONE).map((tone) => (
            <Chip key={tone} look={CHIP_LOOK.PILL} tone={tone} chevron>
              <ProviderMark provider={MARK_PROVIDER.GITHUB} />
              <ChipName>{tone}</ChipName>
            </Chip>
          ))}
        </Inline>
      </CatalogSection>
      <CatalogSection id="chips-compact-tones" title="Compact tones, beside a badge">
        <Inline gap={GAP.TIGHT}>
          {Object.values(STATUS_TONE).map((tone) => (
            <Chip key={tone} look={CHIP_LOOK.PILL} size={CHIP_SIZE.COMPACT} tone={tone} chevron>
              <ProviderMark provider={MARK_PROVIDER.GITHUB} />
              <ChipName>{tone}</ChipName>
            </Chip>
          ))}
          <Badge tone={STATUS_TONE.MERGED} icon={<ProviderMark provider={MARK_PROVIDER.GITHUB} />}>
            badge
          </Badge>
        </Inline>
      </CatalogSection>
      <CatalogSection id="chips-widths" title="Widths">
        <Stack gap={GAP.CONTROL} align={ALIGN.START}>
          {Object.values(CHIP_WIDTH).map((width) => (
            <Chip key={width} look={CHIP_LOOK.FIELD} width={width} chevron>
              <ChipName>{width}</ChipName>
            </Chip>
          ))}
        </Stack>
      </CatalogSection>
      <CatalogSection id="chips-icon-only" title="Mark alone, code face">
        <Inline>
          <Chip look={CHIP_LOOK.PILL} iconOnly aria-label="acme/relay">
            <ProviderMark provider={MARK_PROVIDER.GITHUB} />
            <ChipName>acme/relay</ChipName>
          </Chip>
          <Chip look={CHIP_LOOK.TOOLBAR} iconOnly chevron aria-label="acme/relay">
            <ProviderMark provider={MARK_PROVIDER.GITHUB} />
            <ChipName>acme/relay</ChipName>
          </Chip>
          <Chip look={CHIP_LOOK.PILL}>
            <ProviderMark provider={MARK_PROVIDER.GITHUB} />
            <ChipName mono>luke/expire-invitations</ChipName>
          </Chip>
        </Inline>
      </CatalogSection>
      <CatalogSection id="chips-link" title="A link, given an address">
        <Inline gap={GAP.TIGHT}>
          <Chip
            look={CHIP_LOOK.PILL}
            size={CHIP_SIZE.COMPACT}
            href="#chips-link"
            data-provider="github"
          >
            <ProviderMark provider={MARK_PROVIDER.GITHUB} />
            <ChipName mono>#312</ChipName>
          </Chip>
        </Inline>
      </CatalogSection>
      <CatalogSection id="chips-removable" title="Removable">
        <RemovableRow />
      </CatalogSection>
      <CatalogSection id="chips-narrow" title="Narrow column, long names">
        <div className="catalog-narrow">
          <Stack gap={GAP.CONTROL} align={ALIGN.START}>
            {Object.values(CHIP_LOOK).map((look) => (
              <Chip key={look} look={look} chevron>
                <ChipName>acme/a-repository-whose-name-runs-past-its-column</ChipName>
              </Chip>
            ))}
          </Stack>
        </div>
      </CatalogSection>
      <CatalogSection id="chips-middle-cut" title="Cut in the middle, keeping the end">
        <div className="catalog-narrow">
          <Stack gap={GAP.CONTROL} align={ALIGN.START}>
            <Chip look={CHIP_LOOK.PILL}>
              <ProviderMark provider={MARK_PROVIDER.GITHUB} />
              <ChipName mono cut={CHIP_CUT.MIDDLE}>
                luke/pull-request-header-menu-and-pill
              </ChipName>
            </Chip>
            <Chip look={CHIP_LOOK.TOOLBAR} chevron>
              <ChipName cut={CHIP_CUT.MIDDLE}>acme/a-repository-whose-name-runs-past-it</ChipName>
            </Chip>
          </Stack>
        </div>
      </CatalogSection>
      <CatalogSection id="chips-edge" title="Hung on its line's edge">
        <div className="catalog-column">
          <Stack gap={GAP.TIGHT} align={ALIGN.START}>
            <Text tone={TEXT_TONE.MUTED}>Its + stands on the edge these words start on.</Text>
            <Chip look={CHIP_LOOK.TOOLBAR} edge={CHIP_EDGE.MARK}>
              <PlusIcon />
              <ChipName>Link issue</ChipName>
            </Chip>
          </Stack>
        </div>
      </CatalogSection>
    </>
  );
}

export const CHIPS_EXAMPLE: Example = { id: "chips", title: "Chips", Render: Chips };
