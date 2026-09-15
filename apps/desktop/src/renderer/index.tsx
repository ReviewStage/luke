import { RegistryContext } from "@effect/atom-react/RegistryContext";
import * as Sentry from "@sentry/electron/renderer";
import { Effect } from "effect";
import { createRoot } from "react-dom/client";
import { ACT_KIND } from "#shared/messages/acts";
import type { AppStateSnapshot } from "#shared/messages/app-state";
import { actRequest } from "./act";
import { App } from "./app";
import { IntroductionTakeover } from "./introduction/introduction-takeover";
import { rendererRegistry } from "./renderer-runtime";
import { surfaceFor } from "./surface-for";
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

/**
 * The one renderer root, for the panels and the hidden voice window alike.
 * Both documents load this bundle; which surface mounts is the window's role
 * as main decided it by which window asked (`windowFactsFor`), read off the
 * first snapshot and never off anything the renderer could claim about
 * itself. The voice window mounts `VoiceHost` and nothing else: `App` is the
 * one place the session-replay client is started, so the recording never
 * begins there, and `voice.html`'s policy allows no network at all, so it
 * could not post if it did. The recording itself carries no words in either
 * case (`session-replay.ts`), which is what let the two bundles this used to
 * be become one.
 */
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Renderer root element is missing");
const root = createRoot(rootElement);

// The document is read before anything mounts: the subscription is installed
// by the read, so the first turn is decided against the state main actually
// holds rather than against nothing, and the role is on that same reading.
void (async () => {
  let first: AppStateSnapshot;
  try {
    first = await Effect.runPromise(appStateFirstRead);
  } catch (error) {
    // A window whose state cannot be read mounts nothing: a panel in that
    // state is already broken, since it draws from the same read, so a
    // fallback would protect nothing, and the voice window draws none.
    // Whether this window is the panel holding a takeover cannot be known
    // without that read either, so the abandon is sent regardless — main
    // answers it only for a panel the introduction is holding and refuses
    // every other sender outright, the voice window among them, and a
    // takeover that stands down here hands the screen back at once rather
    // than covering it with nothing.
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
      {surfaceFor(first.window.role, { panel: Surface, voice: VoiceHost })}
    </RegistryContext.Provider>,
  );
})();
