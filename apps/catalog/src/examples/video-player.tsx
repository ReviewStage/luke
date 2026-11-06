import {
  GAP,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  VIDEO_PLAYER_PLACE,
  VideoPlayer,
} from "@repo/ui";
import { useEffect, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const RECORDING = { WIDTH: 640, HEIGHT: 400, FRAMES: 90 } as const;

const STAND_IN = { RECORDING: "recording", UNSUPPORTED: "unsupported" } as const;

type StandIn = (typeof STAND_IN)[keyof typeof STAND_IN] | { readonly url: string };

const STAND_IN_WORDS = {
  [STAND_IN.RECORDING]: "Recording a stand-in video…",
  [STAND_IN.UNSUPPORTED]:
    "This browser cannot record a WebM, so there is no stand-in video to play.",
} as const satisfies Record<(typeof STAND_IN)[keyof typeof STAND_IN], string>;

const INK = { PAGE: "#f5f5f7", ROW: "#e3e3e8", BUTTON: "#3d5ac8" } as const;

function drawFrame(pen: CanvasRenderingContext2D, at: number): void {
  pen.fillStyle = INK.PAGE;
  pen.fillRect(0, 0, RECORDING.WIDTH, RECORDING.HEIGHT);
  pen.fillStyle = INK.ROW;
  pen.fillRect(40, 60, 560, 36);
  pen.fillRect(40, 110, 560, 36);
  pen.fillStyle = INK.BUTTON;
  pen.fillRect(40 + at * 5, 220, 110, 34);
}

function recordStandIn(done: (url: string) => void): () => void {
  const canvas = document.createElement("canvas");
  canvas.width = RECORDING.WIDTH;
  canvas.height = RECORDING.HEIGHT;
  const pen = canvas.getContext("2d");
  if (pen === null) return () => undefined;
  const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: "video/webm" });
  const parts: Blob[] = [];
  let gone = false;
  recorder.ondataavailable = (event) => parts.push(event.data);
  recorder.onstop = () => {
    const reader = new FileReader();
    reader.onload = () => {
      if (!gone && typeof reader.result === "string") done(reader.result);
    };
    reader.readAsDataURL(new Blob(parts, { type: "video/webm" }));
  };
  let at = 0;
  let frame = 0;
  const draw = () => {
    drawFrame(pen, at);
    at += 1;
    if (at < RECORDING.FRAMES) frame = requestAnimationFrame(draw);
    else recorder.stop();
  };
  recorder.start();
  frame = requestAnimationFrame(draw);
  return () => {
    gone = true;
    cancelAnimationFrame(frame);
    if (recorder.state !== "inactive") recorder.stop();
  };
}

function canRecord(): boolean {
  return typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("video/webm");
}

export function useStandIn(): StandIn {
  const [standIn, setStandIn] = useState<StandIn>(() =>
    canRecord() ? STAND_IN.RECORDING : STAND_IN.UNSUPPORTED,
  );
  useEffect(() => {
    if (!canRecord()) return undefined;
    return recordStandIn((url) => setStandIn({ url }));
  }, []);
  return standIn;
}

function VideoPlayers(): React.JSX.Element {
  const standIn = useStandIn();
  const [expanded, setExpanded] = useState(0);
  if (typeof standIn === "string") {
    return (
      <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {STAND_IN_WORDS[standIn]}
      </Text>
    );
  }
  const { url } = standIn;
  return (
    <>
      <CatalogSection id="video-player-inline" title="In place of a picture">
        <Stack gap={GAP.ICON}>
          <VideoPlayer
            dataUrl={url}
            label="A button sliding across a page"
            onExpand={() => setExpanded((was) => was + 1)}
          />
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {`Expanded ${String(expanded)} ${expanded === 1 ? "time" : "times"}`}
          </Text>
        </Stack>
      </CatalogSection>
      <CatalogSection id="video-player-viewer" title="In the viewer">
        <VideoPlayer
          dataUrl={url}
          label="A button sliding across a page"
          place={VIDEO_PLAYER_PLACE.VIEWER}
        />
      </CatalogSection>
    </>
  );
}

export const VIDEO_PLAYER_EXAMPLE: Example = {
  id: "video-player",
  title: "Video player",
  Render: VideoPlayers,
};
