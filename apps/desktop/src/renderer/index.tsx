import { RegistryContext } from "@effect/atom-react/RegistryContext";
import * as Sentry from "@sentry/electron/renderer";
import { Effect } from "effect";
import { createRoot } from "react-dom/client";
import type { AppStateSnapshot } from "#shared/messages/app-state";
import { WINDOW_ROLE } from "#shared/messages/session";
import { App } from "./app";
import { rendererRegistry } from "./renderer-runtime";
import { appStateFirstRead } from "./use-app-state";
import { VoiceHost } from "./voice/voice-host";

Sentry.init();

// One root for the panels and the hidden voice window alike, mounting by the
// role main decided for the window that asked. The voice window mounts
// `VoiceHost` and never `App`, the one place recording starts.
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
      {first.window.role === WINDOW_ROLE.VOICE ? <VoiceHost /> : <App />}
    </RegistryContext.Provider>,
  );
})();
