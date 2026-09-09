import * as Sentry from "@sentry/electron/renderer";
import { createRoot } from "react-dom/client";
import { ACT_KIND } from "#shared/messages/acts";
import { WINDOW_ROLE } from "#shared/messages/session";
import { tell } from "./act";
import { App } from "./app";
import { IntroductionTakeover } from "./introduction/introduction-takeover";
import { readAppState } from "./use-app-state";

Sentry.init();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Renderer root element is missing");
const root = createRoot(rootElement);

// Which surface this window draws is the main process's answer, read with the
// rest of the document before anything mounts: the introduction takeover must
// not run the panel's hooks, and the panel must not open the takeover's call.
// The hidden voice window is not one of the two: it loads a bundle of its
// own, which is what keeps `App` and the session-replay client out of a
// window nobody consented to a recording of. A state that cannot be read
// draws nothing, never the panel. A takeover whose read fails reports its own
// abandonment rather than drawing the panel fullscreen — and if even that
// report is lost, the main process's mount deadline stands the takeover
// down.
void (async () => {
  try {
    const state = await readAppState();
    if (state.window.role === WINDOW_ROLE.INTRODUCTION) {
      const display = state.window.display;
      // Only the hidden voice window stands on no display; a takeover handed
      // none has nothing to cover and stands down.
      if (display === undefined) {
        tell(ACT_KIND.INTRODUCTION_ABANDON, { reason: "The takeover's state named no display." });
        return;
      }
      root.render(<IntroductionTakeover state={state} display={display} />);
      return;
    }
    root.render(<App />);
  } catch (error) {
    // A window whose state cannot be read mounts nothing: a panel in that
    // state is already broken, since it draws from the same read, so a
    // fallback would protect nothing.
    //
    // Which of the two this is cannot be known without that read, so the
    // abandon is sent whatever this window turns out to be: the main process
    // answers it only for the takeover it owns and refuses a panel's
    // outright, and a takeover that stands down here rather than waiting out
    // the mount deadline hands the screen back at once.
    tell(ACT_KIND.INTRODUCTION_ABANDON, { reason: "The window could not read its state." });
    console.error("The window's state could not be read; nothing is drawn.", error);
  }
})();
