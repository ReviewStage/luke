import { Checkbox, GAP, ReadableControls, Stack, Text } from "@repo/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

function ReadableControlsExample(): React.JSX.Element {
  const [checked, setChecked] = useState(false);
  const [toggles, setToggles] = useState(0);
  return (
    <CatalogSection id="readable-controls" title="Select the words, or toggle">
      <Stack gap={GAP.CONTROL}>
        <ReadableControls>
          <Checkbox
            checked={checked}
            onChange={(next) => {
              setChecked(next);
              setToggles((count) => count + 1);
            }}
          >
            Open the pull request when the checks pass
          </Checkbox>
        </ReadableControls>
        <Text>Toggled {toggles} times.</Text>
      </Stack>
    </CatalogSection>
  );
}

export const READABLE_CONTROLS_EXAMPLE: Example = {
  id: "readable-controls",
  title: "Readable controls",
  Render: ReadableControlsExample,
};
