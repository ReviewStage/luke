/**
 * slider.tsx -- a slider at its start, part way, and a short range, each
 * moving with the pointer or the arrow keys.
 */

import { GAP, Slider, Stack, TEXT_TONE, TEXT_VARIANT, Text } from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

function Sliders(): React.JSX.Element {
  const [amount, setAmount] = useState(50);
  const [step, setStep] = useState(2);
  return (
    <>
      <CatalogSection id="slider-percent" title="Zero to a hundred">
        <Stack gap={GAP.ICON}>
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {`Swipe position · ${String(amount)}%`}
          </Text>
          <Slider value={amount} onChange={setAmount} label="Swipe position" />
        </Stack>
      </CatalogSection>
      <CatalogSection id="slider-range" title="A short range">
        <Stack gap={GAP.ICON}>
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {`Step · ${String(step)} of 5`}
          </Text>
          <Slider value={step} onChange={setStep} label="Step" min={1} max={5} />
        </Stack>
      </CatalogSection>
    </>
  );
}

export const SLIDER_EXAMPLE: Example = {
  id: "slider",
  title: "Slider",
  Render: Sliders,
};
