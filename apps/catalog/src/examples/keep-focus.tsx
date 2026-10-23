/**
 * keep-focus.tsx -- a heading beside a field that leaves the caret in the field when pressed, anywhere on it or only on its controls, so typing goes on where it stood.
 */

import {
  ArrowLeftIcon,
  GAP,
  IconButton,
  Inline,
  KEEP_FOCUS,
  KeepFocus,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextField,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

function KeepFocusExample(): React.JSX.Element {
  const [words, setWords] = useState("Type here, then press the heading");
  const [backs, setBacks] = useState(0);
  return (
    <>
      <CatalogSection id="keep-focus-whole" title="Anywhere on it">
        <Stack gap={GAP.TIGHT}>
          <TextField label="Mention" value={words} onChange={setWords} />
          <KeepFocus>
            <Inline gap={GAP.ICON}>
              <IconButton
                icon={<ArrowLeftIcon />}
                label="Back"
                tabbable={false}
                onClick={() => setBacks((count) => count + 1)}
              />
              <Text variant={TEXT_VARIANT.SECTION}>Files</Text>
            </Inline>
          </KeepFocus>
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {`Back pressed ${String(backs)} times · the caret stays in the field`}
          </Text>
        </Stack>
      </CatalogSection>
      <CatalogSection id="keep-focus-controls" title="On its controls alone">
        <KeepFocus scope={KEEP_FOCUS.CONTROLS}>
          <Inline gap={GAP.CONTROL}>
            <Text variant={TEXT_VARIANT.BODY}>These words still select</Text>
            <IconButton
              icon={<ArrowLeftIcon />}
              label="Back"
              onClick={() => setBacks((count) => count + 1)}
            />
          </Inline>
        </KeepFocus>
      </CatalogSection>
    </>
  );
}

export const KEEP_FOCUS_EXAMPLE: Example = {
  id: "keep-focus",
  title: "Keep focus",
  Render: KeepFocusExample,
};
