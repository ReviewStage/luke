import { Button, GAP, ReadableControls, Stack, Text } from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * readable-controls.tsx -- a control whose words may be selected: a press
 * that selected words holds back its press, and one that did not presses
 * as any control does.
 */

function ReadableControlsExample(): React.JSX.Element {
  const [pressed, setPressed] = useState(0);
  return (
    <CatalogSection id="readable-controls" title="Select the words, or press">
      <Stack gap={GAP.CONTROL}>
        <ReadableControls>
          <Button onClick={() => setPressed((count) => count + 1)}>Open the pull request</Button>
        </ReadableControls>
        <Text>Pressed {pressed} times.</Text>
      </Stack>
    </CatalogSection>
  );
}

export const READABLE_CONTROLS_EXAMPLE: Example = {
  id: "readable-controls",
  title: "Readable controls",
  Render: ReadableControlsExample,
};
