/**
 * progress.tsx -- a download's bar under the words that say it in numbers,
 * at its start, part way, and done, and a bar of its own named by its label.
 */

import { GAP, Progress, Stack, TEXT_TONE, TEXT_VARIANT, Text } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const SHARES = [0, 42, 100] as const;

function ProgressBars(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="progress-beside-words" title="Under the words that say it">
        <Stack gap={GAP.FIELD}>
          {SHARES.map((share) => (
            <Stack key={share} gap={GAP.ICON}>
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {`Downloading Luke 4.2 · ${String(share)}%`}
              </Text>
              <Progress value={share} />
            </Stack>
          ))}
        </Stack>
      </CatalogSection>
      <CatalogSection id="progress-labelled" title="Named by its label">
        <Progress value={64} label="Uploading the recording" />
      </CatalogSection>
    </>
  );
}

export const PROGRESS_EXAMPLE: Example = {
  id: "progress",
  title: "Progress",
  Render: ProgressBars,
};
