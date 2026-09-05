/**
 * What the hidden voice window mounts: the element Luke's voice will play
 * through and nothing drawn. It never mounts `App` and never imports the
 * session-replay client, because this window is not the panel and must not
 * record; `repository-checks.sh` holds that line for everything under
 * `renderer/voice/`.
 */
export function VoiceHost(): React.JSX.Element {
  return (
    <audio autoPlay hidden>
      <track kind="captions" />
    </audio>
  );
}
