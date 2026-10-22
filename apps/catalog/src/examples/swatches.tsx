import { Swatch } from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * swatches.tsx -- a row of colour swatches as a picker draws them: the
 * struck-through dot for no colour first, then each colour, the one chosen
 * ringed.
 */

const COLORS = [
  { label: "Red", color: "#e5484d" },
  { label: "Green", color: "#30a46c" },
  { label: "Blue", color: "#3e63dd" },
] as const;

function Swatches(): React.JSX.Element {
  const [chosen, setChosen] = useState<string | undefined>("Green");
  return (
    <CatalogSection id="swatches-row" title="Choosing a colour">
      <div style={{ display: "flex", gap: 6 }}>
        <Swatch
          label="No color"
          pressed={chosen === undefined}
          onClick={() => setChosen(undefined)}
        />
        {COLORS.map((one) => (
          <Swatch
            key={one.label}
            label={one.label}
            color={one.color}
            pressed={chosen === one.label}
            onClick={() => setChosen(one.label)}
          />
        ))}
      </div>
    </CatalogSection>
  );
}

export const SWATCHES_EXAMPLE: Example = {
  id: "swatches",
  title: "Swatches",
  Render: Swatches,
};
