/**
 * progress-rings.tsx -- the progress ring at its start, part way, and full
 * in the working blue, the tones the agent's context ring takes, and the ring
 * beside its count as a sub-task's row and card say it.
 */

import {
  GAP,
  Inline,
  PROGRESS_RING_TONE,
  ProgressCount,
  ProgressRing,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const SHARES = [0, 0.33, 0.67, 1] as const;

const COUNTS = [
  { done: 0, total: 6 },
  { done: 4, total: 6 },
  { done: 6, total: 6 },
] as const;

function ProgressRings(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="progress-ring-shares" title="In the working blue, even when full">
        <Inline gap={GAP.SECTION}>
          {SHARES.map((share) => (
            <ProgressRing key={share} share={share} />
          ))}
        </Inline>
      </CatalogSection>
      <CatalogSection id="progress-ring-tones" title="Tones">
        <Inline gap={GAP.SECTION}>
          {Object.values(PROGRESS_RING_TONE).map((tone) => (
            <Stack key={tone} gap={GAP.ICON}>
              <ProgressRing share={0.7} tone={tone} />
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {tone}
              </Text>
            </Stack>
          ))}
        </Inline>
      </CatalogSection>
      <CatalogSection id="progress-count" title="Beside its count">
        <Inline gap={GAP.SECTION}>
          {COUNTS.map(({ done, total }) => (
            <ProgressCount
              key={done}
              done={done}
              total={total}
              label={`${done} of ${total} sub-tasks finished`}
            />
          ))}
        </Inline>
      </CatalogSection>
    </>
  );
}

export const PROGRESS_RINGS_EXAMPLE: Example = {
  id: "progress-rings",
  title: "Progress rings",
  Render: ProgressRings,
};
