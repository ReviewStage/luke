import {
  CHIP_LOOK,
  CHIP_TONE,
  CHIP_WIDTH,
  Chip,
  ChipName,
  GAP,
  Inline,
  MARK_PROVIDER,
  ProviderMark,
  Stack,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * chips.tsx -- each chip look at rest, with a mark and a chevron, with its
 * menu open, unavailable, and with a long name in a narrow column; a row of
 * filters, one pressed at a time; each tone; each width; a chip drawn as
 * its mark alone; a name in the code face; and a removable filter.
 */

const FILTERS = ["All", "Plans", "Agents", "Files"] as const;

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

/** A row of removable filters, each lifted by its ×, and all of them back once none stands. */
function RemovableRow(): React.JSX.Element {
  const [standing, setStanding] = useState<readonly string[]>(["Created by me", "Archived"]);
  const shown = standing.length === 0 ? ["Created by me", "Archived"] : standing;
  return (
    <Inline gap={GAP.TIGHT}>
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
      <CatalogSection id="chips-tones" title="Tones">
        <Inline>
          {Object.values(CHIP_TONE).map((tone) => (
            <Chip key={tone} look={CHIP_LOOK.PILL} tone={tone} chevron>
              <ProviderMark provider={MARK_PROVIDER.GITHUB} />
              <ChipName>{tone}</ChipName>
            </Chip>
          ))}
        </Inline>
      </CatalogSection>
      <CatalogSection id="chips-widths" title="Widths">
        <Stack gap={GAP.CONTROL} align="start">
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
      <CatalogSection id="chips-removable" title="Removable">
        <RemovableRow />
      </CatalogSection>
      <CatalogSection id="chips-narrow" title="Narrow column, long names">
        <div className="catalog-narrow">
          <Stack gap={GAP.CONTROL} align="start">
            {Object.values(CHIP_LOOK).map((look) => (
              <Chip key={look} look={look} chevron>
                <ChipName>acme/a-repository-whose-name-runs-past-its-column</ChipName>
              </Chip>
            ))}
          </Stack>
        </div>
      </CatalogSection>
    </>
  );
}

export const CHIPS_EXAMPLE: Example = { id: "chips", title: "Chips", Render: Chips };
