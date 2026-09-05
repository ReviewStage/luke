import * as Sentry from "@sentry/electron/renderer";
import { createRoot } from "react-dom/client";
import { WINDOW_ROLE } from "#shared/wire/session";
import { App } from "./app";
import { IntroductionTakeover } from "./introduction/introduction-takeover";
import { VoiceHost } from "./voice/voice-host";

Sentry.init();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Renderer root element is missing");
const root = createRoot(rootElement);

// Which surface this window draws is the main process's answer, asked before
// anything mounts: the introduction takeover must not run the panel's hooks,
// the panel must not open the takeover's call, and the hidden voice window
// draws nothing and records nothing. The role is its own tiny
// invoke so the panel is not held on the full bootstrap twice; a role that
// cannot be read falls back to the panel, the surface every window drew
// before roles existed. A takeover whose bootstrap fails reports its own
// abandonment rather than drawing the panel fullscreen — and if even that
// report is lost, the main process's mount deadline stands the takeover down.
void (async () => {
  try {
    const role = await window.sidecar.getWindowRole();
    if (role === WINDOW_ROLE.INTRODUCTION) {
      try {
        const bootstrap = await window.sidecar.getBootstrap();
        const { display } = bootstrap;
        // Only the hidden voice window bootstraps without a display; a takeover
        // handed none has nothing to cover and stands down.
        if (display === undefined) {
          window.sidecar.abandonIntroduction("The takeover's bootstrap named no display.");
          return;
        }
        root.render(<IntroductionTakeover bootstrap={{ ...bootstrap, display }} />);
      } catch {
        window.sidecar.abandonIntroduction("The takeover could not read its bootstrap.");
      }
      return;
    }
    if (role === WINDOW_ROLE.VOICE) {
      root.render(<VoiceHost />);
      return;
    }
  } catch {
    // Fall through to the panel.
  }
  root.render(<App />);
})();
