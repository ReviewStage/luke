import {
  RESIZE_EDGE_SIDE,
  ResizeEdge,
  type ResizeEdgeSide,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  useResizeEdge,
} from "@repo/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const BOUNDS = { MIN: 120, MAX: 280, DEFAULT: 180 } as const;

const WORK_RESERVE = 80;

function EdgedPane({ side }: { side: ResizeEdgeSide }): React.JSX.Element {
  const [width, setWidth] = useState<number>(BOUNDS.DEFAULT);
  const edge = useResizeEdge({
    side,
    width,
    bounds: BOUNDS,
    reserve: () => WORK_RESERVE,
    label: "Resize pane",
    onResize: setWidth,
  });
  const pane = (
    <div className="catalog-edged-pane" style={{ width }}>
      <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {`Drag, double-click, or tab to the edge · ${String(width)}px`}
      </Text>
      <ResizeEdge edge={edge} />
    </div>
  );
  return (
    <div className="catalog-edged-box">
      {side === RESIZE_EDGE_SIDE.RIGHT ? pane : null}
      <div className="catalog-edged-work" />
      {side === RESIZE_EDGE_SIDE.LEFT ? pane : null}
    </div>
  );
}

function ResizeEdges(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="resize-edge-right" title="Edge at the pane's right, as the sidebar's">
        <EdgedPane side={RESIZE_EDGE_SIDE.RIGHT} />
      </CatalogSection>
      <CatalogSection id="resize-edge-left" title="Edge at the pane's left, as the side panel's">
        <EdgedPane side={RESIZE_EDGE_SIDE.LEFT} />
      </CatalogSection>
    </>
  );
}

export const RESIZE_EDGES_EXAMPLE: Example = {
  id: "resize-edges",
  title: "Resize edges",
  Render: ResizeEdges,
};
