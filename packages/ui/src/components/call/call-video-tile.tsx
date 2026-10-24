/**
 * call-video-tile.tsx -- Luke's avatar on a call, as a tile with its video's controls, and the voice it plays.
 *
 * The tile draws what it is handed and decides nothing: the avatar's video
 * track and its status. While the avatar connects, and on until its video's
 * first frame is drawn, it waits as the rest of the app waits: a skeleton
 * block where the picture will stand, breathing on the shared loop, and
 * Luke's face humming along in front of it with what it waits on; the
 * picture then fades in over the pane's motion as the wait fades out, so no
 * empty frame stands between the two. While it is live it plays the video, or
 * Luke's face as a still frame where no video track is handed, which is what
 * a fixture run draws, since it reaches no avatar; once it has ended it says
 * why, and offers Restart video, as a labelled button where the tile has
 * room and as a round one, its words read rather than drawn, where it has
 * not. Video off puts the avatar away and leaves the call going as voice, in
 * every state, and the tile goes; Video on, which puts a fresh avatar up
 * again, is the call's own controls', as ending the call is, which the tile
 * does not repeat. No word of the conversation is drawn here. The avatar's
 * lip-synced voice is played apart from the tile (`AvatarVoice`), because
 * the tile is drawn only while its owner's surface is, and the voice is what
 * the developer hears whatever is shown. The video is drawn whole, never
 * cut: on a card (`CALL_VIDEO_FIT.CARD`) the tile stands 16:9 at the card's
 * width, or at the height its owner hands `--luke-call-video-height`, and a
 * blurred copy of the same track fills the sides the picture leaves; in a
 * frame at the picture's own aspect (`CALL_VIDEO_FIT.PICTURE`) the tile
 * fills the frame and the picture fills the tile (call.css).
 */

import { FACE_MOTION } from "@luke/brand";
import {
  AVATAR_END_REASON,
  AVATAR_STATUS,
  type AvatarEndReason,
  type AvatarStatus,
} from "@luke/voice/avatar";
import { useCallback, useEffect, useRef, useState } from "react";
import { ResetIcon } from "../../face/glyphs.js";
import { WingFace } from "../../face/wing-face.js";
import { BUTTON_SHAPE, BUTTON_VARIANT, Button, IconButton } from "../button/button.js";
import { SKELETON_SHAPE, Skeleton } from "../skeleton/skeleton.js";
import { ThinkingDots } from "../thinking-dots/thinking-dots.js";
import { VideoToggle } from "./call-controls.js";

/** What the tile says, for a reader and on screen. */
export const CALL_VIDEO_LABEL = {
  TILE: "Video call",
  CONNECTING: "Connecting video",
  ENDED: "Video ended",
  RESTART: "Restart video",
} as const;

/**
 * Why the avatar went down, in the words the tile says beside "Video ended":
 * what happened, as a voice failure is said, with no remedy of its own,
 * since Restart video stands beside it.
 */
export const AVATAR_END_WORDS = {
  [AVATAR_END_REASON.USER]: "You turned video off.",
  [AVATAR_END_REASON.SERVER_CLOSED]: "Keyframe closed the video session.",
  [AVATAR_END_REASON.NO_CAPACITY]: "Every video session on your plan is in use.",
  [AVATAR_END_REASON.UNAVAILABLE]: "Luke could not start video.",
  [AVATAR_END_REASON.ERROR]: "The video session failed.",
  [AVATAR_END_REASON.CALL_ENDED]: "The call ended.",
} as const satisfies Record<AvatarEndReason, string>;

/**
 * How the tile fits where it stands: a card's width at 16:9, its picture
 * whole over a blurred fill; or a frame its owner sizes at the picture's
 * own aspect, which the picture fills.
 */
export const CALL_VIDEO_FIT = {
  CARD: "card",
  PICTURE: "picture",
} as const;

export type CallVideoFit = (typeof CALL_VIDEO_FIT)[keyof typeof CALL_VIDEO_FIT];

/** Plays one track on the element it is handed, for as long as the track stands. */
function useTrack(
  media: React.RefObject<HTMLMediaElement | null>,
  track: MediaStreamTrack | undefined,
): void {
  useEffect(() => {
    const element = media.current;
    if (!element) return;
    element.srcObject = track === undefined ? null : new MediaStream([track]);
    return () => {
      element.srcObject = null;
    };
  }, [media, track]);
}

/**
 * Tells `onAspect` the picture's own width over its height each time the
 * video learns or changes its size, which the element says with `resize`.
 */
function useAspect(
  media: React.RefObject<HTMLVideoElement | null>,
  onAspect: ((aspect: number) => void) | undefined,
): void {
  useEffect(() => {
    const element = media.current;
    if (!element || onAspect === undefined) return;
    const read = () => {
      if (element.videoWidth > 0 && element.videoHeight > 0) {
        onAspect(element.videoWidth / element.videoHeight);
      }
    };
    read();
    element.addEventListener("resize", read);
    return () => element.removeEventListener("resize", read);
  }, [media, onAspect]);
}

/**
 * Whether the video has drawn its first frame, which the element says with
 * `loadeddata` once a frame of the stream is there to show. Until then a
 * track the avatar published draws nothing at all.
 */
function useFirstFrame(media: React.RefObject<HTMLVideoElement | null>): boolean {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const element = media.current;
    if (!element) return;
    // A frame already there before the listener stands has fired its event.
    if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) setDrawn(true);
    const draw = () => setDrawn(true);
    element.addEventListener("loadeddata", draw);
    return () => element.removeEventListener("loadeddata", draw);
  }, [media]);
  return drawn;
}

/** The avatar's video, muted, since its sound is the audio element's to play, under the wait until its first frame. */
function AvatarVideo({
  track,
  onAspect,
}: {
  track: MediaStreamTrack;
  onAspect: ((aspect: number) => void) | undefined;
}): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null);
  const fill = useRef<HTMLVideoElement>(null);
  useTrack(video, track);
  useTrack(fill, track);
  useAspect(video, onAspect);
  const drawn = useFirstFrame(video);
  return (
    <>
      <video ref={video} className="luke-call-video-frame" autoPlay muted playsInline />
      <video
        ref={fill}
        className="luke-call-video-fill"
        aria-hidden="true"
        tabIndex={-1}
        autoPlay
        muted
        playsInline
      />
      <AvatarWaiting gone={drawn} />
    </>
  );
}

/** Luke's face where there is no video to draw, with what the tile says beside it, if anything. */
function AvatarStill({
  waiting = false,
  children,
}: {
  /** Whether the face hums along, as it does while the tile waits on the avatar. */
  waiting?: boolean;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="luke-call-video-still">
      <span className="luke-call-video-face" aria-hidden="true">
        <WingFace
          motion={waiting ? FACE_MOTION.MONITORING : undefined}
          repeat={waiting}
          muted
          fill
        />
      </span>
      {children}
    </div>
  );
}

/** The block standing where the avatar's picture will, the whole tile under the wait's words. */
function AvatarGroundSkeleton(): React.JSX.Element {
  return (
    <span className="luke-call-video-ground-skeleton">
      <Skeleton shape={SKELETON_SHAPE.BLOCK} />
    </span>
  );
}

/**
 * The wait for the avatar's picture, over the tile while it connects and
 * over its video until the first frame: a skeleton block standing where the
 * picture will, Luke's face, and Connecting video, its words drawn where the
 * tile has room for them and read wherever it has not. Once `gone`, it fades
 * out over the picture under it and its loops hold still (call.css).
 */
function AvatarWaiting({ gone = false }: { gone?: boolean }): React.JSX.Element {
  return (
    <div
      className="luke-call-video-waiting"
      data-gone={String(gone)}
      aria-hidden={gone || undefined}
    >
      <AvatarGroundSkeleton />
      <AvatarStill waiting>
        <span className="luke-call-video-note" role={gone ? undefined : "status"}>
          <ThinkingDots />
          <span className="luke-call-video-note-words">{CALL_VIDEO_LABEL.CONNECTING}</span>
        </span>
      </AvatarStill>
    </div>
  );
}

/** Video ended, why, and Restart video, over Luke's still face. */
function AvatarEnded({
  endReason,
  onRestart,
}: {
  endReason: AvatarEndReason | undefined;
  onRestart: () => void;
}): React.JSX.Element {
  // Note that both restarts are drawn and the tile's width shows one
  // (call.css), because the room is the tile's container's to measure.
  return (
    <AvatarStill>
      <span className="luke-call-video-note">
        <span className="luke-call-video-note-words">{CALL_VIDEO_LABEL.ENDED}</span>
      </span>
      {endReason === undefined ? null : (
        <span className="luke-call-video-note-reason luke-call-video-note-words">
          {AVATAR_END_WORDS[endReason]}
        </span>
      )}
      <span className="luke-call-video-restart" data-room="wide">
        <Button variant={BUTTON_VARIANT.OUTLINE} icon={<ResetIcon />} onClick={onRestart}>
          {CALL_VIDEO_LABEL.RESTART}
        </Button>
      </span>
      <span className="luke-call-video-restart" data-room="narrow" title={CALL_VIDEO_LABEL.RESTART}>
        <IconButton
          icon={<ResetIcon />}
          label={CALL_VIDEO_LABEL.RESTART}
          variant={BUTTON_VARIANT.OUTLINE}
          shape={BUTTON_SHAPE.ROUND}
          onClick={onRestart}
        />
      </span>
    </AvatarStill>
  );
}

/** The tile's ground: the video, the still frame, or what the tile says in its place. */
function TileGround({
  status,
  video,
  endReason,
  onRestart,
  onAspect,
}: {
  status: AvatarStatus;
  video: MediaStreamTrack | undefined;
  endReason: AvatarEndReason | undefined;
  onRestart: () => void;
  onAspect: ((aspect: number) => void) | undefined;
}): React.JSX.Element {
  if (status === AVATAR_STATUS.ENDED) {
    return <AvatarEnded endReason={endReason} onRestart={onRestart} />;
  }
  if (status !== AVATAR_STATUS.LIVE) return <AvatarWaiting />;
  // Note that the video is keyed by its track, because a fresh avatar
  // (Restart video, Video on) publishes a fresh track whose first frame
  // the tile waits on again.
  return video === undefined ? (
    <AvatarStill />
  ) : (
    <AvatarVideo key={video.id} track={video} onAspect={onAspect} />
  );
}

/**
 * The avatar's voice, on an element drawn for as long as its owner is, so
 * no change of tab or of the tile's state cuts it, and muted while the
 * developer's speaker toggle is, as the voice window's own element is.
 */
export function AvatarVoice({
  audio,
  speakerMuted,
  onAudioElement,
}: {
  audio: MediaStreamTrack | undefined;
  speakerMuted: boolean;
  /** The element, once drawn and once gone, for whoever retries a refused play. */
  onAudioElement: (element: HTMLAudioElement | null) => void;
}): React.JSX.Element {
  const sound = useRef<HTMLAudioElement | null>(null);
  const soundElement = useCallback(
    (element: HTMLAudioElement | null) => {
      sound.current = element;
      onAudioElement(element);
    },
    [onAudioElement],
  );
  useTrack(sound, audio);
  // Note that the property is set rather than the attribute, because the
  // attribute is only the element's default and the property is what plays.
  useEffect(() => {
    if (sound.current) sound.current.muted = speakerMuted;
  }, [speakerMuted]);
  // biome-ignore lint/a11y/useMediaCaption: the avatar's voice is captioned in the agent's transcript.
  return <audio ref={soundElement} autoPlay hidden />;
}

/**
 * Luke's avatar while it stands or has just ended: the tile, and nothing
 * where the status is `undefined` or video is off, since the call's own
 * controls carry Video on wherever the tile stands. Where `toggles`, as on
 * the call card, its own Video off stands in its corner; an agent's tab
 * offers it from the composer instead. Where `onAspect` is handed, it is
 * told the picture's own aspect, which an owner drawing the tile at
 * `CALL_VIDEO_FIT.PICTURE` sizes its frame by.
 */
export function CallVideoTile({
  video,
  status,
  endReason,
  fit,
  onSetVideo,
  toggles = true,
  onAspect,
}: {
  video: MediaStreamTrack | undefined;
  status: AvatarStatus | undefined;
  /** Why the avatar ended, said beside "Video ended" while the status is `ENDED`. */
  endReason?: AvatarEndReason | undefined;
  fit: CallVideoFit;
  /** Asks to put the avatar up, a fresh session, or take it down with the developer's own reason. */
  onSetVideo: (on: boolean) => void;
  /** Whether the tile offers its own Video off; the call card's does, an agent's tab's does not. */
  toggles?: boolean;
  /** Told the picture's width over its height as the video learns it, where the owner draws the tile at the picture's own aspect. */
  onAspect?: ((aspect: number) => void) | undefined;
}): React.JSX.Element | null {
  if (status === undefined || status === AVATAR_STATUS.OFF) return null;
  return (
    <section
      className="luke-call-video-tile"
      aria-label={CALL_VIDEO_LABEL.TILE}
      data-status={status}
      data-fit={fit}
    >
      <TileGround
        status={status}
        video={video}
        endReason={endReason}
        onRestart={() => onSetVideo(true)}
        onAspect={onAspect}
      />
      {toggles ? (
        <div className="luke-call-video-controls">
          <VideoToggle on onSetVideo={onSetVideo} />
        </div>
      ) : null}
    </section>
  );
}
