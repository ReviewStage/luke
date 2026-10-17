import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { WINDOW_ROLE } from "@luke/gateway/window-session";
import type { AppStateSnapshot } from "@luke/host/app-state";
import * as Sentry from "@sentry/electron/renderer";
import { Effect } from "effect";
import { createRoot } from "react-dom/client";
import type { AppBridge } from "#shared/bridge";
import {
  eventWithoutAccessTokens,
  transactionWithoutAccessTokens,
  withoutAccessTokens,
} from "#shared/sentry-breadcrumbs";
import { App } from "./app";
import { installAppBridge } from "./app-bridge";
import { callAvatarAtom } from "./call/call-avatar";
import { CallWindowCard } from "./call/call-card";
import { PanelAvatarVoice } from "./call/panel-avatar";
import { rendererRegistry } from "./renderer-runtime";
import { appStateFirstRead } from "./use-app-state";
import { VoiceHost } from "./voice/voice-host";

// The desktop's bridge is the one the preload exposed as `window.luke`, and
// this is the one place that global is read: everything else reaches main
// through `appBridge()`, which reads what is installed here before anything
// below subscribes or draws.
const preloadWindow: Window & { readonly luke?: AppBridge } = window;
if (preloadWindow.luke === undefined) throw new Error("The preload's bridge is missing");
installAppBridge(preloadWindow.luke);

// Every window's tracing, as Sentry's Electron guide sets up a renderer; the
// DSN, release, and environment are main's, which every renderer event goes
// through.
Sentry.init({
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 1.0,
  beforeBreadcrumb: withoutAccessTokens,
  beforeSend: eventWithoutAccessTokens,
  beforeSendTransaction: transactionWithoutAccessTokens,
});

// The panel's avatar is subscribed to before anything is drawn, because main
// hands a page the standing grant once it has drawn its first frame. No other
// window is ever handed one, so elsewhere it stands idle.
rendererRegistry.mount(callAvatarAtom);

// One root for the panels, the hidden voice window, and the floating call
// window alike, mounting by the role main decided for the window that asked.
// The voice window mounts `VoiceHost` and the call window `CallWindowCard`,
// and neither ever mounts `App`, the one place recording starts. The panel
// plays the avatar's voice beside `App`, so no tab it shows cuts it.
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
        <>
          <PanelAvatarVoice />
          <App />
        </>
      )}
    </RegistryContext.Provider>,
  );
})();
