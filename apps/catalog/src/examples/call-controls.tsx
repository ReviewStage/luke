/**
 * call-controls.tsx -- a call's bar at a card's width and at its narrowest, while Luke works and with the microphone muted; each mute, and the one red End call.
 */

import {
  CALL_DEVICE,
  CallBar,
  type CallDevice,
  CallMute,
  EndCallButton,
  GAP,
  Inline,
  Stack,
} from "@luke/ui";
import type { CallStatus } from "@luke/ui/call-card-model";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

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

/** One mute that toggles. */
function OwnedMute({ device }: { device: CallDevice }): React.JSX.Element {
  const [muted, setMuted] = useState(false);
  return <CallMute device={device} muted={muted} onPress={() => setMuted((was) => !was)} />;
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
      <CatalogSection id="call-controls" title="Mutes and End call">
        <Inline gap={GAP.CONTROL}>
          <OwnedMute device={CALL_DEVICE.SPEAKER} />
          <OwnedMute device={CALL_DEVICE.MICROPHONE} />
          <EndCallButton onPress={stay} />
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
