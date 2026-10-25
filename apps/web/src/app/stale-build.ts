/**
 * stale-build.ts -- a tab left open across a deploy moved onto the build now live where a chunk of its own failed to load: reloaded once, or asked first while it holds work a reload would lose.
 *
 * Every surface the panel draws on demand, a route (`lazyRoute`) or a side
 * bundle (`bundle-loader.ts`), is a chunk the build names by its hash, and a
 * deployment serves only its own: once a newer one is live, an older tab's
 * chunks answer 404, and every import of one it has not loaded yet fails for
 * good, Retry included. Vite's preload helper, which wraps every `import()`
 * the build writes, says each such failure on the window as
 * `vite:preloadError` before the import rejects, so the one listener the
 * tab's root stands (`web-host.ts`) hears every lazy surface's, and leaves
 * the failure to reach the surface as it would without it. The tab then reads the panel's page as the origin serves
 * it now, and where the entry script it names is no longer this tab's, the
 * build has moved on and the tab reloads onto it. The address holds the
 * developer's place, and a composer's words are written as the page goes
 * (`composer-drafts.ts`), so a reload loses nothing typed in a box; but a
 * page or a plan holding unsaved work, or a field being typed in, is asked
 * about first, in a toast whose Reload leaves through the tab's own way out
 * (`page-leave.ts`), so the panel's own question stands before it.
 *
 * Note that a tab reloads away from a build at most once a session, kept in
 * the tab's session storage, so a reload that lands on the same build, as a
 * cached page might, never loops: the surface's own failure, with its
 * Retry, stands instead, as it does where the build has not moved (a
 * connection dropped for a moment), where the live page could not be read,
 * and where session storage keeps nothing. The desktop loads its chunks from
 * the app's own files, so only the web's root listens.
 */

import { showToast } from "@luke/panel/toast";
import { STATUS_TONE } from "@luke/ui";
import { Effect, Option } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import type { PageLeave } from "./page-leave";
import { PANEL_PATH } from "./web-address";

/** What Vite's preload helper dispatches on the window where a chunk, or a stylesheet it brings, failed to load. */
export const PRELOAD_ERROR = "vite:preloadError";

/** Where the tab's session keeps the build it last reloaded away from. */
const RELOADED_FROM_KEY = "luke.staleBuild.reloadedFrom";

/** What the toast says where the tab holds work a reload would lose. */
const NEW_VERSION_READY = "A new version of Luke is ready";

/** The entry script a page names, whose hashed address names the build it is from. */
const ENTRY_SCRIPT = /<script\b(?=[^>]*\btype=["']module["'])[^>]*\bsrc=["']([^"']+)["']/iu;

/** The tab's session storage as far as the reload is kept there. */
type SessionKeep = Pick<Storage, "getItem" | "setItem">;

/** What the reload needs of the tab, which a test stands in for. */
export interface StaleBuildTab {
  /** The entry script this tab was loaded with, or none where its page names none. */
  readonly build: string | undefined;
  /** The address of the panel's page as the origin serves it now. */
  readonly livePage: string;
  /** The tab's session storage, or none where the browser keeps none. */
  readonly session: SessionKeep | undefined;
  /** The tab's way out, and whether it holds work a reload would lose. */
  readonly leave: Pick<PageLeave, "leave" | "holdsWork">;
  /** Whether a field is being typed in, whose words no draft keeps. */
  readonly typing: () => boolean;
  /** The tab's reload. */
  readonly reload: () => void;
  /** Asks before reloading, with what Reload does. */
  readonly askReload: (reload: () => void) => void;
}

/** The entry script a page's markup names, or none. */
function entryScriptOf(html: string): string | undefined {
  return ENTRY_SCRIPT.exec(html)?.[1];
}

/** The build the tab last reloaded away from this session, or none where it has not or storage refuses the read. */
function reloadedFrom(session: SessionKeep | undefined): string | null {
  try {
    return session?.getItem(RELOADED_FROM_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Keeps the build the tab reloads away from, answering whether it was kept. */
function keepReloadedFrom(session: SessionKeep | undefined, build: string): boolean {
  if (session === undefined) return false;
  try {
    session.setItem(RELOADED_FROM_KEY, build);
    return true;
  } catch {
    return false;
  }
}

/** The entry script the panel's page names as the origin serves it now, past the browser's cache, or none where it could not be read. */
function liveBuild(
  livePage: string,
): Effect.Effect<Option.Option<string>, never, HttpClient.HttpClient> {
  return HttpClient.get(livePage).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) => response.text),
    Effect.map((html) => Option.fromNullishOr(entryScriptOf(html))),
    Effect.provideService(FetchHttpClient.RequestInit, { cache: "no-store" }),
    Effect.orElseSucceed(() => Option.none()),
  );
}

/** Reloads the tab away from its build, once a session: where that cannot be kept, it never reloads, so it cannot loop. */
function reloadOnce(tab: StaleBuildTab, build: string): void {
  if (keepReloadedFrom(tab.session, build)) tab.reload();
}

/**
 * What one chunk that failed to load does: nothing unless the build has
 * moved on and the tab has not left this one already, then a reload, asked
 * about first while work stands. The window's root answers each failure the
 * preload helper says in turn (`web-host.ts`), so a burst of them, a chunk
 * and its stylesheet, reads the live page for the first and finds the
 * reload kept for the rest.
 */
export function answerFailedChunk(
  tab: StaleBuildTab,
): Effect.Effect<void, never, HttpClient.HttpClient> {
  const build = tab.build;
  if (build === undefined || reloadedFrom(tab.session) === build) return Effect.void;
  return Effect.map(liveBuild(tab.livePage), (live) => {
    if (Option.isNone(live) || live.value === build) return;
    if (!tab.leave.holdsWork() && !tab.typing()) {
      reloadOnce(tab, build);
      return;
    }
    tab.askReload(() => tab.leave.leave(() => reloadOnce(tab, build)));
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
    build: document.querySelector('script[type="module"][src]')?.getAttribute("src") ?? undefined,
    livePage: new URL(PANEL_PATH, location.origin).href,
    session: tabSession(),
    leave,
    typing: typingInField,
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
