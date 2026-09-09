import * as Sentry from "@sentry/electron/renderer";
import { createRoot } from "react-dom/client";
import { readAppState } from "../use-app-state";
import { VoiceHost } from "./voice-host";

Sentry.init();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("The voice window's root element is missing");
const root = createRoot(rootElement);

// The document is read before anything mounts, the way the panel's own bundle
// reads it: the subscription is installed by the read, so the first turn is
// decided against the state main actually holds rather than against nothing.
// A read that fails mounts nothing — there is no fallback surface for a
// window that draws none, and the main process stands a fresh renderer up.
void (async () => {
  try {
    await readAppState();
    root.render(<VoiceHost />);
  } catch (error) {
    console.error("The voice window's state could not be read; it holds no conversation.", error);
  }
})();
