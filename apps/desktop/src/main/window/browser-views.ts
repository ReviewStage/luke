import {
  BROWSER_SHOWN_MAX_CHARS,
  BROWSER_STEP,
  type BrowserBounds,
  type BrowserFocus,
  type BrowserKey,
  type BrowserPage,
  type BrowserStep,
  chordIsWindows,
  isBrowserAddress,
} from "@luke/features/browser-acts";
import { BrowserWindow, type Session, session, type WebContents, WebContentsView } from "electron";

/**
 * browser-views.ts -- the web pages a panel's Browser tabs draw: one view per tab, owned here and laid over the panel where the tab's body stands.
 *
 * A Browser tab's page is any site on the web, the Mac's own `localhost`
 * among them, so it is drawn in a `WebContentsView` of its own rather than in
 * the panel's page: the panel's
 * hardened posture is left as it is, and the page runs sandboxed, isolated,
 * with no preload and no Node, in a partition of its own, so no cookie of a
 * site ever shares a jar with Luke's own. Every permission a page asks for
 * is refused, a download is cancelled, a new window opens in the tab's own
 * view, and a navigation to anything but an http or https address is
 * refused, so a page can hand an address to no other app.
 *
 * The view is a native layer over the panel, which DOM can never be drawn
 * over, so the tab places it over its body only while nothing covers that
 * body and puts it out of sight otherwise, drawing a still of it in its
 * place (`browser-pane.tsx`). The tab speaks in its own CSS pixels; the view
 * is placed in the window's, so they are scaled by the panel's zoom.
 *
 * How a page stands goes to the panel that opened it and nowhere else, and
 * nothing of it is kept, traced, or counted. A Command chord pressed while a
 * page holds the keyboard goes back to the panel too, so the window's own
 * chords answer over a page as over any tab, but for those a page edits its
 * text with. A panel's views go with its page: a reload or a close takes
 * them all.
 */

/** The partition every Browser tab's page shares, kept across launches so a sign-in to a site holds, and apart from Luke's own. */
const BROWSER_PARTITION = "persist:browser";

/** How well a still of a page is kept: enough to stand in for the page a moment, small enough to cross to the panel at once. */
const STILL_QUALITY = 80;

/** The load failure a navigation the tab or the page cut short reports, which is no failure. */
const ABORTED = -3;

/** One Browser tab's view, and the window it stands in. */
interface Held {
  readonly view: WebContentsView;
  readonly window: BrowserWindow;
  /** Whether the view stands among the window's children yet, which it does from its first placing. */
  attached: boolean;
  failure: string | undefined;
}

/** What a panel's Browser tabs ask of the views. Each answers false, or nothing, where the panel holds no view by that id. */
export interface BrowserViews {
  /** Opens a view on the address and answers how its page stands; a view already open is answered as it stands, its address left. */
  open(sender: WebContents, browserId: string, address: string): BrowserPage | undefined;
  navigate(sender: WebContents, browserId: string, address: string): boolean;
  step(sender: WebContents, browserId: string, step: BrowserStep): boolean;
  /** Lays the view over the window at the tab's bounds, in its CSS pixels, or puts it out of sight. */
  place(sender: WebContents, browserId: string, bounds: BrowserBounds | null): boolean;
  /** A still of the page as it is drawn now, as a data address; none where it draws nothing. */
  capture(sender: WebContents, browserId: string): Promise<string | null>;
  close(sender: WebContents, browserId: string): void;
}

/** How the views reach the panel that opened them. */
export interface BrowserViewsDependencies {
  /** Tells the panel how one of its pages stands now. */
  tellPage: (sender: WebContents, page: BrowserPage) => void;
  /** Hands the panel a chord pressed over one of its pages. */
  tellKey: (sender: WebContents, key: BrowserKey) => void;
  /** Tells the panel one of its pages took the keyboard. */
  tellFocus: (sender: WebContents, focus: BrowserFocus) => void;
  /** Calls `then` once, when the panel's page is gone (`whenPageGone`). */
  whenGone: (sender: WebContents, then: () => void) => void;
}

/** A shown string cut to what the panel is told, since it is only drawn. */
function shownText(text: string): string {
  return text.length > BROWSER_SHOWN_MAX_CHARS ? text.slice(0, BROWSER_SHOWN_MAX_CHARS) : text;
}

/** How a view's page stands, as the panel is told. */
function pageOf(browserId: string, held: Held): BrowserPage {
  const contents = held.view.webContents;
  const history = contents.navigationHistory;
  const page = {
    browserId,
    address: shownText(contents.getURL()),
    title: shownText(contents.getTitle()),
    loading: contents.isLoading(),
    back: history.canGoBack(),
    forward: history.canGoForward(),
  };
  return held.failure === undefined ? page : { ...page, failure: shownText(held.failure) };
}

/**
 * The Browser tabs' partition, its posture set the first time it is asked
 * for: every permission and device refused, and every download cancelled.
 */
let hardened: Session | undefined;
function browserSession(): Session {
  if (hardened !== undefined) return hardened;
  const partition = session.fromPartition(BROWSER_PARTITION);
  partition.setPermissionRequestHandler((_contents, _permission, answer) => answer(false));
  partition.setPermissionCheckHandler(() => false);
  partition.setDevicePermissionHandler(() => false);
  partition.on("will-download", (event) => event.preventDefault());
  hardened = partition;
  return partition;
}

/** A view of its own for one Browser tab: sandboxed, isolated, and in the Browser tabs' partition. */
function newView(): WebContentsView {
  return new WebContentsView({
    webPreferences: {
      session: browserSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      safeDialogs: true,
    },
  });
}

export function createBrowserViews(dependencies: BrowserViewsDependencies): BrowserViews {
  const { tellPage, tellKey, tellFocus, whenGone } = dependencies;
  /** Each panel's views, by the id its tab made. */
  const panels = new Map<WebContents, Map<string, Held>>();

  const heldOf = (sender: WebContents, browserId: string) => panels.get(sender)?.get(browserId);

  /** One view let go: out of its window, and its page closed. */
  const release = (held: Held) => {
    if (held.attached && !held.window.isDestroyed())
      held.window.contentView.removeChildView(held.view);
    if (!held.view.webContents.isDestroyed()) held.view.webContents.close();
  };

  /** The panel's views, its page's end watched the first time it opens one. */
  const viewsOf = (sender: WebContents) => {
    const standing = panels.get(sender);
    if (standing !== undefined) return standing;
    const fresh = new Map<string, Held>();
    panels.set(sender, fresh);
    whenGone(sender, () => {
      panels.delete(sender);
      for (const held of fresh.values()) release(held);
    });
    return fresh;
  };

  /** Keeps a view's page to the web, its new windows in itself, and the panel told of each move it makes. */
  const watch = (sender: WebContents, browserId: string, held: Held) => {
    const contents = held.view.webContents;
    const told = () => {
      if (!sender.isDestroyed() && !contents.isDestroyed())
        tellPage(sender, pageOf(browserId, held));
    };
    const refuseForeign = (event: Electron.Event, address: string) => {
      if (!isBrowserAddress(address)) event.preventDefault();
    };
    contents.setWindowOpenHandler(({ url }) => {
      if (isBrowserAddress(url)) void contents.loadURL(url).catch(() => undefined);
      return { action: "deny" };
    });
    contents.on("will-navigate", refuseForeign);
    contents.on("will-redirect", refuseForeign);
    contents.on("did-start-loading", () => {
      held.failure = undefined;
      told();
    });
    contents.on("did-stop-loading", told);
    contents.on("did-navigate", told);
    contents.on("did-navigate-in-page", told);
    contents.on("page-title-updated", told);
    contents.on("did-fail-load", (_event, code, description, _address, isMainFrame) => {
      if (!isMainFrame || code === ABORTED) return;
      held.failure = description;
      told();
    });
    contents.on("focus", () => {
      if (!sender.isDestroyed()) tellFocus(sender, { browserId });
    });
    contents.on("render-process-gone", () => {
      held.failure = "its process stopped";
      told();
    });
    // Note that the panel is handed the keyboard with the chord, because
    // what a chord opens, ⌘K's palette among them, takes its keys there.
    contents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || !input.meta) return;
      const chord = { key: input.key, shift: input.shift, alt: input.alt, control: input.control };
      if (!chordIsWindows(chord) || sender.isDestroyed()) return;
      event.preventDefault();
      sender.focus();
      tellKey(sender, { browserId, code: input.code, ...chord });
    });
  };

  return {
    open(sender, browserId, address) {
      const standing = heldOf(sender, browserId);
      if (standing !== undefined) return pageOf(browserId, standing);
      const window = BrowserWindow.fromWebContents(sender);
      if (window === null) return undefined;
      const held: Held = { view: newView(), window, attached: false, failure: undefined };
      viewsOf(sender).set(browserId, held);
      watch(sender, browserId, held);
      void held.view.webContents.loadURL(address).catch(() => undefined);
      return pageOf(browserId, held);
    },
    navigate(sender, browserId, address) {
      const held = heldOf(sender, browserId);
      if (held === undefined) return false;
      void held.view.webContents.loadURL(address).catch(() => undefined);
      return true;
    },
    step(sender, browserId, step) {
      const contents = heldOf(sender, browserId)?.view.webContents;
      if (contents === undefined) return false;
      if (step === BROWSER_STEP.BACK) contents.navigationHistory.goBack();
      else if (step === BROWSER_STEP.FORWARD) contents.navigationHistory.goForward();
      else if (step === BROWSER_STEP.RELOAD) contents.reload();
      else contents.stop();
      return true;
    },
    place(sender, browserId, bounds) {
      const held = heldOf(sender, browserId);
      if (held === undefined || held.window.isDestroyed()) return false;
      if (bounds === null) {
        held.view.setVisible(false);
        return true;
      }
      const zoom = sender.getZoomFactor();
      if (!held.attached) {
        held.window.contentView.addChildView(held.view);
        held.attached = true;
      }
      held.view.setBounds({
        x: Math.round(bounds.x * zoom),
        y: Math.round(bounds.y * zoom),
        width: Math.round(bounds.width * zoom),
        height: Math.round(bounds.height * zoom),
      });
      held.view.setVisible(true);
      return true;
    },
    async capture(sender, browserId) {
      const held = heldOf(sender, browserId);
      if (held === undefined || !held.attached) return null;
      const image = await held.view.webContents.capturePage();
      if (image.isEmpty()) return null;
      return `data:image/jpeg;base64,${image.toJPEG(STILL_QUALITY).toString("base64")}`;
    },
    close(sender, browserId) {
      const views = panels.get(sender);
      const held = views?.get(browserId);
      if (views === undefined || held === undefined) return;
      views.delete(browserId);
      release(held);
    },
  };
}
