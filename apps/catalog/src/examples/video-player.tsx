/**
 * video-player.tsx -- a recording played in place of a picture under Luke's
 * own bar, with its Expand, and as the file viewer plays it, both on a
 * short WebM the page records from a canvas as it opens, since the catalog
 * fetches nothing. While it records it says so, and where the browser can
 * record no WebM, as a test's window cannot, it says that instead.
 */

import {
  GAP,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  VIDEO_PLAYER_PLACE,
  VideoPlayer,
} from "@luke/ui";
import { useEffect, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/** The stand-in recording's size, a screen's shape, and how many frames it runs. */
const RECORDING = { WIDTH: 640, HEIGHT: 400, FRAMES: 90 } as const;

/** Where the stand-in stands while there is no recording yet. */
const STAND_IN = { RECORDING: "recording", UNSUPPORTED: "unsupported" } as const;

type StandIn = (typeof STAND_IN)[keyof typeof STAND_IN] | { readonly url: string };

/** What the example says where it has no recording to play. */
const STAND_IN_WORDS = {
  [STAND_IN.RECORDING]: "Recording a stand-in video…",
  [STAND_IN.UNSUPPORTED]:
    "This browser cannot record a WebM, so there is no stand-in video to play.",
} as const satisfies Record<(typeof STAND_IN)[keyof typeof STAND_IN], string>;

/** The stand-in's colours, a page with a button sliding across it. */
const INK = { PAGE: "#f5f5f7", ROW: "#e3e3e8", BUTTON: "#3d5ac8" } as const;

/** Draws the stand-in's frame `at` on `pen`: two rows and a button partway across. */
function drawFrame(pen: CanvasRenderingContext2D, at: number): void {
  pen.fillStyle = INK.PAGE;
  pen.fillRect(0, 0, RECORDING.WIDTH, RECORDING.HEIGHT);
  pen.fillStyle = INK.ROW;
  pen.fillRect(40, 60, 560, 36);
  pen.fillRect(40, 110, 560, 36);
  pen.fillStyle = INK.BUTTON;
  pen.fillRect(40 + at * 5, 220, 110, 34);
}

/**
 * Records the stand-in from a canvas, a frame each animation frame, and
 * hands it to `done` as a `data:` URL; answers how to stop early.
 */
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

/** Whether this browser can record a WebM from a canvas. */
function canRecord(): boolean {
  return typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("video/webm");
}

/** The stand-in recording once made, that it is being made, or that this browser cannot make one. */
function useStandIn(): StandIn {
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
