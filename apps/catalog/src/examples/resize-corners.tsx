/**
 * resize-corners.tsx -- a box with a resize bracket on each top corner, dragged or stepped from the keyboard.
 */

import { RESIZE_CORNER, ResizeCorner, ResizeFrame, TEXT_TONE, TEXT_VARIANT, Text } from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const MIN = 80;
const MAX = 240;
const STEP = 16;

function ResizeCorners(): React.JSX.Element {
  const [height, setHeight] = useState(120);
  const [dragging, setDragging] = useState(false);
  const resize = (asked: number) => setHeight(Math.min(MAX, Math.max(MIN, Math.round(asked))));
  return (
    <CatalogSection id="resize-corners-box" title="Both top corners">
      <div style={{ width: 240, height }}>
        <ResizeFrame reveal={dragging}>
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {`Tab to a corner, or drag one · ${String(height)}px`}
          </Text>
          {Object.values(RESIZE_CORNER).map((corner) => (
            <ResizeCorner
              key={corner}
              corner={corner}
              label={`Resize from its top-${corner} corner`}
              value={height}
              min={MIN}
              max={MAX}
              step={STEP}
              growth={({ y }) => -y}
              onResize={resize}
              onDragging={setDragging}
            />
          ))}
        </ResizeFrame>
      </div>
    </CatalogSection>
  );
}

export const RESIZE_CORNERS_EXAMPLE: Example = {
  id: "resize-corners",
  title: "Resize corners",
  Render: ResizeCorners,
};
