/**
 * call-video-tile.tsx -- the call's video as a 16:9 tile: Luke's picture, or his still frame, and the call's three video presses.
 *
 * The floating call window grows into this tile while the call has video.
 * It draws only what it is handed: the avatar room's two tracks, where the
 * video stands, and the presses, so joining the room and deciding the status
 * are its caller's. What it draws and offers is `call-video-tile-model.ts`'s
 * answer. It carries no words of the conversation.
 */

import { CloseIcon, VideoIcon, WingFace } from "@sidecar/panel";
import { type MouseEvent, type RefObject, useEffect, useRef } from "react";
import { CALL_CONTROL_LABEL } from "../planning/planning-parts";
import { CALL_VIDEO_LABEL, type CallVideoStatus, callVideoTile } from "./call-video-tile-model";

/** What the tile is drawn from; each press is the caller's to turn into an act. */
export interface CallVideoTileProps {
  /** The avatar's picture, absent until the room hands one, and always in the smoke fixture. */
  video: MediaStreamTrack | undefined;
  /** The avatar's voice, lip-synced to the picture, played for as long as it is handed. */
  audio: MediaStreamTrack | undefined;
  status: CallVideoStatus;
  onVideoOff: () => void;
  onRestart: () => void;
  onHangUp: () => void;
}

/**
 * Plays a track on a media element for as long as it is handed. Note that the
 * track is wrapped in a stream of its own, because a media element plays a
 * stream rather than a track, and the stream is let go with the track.
 */
function useTrack(
  element: RefObject<HTMLMediaElement | null>,
  track: MediaStreamTrack | undefined,
) {
  useEffect(() => {
    const media = element.current;
    if (media === null) return;
    media.srcObject = track === undefined ? null : new MediaStream([track]);
    return () => {
      media.srcObject = null;
    };
  }, [element, track]);
}

/**
 * The tile: the picture filling it edge to edge, or Luke's still frame on
 * the tile's ground with what the video is doing said under it, and the
 * presses along its foot over a scrim. Hang up is the call bar's own disc,
 * so ending the call reads the same in a tile as on a card. The whole tile
 * drags the window, as the card does, and a press on a button acts without
 * taking focus, so the next drag never finds a button holding it.
 */
export function CallVideoTile({
  video,
  audio,
  status,
  onVideoOff,
  onRestart,
  onHangUp,
}: CallVideoTileProps): React.JSX.Element {
  const picture = useRef<HTMLVideoElement>(null);
  const voice = useRef<HTMLAudioElement>(null);
  useTrack(picture, video);
  useTrack(voice, audio);
  const tile = callVideoTile({ status, picture: video !== undefined });
  const keepFocus = (event: MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest("button")) event.preventDefault();
  };
  return (
    <section
      className="call-video-tile"
      aria-label="Video"
      data-status={status}
      data-picture={tile.picture}
      onMouseDown={keepFocus}
    >
      {/* Always mounted, so a track handed later lands on the same element. */}
      <video ref={picture} className="call-video-picture" autoPlay playsInline muted />
      {/* biome-ignore lint/a11y/useMediaCaption: Luke's words are captioned where the call's captions already stand; this is the avatar's lip-synced copy of the voice they caption. */}
      <audio ref={voice} autoPlay />
      {tile.picture ? null : (
        <div className="call-video-still">
          <span className="call-video-face">
            <WingFace />
          </span>
          {tile.caption === undefined ? null : (
            <p className="call-video-caption" role="status">
              {tile.caption}
            </p>
          )}
        </div>
      )}
      <div className="call-video-controls">
        {tile.restart ? (
          <button type="button" className="call-video-restart" onClick={onRestart}>
            <VideoIcon />
            {CALL_VIDEO_LABEL.RESTART}
          </button>
        ) : null}
        {tile.videoOff ? (
          <button
            type="button"
            className="call-video-button"
            aria-label={CALL_VIDEO_LABEL.VIDEO_OFF}
            title={CALL_VIDEO_LABEL.VIDEO_OFF}
            onClick={onVideoOff}
          >
            <VideoIcon />
          </button>
        ) : null}
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
  );
}
