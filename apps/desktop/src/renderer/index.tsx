import { RegistryContext } from "@effect/atom-react/RegistryContext";
import * as Sentry from "@sentry/electron/renderer";
import { Effect } from "effect";
import { createRoot } from "react-dom/client";
import { ACT_KIND } from "#shared/messages/acts";
import type { AppStateSnapshot } from "#shared/messages/app-state";
import { WINDOW_ROLE } from "#shared/messages/session";
import { actRequest } from "./act";
import { App } from "./app";
import { IntroductionTakeover } from "./introduction/introduction-takeover";
import { rendererRegistry } from "./renderer-runtime";
import { appStateFirstRead, useAppState } from "./use-app-state";
import { VoiceHost } from "./voice/voice-host";

Sentry.init();

/**
 * Which surface a panel draws, from the one document main holds: the spoken
 * introduction is a fullscreen mode of the panel rather than a window of its
 * own, so it is drawn instead of `App` while it plays and the takeover never
 * runs the panel's hooks. A state that cannot be read draws nothing, never
 * the panel.
 */
function Surface(): React.JSX.Element | null {
  const state = useAppState();
  if (!state) return null;
  return state.introduction.playing ? <IntroductionTakeover /> : <App />;
}

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
    // protect nothing. Whether it is the panel holding a takeover cannot be
    // known without that read either, so the abandon is sent regardless —
    // main answers it only for the panel the introduction holds and refuses
    // every other sender, the voice window among them.
    void window.sidecar
      .act(
        actRequest(ACT_KIND.INTRODUCTION_ABANDON, {
          reason: "The window could not read its state.",
        }),
      )
      .catch(() => undefined);
    console.error("The window's state could not be read; nothing is drawn.", error);
    return;
  }
  root.render(
    <RegistryContext.Provider value={rendererRegistry}>
      {first.window.role === WINDOW_ROLE.VOICE ? <VoiceHost /> : <Surface />}
    </RegistryContext.Provider>,
  );
})();
