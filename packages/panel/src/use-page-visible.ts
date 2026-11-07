import { useSyncExternalStore } from "react";

/**
 * use-page-visible.ts -- whether the window's page is visible, as the document says.
 *
 * Not while the window is hidden or minimized, or its browser tab is in the
 * background; read anew as the document says it was shown or hidden.
 */

/** Hears the window's page shown or hidden. */
function onVisibilityChange(changed: () => void): () => void {
  document.addEventListener("visibilitychange", changed);
  return () => document.removeEventListener("visibilitychange", changed);
}

/** Whether the window's page is visible. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(onVisibilityChange, () => document.visibilityState === "visible");
}
