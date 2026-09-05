import { useRef } from "react";
import { useVoiceSession } from "./use-voice-session";

/**
 * What the hidden voice window mounts: the live conversation, and the one
 * element Luke's voice plays through. Nothing drawn. It never mounts `App`
 * and never imports the session-replay client, because this window is not
 * the panel and must not record; `repository-checks.sh` holds that line for
 * everything under `renderer/voice/`.
 */
export function VoiceHost(): React.JSX.Element {
  const remoteAudio = useRef<HTMLAudioElement | null>(null);
  useVoiceSession(remoteAudio);
  return (
    // Luke's own voice. Muted playback would defeat the point, so this is the
    // one element allowed to make sound.
    <audio ref={remoteAudio} autoPlay hidden>
      <track kind="captions" />
    </audio>
  );
}
