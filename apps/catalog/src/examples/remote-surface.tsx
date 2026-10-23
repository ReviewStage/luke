/**
 * remote-surface.tsx -- a canvas a page running elsewhere is drawn on, here a dot where the pointer last went down, whose input goes on only while it is driven.
 */

import {
  BUTTON_VARIANT,
  Button,
  GAP,
  REMOTE_POINTER_ACTION,
  type RemotePointer,
  RemoteSurface,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { useRef, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const WIDTH = 280;
const HEIGHT = 160;

function RemoteSurfaces(): React.JSX.Element {
  const [driving, setDriving] = useState(false);
  const [said, setSaid] = useState("Nothing yet");
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointer = (input: RemotePointer) => {
    if (input.action === REMOTE_POINTER_ACTION.MOVE) return;
    setSaid(`${input.action} at ${String(Math.round(input.x))}, ${String(Math.round(input.y))}`);
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (element === null || context === null || context === undefined) return;
    const ratio = element.width / WIDTH;
    context.clearRect(0, 0, element.width, element.height);
    context.fillStyle = getComputedStyle(element).color;
    context.beginPath();
    context.arc(input.x * ratio, input.y * ratio, 6 * ratio, 0, Math.PI * 2);
    context.fill();
  };
  return (
    <CatalogSection id="remote-surface-driven" title="Driven, or watched">
      <Stack gap={GAP.FIELD}>
        <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => setDriving((on) => !on)}>
          {driving ? "Hand back" : "Take over"}
        </Button>
        <RemoteSurface
          ref={canvas}
          label="The page"
          width={WIDTH}
          height={HEIGHT}
          driving={driving}
          onPointer={pointer}
          onWheel={(input) => setSaid(`wheel ${String(Math.round(input.deltaY))}px`)}
          onKey={(input) => {
            setSaid(`key ${input.action} ${input.key}`);
            return true;
          }}
          onPaste={(text) => setSaid(`pasted ${String(text.length)} characters`)}
        />
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {driving ? `Last: ${said}` : "Watching · take over to send the page your input"}
        </Text>
      </Stack>
    </CatalogSection>
  );
}

export const REMOTE_SURFACE_EXAMPLE: Example = {
  id: "remote-surface",
  title: "Remote surface",
  Render: RemoteSurfaces,
};
