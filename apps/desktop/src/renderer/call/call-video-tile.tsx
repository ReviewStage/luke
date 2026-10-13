/**
 * call-video-tile.tsx -- Luke's avatar on the call, as a 16:9 tile with its video's controls.
 *
 * The tile draws what it is handed and decides nothing: the avatar's video
 * and its lip-synced audio as two tracks, the avatar's status, and the
 * speaker toggle the call bar already holds. While the avatar connects it
 * draws Luke's face and says so; while it is live it plays the video, or
 * Luke's face as a still frame where no video track is handed, which is what
 * a fixture run draws, since it reaches no avatar; once it has ended it
 * offers Restart video. Video off puts the avatar away and leaves the call
 * going as voice, and End call ends the call, in every state. No word of the
 * conversation is drawn here.
 */

import { CloseIcon, ResetIcon, VideoOffIcon, WingFace } from "@sidecar/panel";
import { type MouseEvent, useEffect, useRef } from "react";
import { CALL_CONTROL_LABEL } from "../planning/planning-parts";
import { ThinkingDots } from "../thinking-dots";

/**
 * The avatar's status, in the shape #1 pins for `state.voice.avatar`. Note
 * that it is declared here because #1 is not yet on main: #9b, which mounts
 * the tile, replaces it with #1's `AVATAR_STATUS` from `#shared/messages/`.
 */
export const AVATAR_STATUS = {
  OFF: "off",
  STARTING: "starting",
  LIVE: "live",
  ENDED: "ended",
} as const;

type AvatarStatus = (typeof AVATAR_STATUS)[keyof typeof AVATAR_STATUS];

/** What the tile says, for a reader and on screen. */
export const CALL_VIDEO_LABEL = {
  TILE: "Video call",
  CONNECTING: "Connecting video",
  ENDED: "Video ended",
  VIDEO_OFF: "Turn video off",
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

/** The avatar's video, muted, since its sound is the audio element's to play. */
function AvatarVideo({ track }: { track: MediaStreamTrack }): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null);
  useTrack(video, track);
  return <video ref={video} className="call-video-frame" autoPlay muted playsInline />;
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
}: {
  status: AvatarStatus;
  video: MediaStreamTrack | undefined;
  onRestart: () => void;
}): React.JSX.Element {
  if (status === AVATAR_STATUS.LIVE) {
    return video === undefined ? <AvatarStill /> : <AvatarVideo track={video} />;
  }
  if (status === AVATAR_STATUS.ENDED) {
    return (
      <AvatarStill>
        <span className="call-video-note">{CALL_VIDEO_LABEL.ENDED}</span>
        <button type="button" className="toolbar-button call-video-restart" onClick={onRestart}>
          <ResetIcon />
          {CALL_VIDEO_LABEL.RESTART}
        </button>
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
 * The tile, drawn in the floating call window while the avatar stands or
 * has just ended, and nothing while it is off. The audio element is drawn
 * in every state, so the avatar's voice is never cut by the tile changing
 * state, and it is muted while the developer's speaker toggle is, as the
 * voice window's own element is. The window is dragged by the tile wherever it is held but
 * on a button, and a press on a button takes no focus, as the call card's do.
 */
export function CallVideoTile({
  video,
  audio,
  status,
  speakerMuted,
  onVideoOff,
  onRestart,
  onHangUp,
}: {
  video: MediaStreamTrack | undefined;
  audio: MediaStreamTrack | undefined;
  status: AvatarStatus;
  speakerMuted: boolean;
  onVideoOff: () => void;
  onRestart: () => void;
  onHangUp: () => void;
}): React.JSX.Element {
  const sound = useRef<HTMLAudioElement>(null);
  useTrack(sound, audio);
  // Note that the property is set rather than the attribute, because the
  // attribute is only the element's default and the property is what plays.
  useEffect(() => {
    if (sound.current) sound.current.muted = speakerMuted;
  }, [speakerMuted]);
  const keepFocus = (event: MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest("button")) event.preventDefault();
  };
  return (
    <>
      {/* biome-ignore lint/a11y/useMediaCaption: the avatar's voice is captioned in the panel, not here. */}
      <audio ref={sound} autoPlay hidden />
      {status === AVATAR_STATUS.OFF ? null : (
        <section
          className="call-video-tile"
          aria-label={CALL_VIDEO_LABEL.TILE}
          data-status={status}
          onMouseDown={keepFocus}
        >
          <TileGround status={status} video={video} onRestart={onRestart} />
          <div className="call-video-controls">
            <button
              type="button"
              className="icon-button call-video-off"
              aria-label={CALL_VIDEO_LABEL.VIDEO_OFF}
              title={CALL_VIDEO_LABEL.VIDEO_OFF}
              onClick={onVideoOff}
            >
              <VideoOffIcon />
            </button>
            <button
              type="button"
              className="call-end"
              aria-label={CALL_CONTROL_LABEL.END_CALL}
              title={CALL_CONTROL_LABEL.END_CALL}
              onClick={onHangUp}
            >
              <CloseIcon />
            </button>
          </div>
        </section>
      )}
    </>
  );
}
