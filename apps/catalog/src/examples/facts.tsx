import { Fact, Facts, GAP, Stack, Text } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * facts.tsx -- facts, each a muted name and its value at the line's end:
 * a plain column, and one ruled off from what stands over it, as a
 * context popover's stand under its legend.
 */

const STATS = [
  { label: "Used", value: "41%" },
  { label: "Left before compacting", value: "~118,000 tokens" },
  { label: "Last step", value: "2 min ago" },
] as const;

function FactsExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="facts-plain" title="A column of facts">
        <div className="catalog-column">
          <Facts>
            {STATS.map((stat) => (
              <Fact key={stat.label} label={stat.label}>
                {stat.value}
              </Fact>
            ))}
          </Facts>
        </div>
      </CatalogSection>
      <CatalogSection id="facts-ruled" title="Ruled off from what stands over it">
        <div className="catalog-column">
          <Stack gap={GAP.BLOCK}>
            <Text>Context: 41% full</Text>
            <Facts ruled>
              {STATS.map((stat) => (
                <Fact key={stat.label} label={stat.label}>
                  {stat.value}
                </Fact>
              ))}
            </Facts>
          </Stack>
        </div>
      </CatalogSection>
    </>
  );
}

export const FACTS_EXAMPLE: Example = {
  id: "facts",
  title: "Facts",
  Render: FactsExample,
};
