/**
 * call-controls.tsx -- a call's bar at a card's width and at its narrowest, while Luke works and with the microphone muted; each mute round and square, Video on and off, the one red End call; a box's call status connecting, live, muted, and ending; and Luke's video tile connecting and as a still face on a card, and ended with why in a frame at the picture's own aspect, since a card never draws an ended tile.
 */

import {
  BUTTON_SHAPE,
  CALL_DEVICE,
  CALL_STAGE,
  CALL_VIDEO_FIT,
  CallBar,
  type CallDevice,
  CallLive,
  CallMute,
  type CallVideoFit,
  CallVideoTile,
  EndCallButton,
  GAP,
  Inline,
  Stack,
  VideoToggle,
} from "@luke/ui";
import type { CallStatus } from "@luke/ui/tasks-model";
import {
  AVATAR_END_REASON,
  AVATAR_STATUS,
  type AvatarEndReason,
  type AvatarStatus,
} from "@luke/voice/avatar";
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
  backend: { brain: undefined },
};

const WORKING: CallStatus = {
  voiceWord: "Listening",
  backend: { brain: { action: "Reading the plan's open questions" } },
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

/** Video on or off, toggling. */
function OwnedVideo(): React.JSX.Element {
  const [on, setOn] = useState(true);
  return <VideoToggle on={on} onSetVideo={setOn} />;
}

/** A tile at `fit`, in a box as wide as a card's inside or as a frame at a square picture's aspect. */
function Tile({
  status,
  fit,
  endReason,
}: {
  status: AvatarStatus;
  fit: CallVideoFit;
  endReason?: AvatarEndReason;
}): React.JSX.Element {
  const box = fit === CALL_VIDEO_FIT.CARD ? { width: 222 } : { width: 160, height: 160 };
  return (
    <div style={box}>
      <CallVideoTile
        video={undefined}
        status={status}
        endReason={endReason}
        fit={fit}
        toggles={fit === CALL_VIDEO_FIT.CARD}
        onSetVideo={stay}
      />
    </div>
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
      <CatalogSection id="call-controls" title="Mutes round and square, Video, and End call">
        <Inline gap={GAP.CONTROL}>
          <OwnedMute device={CALL_DEVICE.SPEAKER} shape={BUTTON_SHAPE.ROUND} />
          <OwnedMute device={CALL_DEVICE.MICROPHONE} shape={BUTTON_SHAPE.ROUND} />
          <OwnedMute device={CALL_DEVICE.SPEAKER} shape={BUTTON_SHAPE.SQUARE} />
          <OwnedMute device={CALL_DEVICE.MICROPHONE} shape={BUTTON_SHAPE.SQUARE} />
          <OwnedVideo />
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
      <CatalogSection id="call-video-card" title="Luke's video on a card">
        <Inline gap={GAP.SECTION}>
          <Tile status={AVATAR_STATUS.STARTING} fit={CALL_VIDEO_FIT.CARD} />
          <Tile status={AVATAR_STATUS.LIVE} fit={CALL_VIDEO_FIT.CARD} />
        </Inline>
      </CatalogSection>
      <CatalogSection id="call-video-picture" title="Luke's video in a frame at its own aspect">
        <Inline gap={GAP.SECTION}>
          <Tile status={AVATAR_STATUS.STARTING} fit={CALL_VIDEO_FIT.PICTURE} />
          <Tile status={AVATAR_STATUS.LIVE} fit={CALL_VIDEO_FIT.PICTURE} />
          <Tile
            status={AVATAR_STATUS.ENDED}
            fit={CALL_VIDEO_FIT.PICTURE}
            endReason={AVATAR_END_REASON.SERVER_CLOSED}
          />
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
