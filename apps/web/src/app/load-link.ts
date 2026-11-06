import { currentTaskPath, readShownLink, type ShownLink } from "@repo/features/link-grammar";
import { LINK_ORIGIN } from "@repo/features/link-home";
import type { AppBridge } from "@repo/host/bridge";
import { savesStep } from "@repo/panel/navigation-history";
import type { RouterHistory } from "@tanstack/react-router";
import { addressHere, PANEL_PATH } from "./web-address";

const PANEL_PATHS: ReadonlySet<string> = new Set([PANEL_PATH, `${PANEL_PATH}.html`]);

function linkHere(): ShownLink | undefined {
  if (PANEL_PATHS.has(location.pathname.replace(/\/$/u, ""))) return undefined;
  return readShownLink(`${LINK_ORIGIN}${addressHere()}`);
}

export function withLoadLink(bridge: AppBridge, history: RouterHistory): AppBridge {
  const opened = addressHere();
  const current = currentTaskPath(opened);
  if (current !== opened) {
    history.replace(current, history.location.state);
    history.flush();
  }
  let loaded = savesStep(history.location) ? undefined : linkHere();
  return {
    ...bridge,
    onShowLink: (listener) => {
      const stop = bridge.onShowLink(listener);
      const stopLanding = history.subscribe(({ location, action }) => {
        if (action.type === "PUSH" || action.type === "REPLACE" || savesStep(location)) return;
        const link = linkHere();
        if (link !== undefined) listener(link);
      });
      const waiting = loaded;
      loaded = undefined;
      if (waiting !== undefined) listener(waiting);
      return () => {
        stop();
        stopLanding();
      };
    },
  };
}
