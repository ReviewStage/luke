/**
 * stale-build.ts -- a tab whose chunk failed to load reloads onto the build the origin serves now: unasked, or asked first while it holds work a reload would lose.
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
 * so the tab reloads. The address holds the developer's place, and a
 * composer's words are written as the page goes (`composer-drafts.ts`), so a
 * reload loses nothing typed in a box; but a page or a plan holding unsaved
 * work, a field being typed in, files attached to a draft, or a line held
 * unsent with its Retry, none of which storage keeps, is asked about first,
 * in a toast whose Reload leaves through the tab's own way out
 * (`page-leave.ts`), so the panel's own question stands before it.
 *
 * Note that a tab reloads unasked at most once in `RELOAD_GUARD_MS`, kept in
 * the tab's session storage, so a reload that lands where the chunk fails
 * again, a page cached from the old build or a connection still down, never
 * loops: the surface's own failure, with its Reload, stands instead, as it
 * does offline and where session storage keeps nothing. The desktop loads
 * its chunks from the app's own files, so only the web's root listens.
 */

import { PRODUCT_NAME } from "@repo/features/product-name";
import { holdsUnkept } from "@repo/panel/composer-drafts";
import { rendererRegistry } from "@repo/panel/renderer-runtime";
import { showToast } from "@repo/panel/toast";
import { STATUS_TONE } from "@repo/ui";
import { Clock, Effect } from "effect";
import type { PageLeave } from "./page-leave";

/** What Vite's preload helper dispatches on the window where a chunk, or a stylesheet it brings, failed to load. */
export const PRELOAD_ERROR = "vite:preloadError";

/** How long after an unasked reload a failure is left to its surface's own Reload, so a reload that cannot mend it never loops. */
const RELOAD_GUARD_MS = 30_000;

/** Where the tab's session keeps when it last reloaded unasked, in epoch milliseconds. */
const RELOADED_AT_KEY = "app.staleBuild.reloadedAt";

/** What the toast says where the tab holds work a reload would lose. */
const NEW_VERSION_READY = `A new version of ${PRODUCT_NAME} is ready`;

/** The tab's session storage as far as the reload is kept there. */
type SessionKeep = Pick<Storage, "getItem" | "setItem">;

/** What the reload needs of the tab, which a test stands in for. */
export interface StaleBuildTab {
  /** Whether the browser has a connection, without which a reload trades the surface's Reload for the browser's error page. */
  readonly online: () => boolean;
  /** The tab's session storage, or none where the browser keeps none. */
  readonly session: SessionKeep | undefined;
  /** The tab's way out, and whether it holds work a reload would lose. */
  readonly leave: Pick<PageLeave, "leave" | "holdsWork">;
  /** Whether the tab holds what no page's leave covers and a reload would lose: a field being typed in, a draft's files, a line held unsent. */
  readonly unkept: () => boolean;
  /** The tab's reload. */
  readonly reload: () => void;
  /** Asks before reloading, with what Reload does. */
  readonly askReload: (reload: () => void) => void;
}

/** Whether the tab reloaded unasked this session within the guard; not where it has not or storage refuses the read. */
function reloadedLately(session: SessionKeep | undefined, now: number): boolean {
  try {
    const at = session?.getItem(RELOADED_AT_KEY);
    return at != null && now - Number(at) < RELOAD_GUARD_MS;
  } catch {
    return false;
  }
}

/** Keeps when the tab reloads unasked, answering whether it was kept. */
function keepReloadedAt(session: SessionKeep | undefined, now: number): boolean {
  if (session === undefined) return false;
  try {
    session.setItem(RELOADED_AT_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/**
 * What one chunk that failed to load does: a reload, asked about first while
 * work stands, unless the tab is offline or reloaded unasked within the
 * guard. The window's root answers each failure the preload helper says in
 * turn (`web-host.ts`), so a burst of them, a chunk and its stylesheet,
 * reloads for the first and finds the reload kept for the rest.
 */
export function answerFailedChunk(tab: StaleBuildTab): Effect.Effect<void> {
  return Effect.map(Clock.currentTimeMillis, (now) => {
    if (!tab.online() || reloadedLately(tab.session, now)) return;
    if (!tab.leave.holdsWork() && !tab.unkept()) {
      // Note that a reload that cannot be kept is never made, so it cannot loop.
      if (keepReloadedAt(tab.session, now)) tab.reload();
      return;
    }
    // Note that a Reload asked about is the developer's own press each time, so it is kept as no
    // reload: one they stayed from at the browser's question leaves the next failure asked again.
    tab.askReload(() => tab.leave.leave(tab.reload));
  });
}

/** Whether focus stands in a field whose words are being typed. */
function typingInField(): boolean {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused.isContentEditable) return true;
  return focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement;
}

/** The tab's session storage, or none where the browser refuses it. */
function tabSession(): SessionKeep | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** This tab, over its own window, document, and way out. */
export function staleBuildTab(leave: StaleBuildTab["leave"]): StaleBuildTab {
  return {
    online: () => navigator.onLine !== false,
    session: tabSession(),
    leave,
    unkept: () => typingInField() || holdsUnkept(rendererRegistry),
    reload: () => location.reload(),
    askReload: (reload) =>
      showToast({
        words: NEW_VERSION_READY,
        tone: STATUS_TONE.ATTENTION,
        action: { label: "Reload", onPress: reload },
        persists: true,
      }),
  };
}
