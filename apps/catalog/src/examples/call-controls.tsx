/**
 * call-controls.tsx -- a call's bar at a card's width and at its narrowest, while Luke works and with the microphone muted; each mute round and square, the one red End call; and a box's call status connecting, live, muted, and ending.
 */

import {
  BUTTON_SHAPE,
  CALL_DEVICE,
  CALL_STAGE,
  CallBar,
  type CallDevice,
  CallLive,
  CallMute,
  EndCallButton,
  GAP,
  Inline,
  Stack,
} from "@luke/ui";
import type { CallStatus } from "@luke/ui/tasks-model";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/** When the catalog's call started, and the moment its count stands still at: 4m 12s in. */
const CALL_STARTED_AT = Date.UTC(2026, 9, 24, 15, 0, 0);
const CALL_NOW = CALL_STARTED_AT + 252_000;

/** A press the catalog has nowhere to take. */
function stay(): void {}

const LISTENING: CallStatus = {
  voiceWord: "Listening",
  backend: { agent: undefined },
};

const WORKING: CallStatus = {
  voiceWord: "Listening",
  backend: { agent: { action: "Reading the plan's open questions" } },
};

/** A bar whose mutes toggle as a call's owner would toggle them. */
function OwnedBar({ status, width }: { status: CallStatus; width: number }): React.JSX.Element {
  const [microphone, setMicrophone] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  return (
    <div style={{ width }}>
      <CallBar
        status={status}
        microphone={{ muted: microphone, onPress: () => setMicrophone((was) => !was) }}
        speaker={{ muted: speaker, onPress: () => setSpeaker((was) => !was) }}
        onEnd={stay}
      />
    </div>
  );
}

/** One mute that toggles, at the shape given. */
function OwnedMute({
  device,
  shape,
}: {
  device: CallDevice;
  shape: (typeof BUTTON_SHAPE)[keyof typeof BUTTON_SHAPE];
}): React.JSX.Element {
  const [muted, setMuted] = useState(false);
  return (
    <CallMute device={device} muted={muted} shape={shape} onPress={() => setMuted((was) => !was)} />
  );
}

function CallControls(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="call-bar" title="The call bar, at a card's width and at its narrowest">
        <Stack gap={GAP.SECTION}>
          <OwnedBar status={LISTENING} width={320} />
          <OwnedBar status={WORKING} width={320} />
          <OwnedBar status={WORKING} width={200} />
        </Stack>
      </CatalogSection>
      <CatalogSection id="call-controls" title="Mutes round and square, and End call">
        <Inline gap={GAP.CONTROL}>
          <OwnedMute device={CALL_DEVICE.SPEAKER} shape={BUTTON_SHAPE.ROUND} />
          <OwnedMute device={CALL_DEVICE.MICROPHONE} shape={BUTTON_SHAPE.ROUND} />
          <OwnedMute device={CALL_DEVICE.SPEAKER} shape={BUTTON_SHAPE.SQUARE} />
          <OwnedMute device={CALL_DEVICE.MICROPHONE} shape={BUTTON_SHAPE.SQUARE} />
          <EndCallButton onPress={stay} />
        </Inline>
      </CatalogSection>
      <CatalogSection
        id="call-live"
        title="A call's status in a box's foot: connecting, live, muted, and ending"
      >
        <Inline gap={GAP.SECTION}>
          <CallLive stage={CALL_STAGE.CONNECTING} />
          <CallLive
            stage={CALL_STAGE.LIVE}
            startedAt={CALL_STARTED_AT}
            muted={false}
            now={CALL_NOW}
          />
          <CallLive stage={CALL_STAGE.LIVE} startedAt={CALL_STARTED_AT} muted now={CALL_NOW} />
          <CallLive stage={CALL_STAGE.ENDING} />
        </Inline>
      </CatalogSection>
    </>
  );
}

export const CALL_CONTROLS_EXAMPLE: Example = {
  id: "call",
  title: "Call controls",
  Render: CallControls,
};
