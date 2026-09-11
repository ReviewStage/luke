import { RegistryContext } from "@effect-atom/atom-react/RegistryContext";
import * as Sentry from "@sentry/electron/renderer";
import { Effect } from "effect";
import { createRoot } from "react-dom/client";
import { ACT_KIND } from "#shared/messages/acts";
import { actRequest } from "./act";
import { App } from "./app";
import { IntroductionTakeover } from "./introduction/introduction-takeover";
import { rendererRegistry } from "./renderer-runtime";
import { appStateFirstRead, useAppState } from "./use-app-state";

Sentry.init();

/**
 * Which surface the panel's bundle draws, from the one document main holds:
 * the spoken introduction is a fullscreen mode of the panel rather than a
 * window of its own, so it is drawn instead of `App` while it plays and the
 * takeover never runs the panel's hooks. The hidden voice window is not one
 * of them: it loads a bundle of its own, which is what keeps `App` and the
 * session-replay client out of a window nobody consented to a recording of.
 * A state that cannot be read draws nothing, never the panel.
 */
function Surface(): React.JSX.Element | null {
  const state = useAppState();
  if (!state) return null;
  return state.introduction.playing ? <IntroductionTakeover /> : <App />;
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Renderer root element is missing");
void (async () => {
  try {
    await Effect.runPromise(appStateFirstRead);
  } catch (error) {
    // A window whose state cannot be read mounts nothing: a panel in that
    // state is already broken, since it draws from the same read, so a
    // fallback would protect nothing. Whether this panel is the one holding a
    // takeover cannot be known without that read either, so the abandon is
    // sent regardless — main answers it only for a panel the introduction is
    // holding and refuses every other sender outright, and a takeover that
    // stands down here hands the screen back at once rather than covering it
    // with nothing.
    void window.sidecar
      .act(
        actRequest(ACT_KIND.INTRODUCTION_ABANDON, {
          reason: "The window could not read its state.",
        }),
      )
      .catch(() => undefined);
    console.error("The window's state could not be read; nothing is drawn.", error);
  }
})();
createRoot(rootElement).render(
  <RegistryContext.Provider value={rendererRegistry}>
    <Surface />
  </RegistryContext.Provider>,
);
