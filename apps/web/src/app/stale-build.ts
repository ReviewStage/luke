/**
 * stale-build.ts -- a tab whose chunk failed to load asks to reload onto the build the origin serves now.
 *
 * Every surface the panel draws on demand, a route (`lazyRoute`) or a side
 * bundle (`bundle-loader.ts`), is a chunk the build names by its hash, and a
 * deployment serves only its own: once a newer one is live, an older tab's
 * chunks answer 404, and every import of one it has not loaded yet fails for
 * good, Retry included, since the browser keeps a failed module for the
 * document's life (`lazy-route.ts`). Vite's preload helper, which wraps every
 * `import()` the build writes, says each such failure on the window as
 * `vite:preloadError` before the import rejects, so the one listener the
 * tab's root stands (`web-host.ts`) hears every lazy surface's, and leaves
 * the failure to reach the surface as it would without it. Whatever failed
 * the chunk, a deploy or a dropped connection, only a new document mends it,
 * so the tab offers a reload, in a toast whose Reload leaves through the
 * tab's own way out (`page-leave.ts`), so the panel's own question about
 * unsaved work stands before it.
 *
 * Note that the tab never reloads unasked, because many of those imports
 * are prefetches the developer never pressed for (a page read once the
 * window is idle, a tab read as its card is drawn), and production deploys
 * many times an hour: a reload there lands while they read or type. Offline,
 * nothing is offered, since a reload would trade the surface's own Reload
 * for the browser's error page. The desktop loads its chunks from the app's
 * own files, so only the web's root listens.
 */

import { PRODUCT_NAME } from "@repo/features/product-name";
import { showToast } from "@repo/panel/toast";
import { STATUS_TONE } from "@repo/ui";
import { Effect } from "effect";
import type { PageLeave } from "./page-leave";

/** What Vite's preload helper dispatches on the window where a chunk, or a stylesheet it brings, failed to load. */
export const PRELOAD_ERROR = "vite:preloadError";

/** What the toast says; a deploy or a dropped connection alike. */
const PART_DID_NOT_LOAD = `Part of ${PRODUCT_NAME} could not load`;

/** What the reload needs of the tab, which a test stands in for. */
export interface StaleBuildTab {
  /** Whether the browser has a connection, without which a reload trades the surface's Reload for the browser's error page. */
  readonly online: () => boolean;
  /** The tab's way out, which asks first while a page or a description holds unsaved work. */
  readonly leave: Pick<PageLeave, "leave">;
  /** The tab's reload. */
  readonly reload: () => void;
  /** Asks before reloading, with what Reload does and what the ask sent away unanswered does. */
  readonly askReload: (reload: () => void, dismissed: () => void) => void;
}

/**
 * What each chunk that failed to load does: asks to reload, unless the tab
 * is offline or already asking. Note that the ask is made once until it is
 * answered, so a burst of failures, a chunk and its stylesheet, stands one
 * toast, while an ask dismissed, or a Reload the developer stayed from at
 * the panel's or the browser's question, leaves the next failure asked
 * about again, since a failed chunk's own Retry never mends it.
 */
export function failedChunkAnswer(tab: StaleBuildTab): () => Effect.Effect<void> {
  let asking = false;
  const answered = (): void => {
    asking = false;
  };
  const reload = (): void => {
    answered();
    tab.leave.leave(tab.reload);
  };
  return () =>
    Effect.sync(() => {
      if (asking || !tab.online()) return;
      asking = true;
      tab.askReload(reload, answered);
    });
}

/** This tab, over its own window and way out. */
export function staleBuildTab(leave: StaleBuildTab["leave"]): StaleBuildTab {
  return {
    online: () => navigator.onLine !== false,
    leave,
    reload: () => location.reload(),
    askReload: (reload, dismissed) =>
      showToast({
        words: PART_DID_NOT_LOAD,
        tone: STATUS_TONE.ATTENTION,
        action: { label: "Reload", onPress: reload },
        persists: true,
        onDismiss: dismissed,
      }),
  };
}
