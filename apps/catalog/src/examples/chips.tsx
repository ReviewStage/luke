import {
  CHIP_LOOK,
  Chip,
  ChipName,
  GAP,
  Inline,
  MARK_PROVIDER,
  ProviderMark,
  Stack,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * chips.tsx -- each chip look at rest, with a mark and a chevron, with its
 * menu open, unavailable, and with a long name in a narrow column.
 */

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
