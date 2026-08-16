import type { CallApp } from "../shared/contracts";
import { MicrophoneIcon } from "./settings-icons";

/**
 * An app's own icon, drawn where one is available.
 *
 * The icon arrives from the helper as a small PNG rather than a file path,
 * because the renderer is sandboxed and has no business reading the filesystem
 * — and because an app that has since quit still has to be recognisable in the
 * exemptions list, which is why an exemption stores the icon with it.
 *
 * An app macOS gave no icon for falls back to the microphone glyph. Not a
 * generic app icon: what these rows have in common is the device, and the glyph
 * says that where a blank square would only say something is missing.
 */
export function CallAppMark({ app }: { app: CallApp }): React.JSX.Element {
  return (
    <span className="call-app-mark" aria-hidden="true">
      {app.icon ? <img alt="" src={`data:image/png;base64,${app.icon}`} /> : <MicrophoneIcon />}
    </span>
  );
}

/**
 * The mark and the name, which is every row's whole left-hand side — in the
 * panel and in the prompt alike, so an app is recognised the same way in both.
 */
export function CallAppName({ app }: { app: CallApp }): React.JSX.Element {
  return (
    <span className="settings-copy call-app-copy">
      <CallAppMark app={app} />
      <strong>{app.name}</strong>
    </span>
  );
}
