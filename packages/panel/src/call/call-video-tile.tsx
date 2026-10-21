/**
 * call-video-tile.tsx -- Luke's avatar on the call, as a tile with its video's controls, and the voice it plays.
 *
 * The tile draws what it is handed and decides nothing: the avatar's video
 * track and its status. While the avatar connects it
 * draws Luke's face and says so; while it is live it plays the video, or
 * Luke's face as a still frame where no video track is handed, which is what
 * a fixture run draws, since it reaches no avatar; once it has ended it
 * offers Restart video. Video off puts the avatar away and leaves the call
 * going as voice, in every state, and the tile goes; Video on, which puts a
 * fresh avatar up again, is the call's own controls', as ending the call is,
 * which the tile does not repeat. No word of the conversation is drawn
 * here. The avatar's lip-synced voice is played apart
 * from the tile (`AvatarVoice`), because the tile is drawn only while the
 * call's agent's tab or the call card is, and the voice is what the
 * developer hears whatever is shown. The video is drawn whole, never cut:
 * in an agent's tab the tile stands at the picture's own aspect, which it
 * fills; on the call card, where the tile is wider than the avatar's square
 * picture, a blurred copy of the same track fills the sides behind it
 * (call.css).
 */

import {
  BUTTON_SHAPE,
  Button,
  IconButton,
  ResetIcon,
  VideoIcon,
  VideoOffIcon,
  WingFace,
} from "@luke/ui";
import { AVATAR_STATUS, type AvatarStatus } from "@luke/voice/avatar";
import { useCallback, useEffect, useRef } from "react";
import { ThinkingDots } from "../thinking-dots.js";

/** What the tile says, for a reader and on screen. */
export const CALL_VIDEO_LABEL = {
  TILE: "Video call",
  CONNECTING: "Connecting video",
  ENDED: "Video ended",
  VIDEO_OFF: "Turn video off",
  VIDEO_ON: "Turn video on",
  RESTART: "Restart video",
} as const;

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

/** The avatar's video, muted, since its sound is the audio element's to play. */
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
  return (
    <>
      <video ref={video} className="call-video-frame" autoPlay muted playsInline />
      <video
        ref={fill}
        className="call-video-fill"
        aria-hidden="true"
        tabIndex={-1}
        autoPlay
        muted
        playsInline
      />
    </>
  );
}

/** Luke's face where there is no video to draw, with what the tile is waiting on, if anything. */
function AvatarStill({ children }: { children?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="call-video-still">
      <span className="call-video-face" aria-hidden="true">
        <WingFace />
      </span>
      {children}
    </div>
  );
}

/** The tile's ground: the video, the still frame, or what the tile says in its place. */
function TileGround({
  status,
  video,
  onRestart,
  onAspect,
}: {
  status: AvatarStatus;
  video: MediaStreamTrack | undefined;
  onRestart: () => void;
  onAspect: ((aspect: number) => void) | undefined;
}): React.JSX.Element {
  if (status === AVATAR_STATUS.LIVE) {
    return video === undefined ? (
      <AvatarStill />
    ) : (
      <AvatarVideo track={video} onAspect={onAspect} />
    );
  }
  if (status === AVATAR_STATUS.ENDED) {
    return (
      <AvatarStill>
        <span className="call-video-note">{CALL_VIDEO_LABEL.ENDED}</span>
        <Button icon={<ResetIcon />} onClick={onRestart}>
          {CALL_VIDEO_LABEL.RESTART}
        </Button>
      </AvatarStill>
    );
  }
  return (
    <AvatarStill>
      <span className="call-video-note" role="status">
        <ThinkingDots />
        {CALL_VIDEO_LABEL.CONNECTING}
      </span>
    </AvatarStill>
  );
}

/**
 * The avatar's voice, on an element drawn for as long as the panel is, so
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
  // biome-ignore lint/a11y/useMediaCaption: the avatar's voice is captioned in the Call tab's transcript.
  return <audio ref={soundElement} autoPlay hidden />;
}

/**
 * Video off or Video on: one button that says which the press will do,
 * named on hover by the system's own hint, since the floating window is too
 * small to hold a tooltip. It is round wherever it stands, as a call's own
 * controls are, so the toggle keeps its shape as it flips; over the tile
 * the disc is the round ground itself, never a square inside a circle.
 */
export function VideoToggle({
  on,
  onSetVideo,
}: {
  on: boolean;
  onSetVideo: (on: boolean) => void;
}): React.JSX.Element {
  const label = on ? CALL_VIDEO_LABEL.VIDEO_OFF : CALL_VIDEO_LABEL.VIDEO_ON;
  return (
    <span className="call-video-toggle" title={label}>
      <IconButton
        icon={on ? <VideoOffIcon /> : <VideoIcon />}
        label={label}
        shape={BUTTON_SHAPE.ROUND}
        onClick={() => onSetVideo(!on)}
      />
    </span>
  );
}

/**
 * Luke's avatar while it stands or has just ended: the tile, and nothing
 * where the status is `undefined` or video is off, since the call's own
 * controls carry Video on wherever the tile stands (the call card's head,
 * an agent's composer). Where `toggles`, as on the call card, its own Video
 * off stands in its corner; an agent's tab offers it from the composer
 * instead. Where `onAspect` is handed, it is told the picture's own
 * aspect, which an agent's tab draws the tile at (`AgentCallVideo`).
 */
export function CallVideoTile({
  video,
  status,
  onSetVideo,
  toggles = true,
  onAspect,
}: {
  video: MediaStreamTrack | undefined;
  status: AvatarStatus | undefined;
  /** Asks main to put the avatar up, a fresh session, or take it down with the developer's own reason. */
  onSetVideo: (on: boolean) => void;
  /** Whether the tile offers its own Video off; the call card's does, an agent's tab's does not. */
  toggles?: boolean;
  /** Told the picture's width over its height as the video learns it, where the owner draws the tile at the picture's own aspect. */
  onAspect?: ((aspect: number) => void) | undefined;
}): React.JSX.Element | null {
  if (status === undefined || status === AVATAR_STATUS.OFF) return null;
  return (
    <section className="call-video-tile" aria-label={CALL_VIDEO_LABEL.TILE} data-status={status}>
      <TileGround
        status={status}
        video={video}
        onRestart={() => onSetVideo(true)}
        onAspect={onAspect}
      />
      {toggles ? (
        <div className="call-video-controls">
          <VideoToggle on onSetVideo={onSetVideo} />
        </div>
      ) : null}
    </section>
  );
}
