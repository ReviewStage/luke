import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { WINDOW_ROLE } from "@luke/gateway/window-session";
import type { AppStateSnapshot } from "@luke/host/app-state";
import * as Sentry from "@sentry/electron/renderer";
import { Effect } from "effect";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { CallWindowCard } from "./call/call-card";
import { rendererRegistry } from "./renderer-runtime";
import { appStateFirstRead } from "./use-app-state";
import { VoiceHost } from "./voice/voice-host";

Sentry.init();

// One root for the panels, the hidden voice window, and the floating call
// window alike, mounting by the role main decided for the window that asked.
// The voice window mounts `VoiceHost` and the call window `CallWindowCard`,
// and neither ever mounts `App`, the one place recording starts.
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Renderer root element is missing");
const root = createRoot(rootElement);

void (async () => {
  let first: AppStateSnapshot;
  try {
    first = await Effect.runPromise(appStateFirstRead);
  } catch (error) {
    // A window whose state cannot be read mounts nothing: a fallback would
    // protect nothing.
    console.error("The window's state could not be read; nothing is drawn.", error);
    return;
  }
  root.render(
    <RegistryContext.Provider value={rendererRegistry}>
      {first.window.role === WINDOW_ROLE.VOICE ? (
        <VoiceHost />
      ) : first.window.role === WINDOW_ROLE.CALL ? (
        <CallWindowCard />
      ) : (
        <App />
      )}
    </RegistryContext.Provider>,
  );
})();
