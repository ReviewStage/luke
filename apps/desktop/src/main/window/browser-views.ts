import { randomUUID } from "node:crypto";
import {
  BROWSER_SHOWN_MAX_CHARS,
  BROWSER_STEP,
  type BrowserBounds,
  type BrowserFocus,
  type BrowserKey,
  type BrowserOpened,
  type BrowserPage,
  type BrowserStep,
  chordIsWindows,
  isBrowserAddress,
} from "@luke/features/browser-acts";
import {
  MAC_DEBUGGER_VERSION,
  type MacBrowserTab,
  type MacTabDebugger,
  type MacTaskTabs,
} from "@luke/host/mac-browser-tabs";
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
 *
 * Each view is kept with the task its tab was opened on, so an agent on
 * that task can reach every Browser tab on it (`agentTabs`), and open one,
 * which the panel is told of and draws as the "+" would, without taking the
 * keyboard. While an agent drives a page its debugger is attached, the page
 * keeps running as if shown, and the tab's bar says so (`BrowserPage`'s
 * `agent`); its Stop cuts the agent off and refuses every agent's action
 * on the page until the developer clicks into it again.
 */

/** The partition every Browser tab's page shares, kept across launches so a sign-in to a site holds, and apart from Luke's own. */
const BROWSER_PARTITION = "persist:browser";

/** How well a still of a page is kept: enough to stand in for the page a moment, small enough to cross to the panel at once. */
const STILL_QUALITY = 80;

/** The load failure a navigation the tab or the page cut short reports, which is no failure. */
const ABORTED = -3;

/**
 * The size a view an agent opened is laid out at until its tab first places
 * it, so its page has a viewport to draw, click, and capture in before the
 * developer ever sees it.
 */
const UNPLACED_SIZE = { width: 1280, height: 800 } as const;

/** One Browser tab's view, the window it stands in, and the task it is on. */
interface Held {
  readonly view: WebContentsView;
  readonly window: BrowserWindow;
  readonly taskId: string;
  /** Whether the view stands among the window's children yet, which it does from its first placing. */
  attached: boolean;
  failure: string | undefined;
  /** How many agents' commands hold the page's debugger now; it is attached while any does. */
  drivers: number;
  /** Counts each Stop, so a command cut off by one gives back nothing a later command took. */
  stops: number;
  /** Whether the bar's Stop keeps agents off the page, until the developer clicks into it. */
  stopped: boolean;
}

/** What a panel's Browser tabs ask of the views. Each answers false, or nothing, where the panel holds no view by that id. */
export interface BrowserViews {
  /** Opens a view on the address, on the task, and answers how its page stands; a view already open is answered as it stands, its address left. */
  open(
    sender: WebContents,
    browserId: string,
    address: string,
    taskId: string,
  ): BrowserPage | undefined;
  navigate(sender: WebContents, browserId: string, address: string): boolean;
  step(sender: WebContents, browserId: string, step: BrowserStep): boolean;
  /** Lays the view over the window at the tab's bounds, in its CSS pixels, or puts it out of sight. */
  place(sender: WebContents, browserId: string, bounds: BrowserBounds | null): boolean;
  /** A still of the page as it is drawn now, as a data address; none where it draws nothing. */
  capture(sender: WebContents, browserId: string): Promise<string | null>;
  close(sender: WebContents, browserId: string): void;
  /** The bar's Stop: the agent driving the page is cut off, and agents are kept off it until the developer clicks into it. */
  stop(sender: WebContents, browserId: string): boolean;
  /** The panel's Browser tabs on the task, as an agent on the task reaches them. */
  agentTabs(sender: WebContents, taskId: string): MacTaskTabs;
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
  /** Tells the panel an agent opened a Browser tab on a task, which it draws without taking the keyboard. */
  tellOpened: (sender: WebContents, opened: BrowserOpened) => void;
  /** Tells the panel an agent closed one of its Browser tabs. */
  tellClosed: (sender: WebContents, closed: { browserId: string }) => void;
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
  const driven = held.drivers > 0 ? { ...page, agent: true } : page;
  return held.failure === undefined ? driven : { ...driven, failure: shownText(held.failure) };
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

/** Lets go of a page's debugger, and lets the page rest again as its view does. */
function letGo(held: Held): void {
  const contents = held.view.webContents;
  if (contents.isDestroyed()) return;
  if (contents.debugger.isAttached()) contents.debugger.detach();
  contents.setBackgroundThrottling(true);
}

/**
 * One page's debugger as an agent's command holds it. The first command to
 * take it attaches it and keeps the page running as if shown; the last to
 * give it back detaches it. Note that a command a Stop cut off gives back
 * nothing, since the Stop let go of the debugger for every command at once.
 */
function debuggerOf(held: Held, told: () => void): MacTabDebugger {
  const contents = held.view.webContents;
  let takenAt: number | undefined;
  return {
    attach: () => {
      if (takenAt !== undefined) return;
      if (held.drivers === 0) {
        contents.debugger.attach(MAC_DEBUGGER_VERSION);
        contents.setBackgroundThrottling(false);
      }
      held.drivers += 1;
      takenAt = held.stops;
      told();
    },
    detach: () => {
      if (takenAt === undefined) return;
      const cutOff = takenAt !== held.stops;
      takenAt = undefined;
      if (cutOff) return;
      held.drivers -= 1;
      if (held.drivers === 0) letGo(held);
      told();
    },
    send: (method, params) => contents.debugger.sendCommand(method, params),
    onEvent: (listener) => {
      const heard = (
        _event: Electron.Event,
        method: string,
        params: unknown,
        sessionId: string,
      ) => {
        if (sessionId === "") listener(method, params);
      };
      contents.debugger.on("message", heard);
      return () => {
        contents.debugger.off("message", heard);
      };
    },
  };
}

/** A view's visible page as a JPEG in base64, caught even while out of sight, at the quality and scale asked. */
async function captureOf(held: Held, shot: { quality: number; scale: number }) {
  const contents = held.view.webContents;
  if (contents.isDestroyed()) return undefined;
  const image = await contents.capturePage(undefined, { stayHidden: true, stayAwake: true });
  if (image.isEmpty()) return undefined;
  const size = image.getSize();
  const scaled =
    shot.scale >= 1
      ? image
      : image.resize({
          width: Math.max(1, Math.round(size.width * shot.scale)),
          height: Math.max(1, Math.round(size.height * shot.scale)),
          quality: "best",
        });
  return scaled.toJPEG(Math.round(shot.quality)).toString("base64");
}

export function createBrowserViews(dependencies: BrowserViewsDependencies): BrowserViews {
  const { tellPage, tellKey, tellFocus, whenGone, tellOpened, tellClosed } = dependencies;
  /** Each panel's views, by the id its tab made. */
  const panels = new Map<WebContents, Map<string, Held>>();

  const heldOf = (sender: WebContents, browserId: string) => panels.get(sender)?.get(browserId);

  /** One view let go: out of its window, its debugger let go, and its page closed. */
  const release = (held: Held) => {
    letGo(held);
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
    // Note that a click into the page lifts the bar's Stop, as the developer taking it back.
    contents.on("focus", () => {
      if (held.stopped) {
        held.stopped = false;
        told();
      }
      if (!sender.isDestroyed()) tellFocus(sender, { browserId });
    });
    // Note that the debugger is let go of from outside too, as the page's developer tools open, and no agent then holds it.
    contents.debugger.on("detach", () => {
      if (held.drivers === 0) return;
      held.drivers = 0;
      held.stops += 1;
      contents.setBackgroundThrottling(true);
      told();
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

  /** A view opened on the address, on the task, for the panel; none where the panel stands in no window. */
  const opened = (sender: WebContents, browserId: string, address: string, taskId: string) => {
    const window = BrowserWindow.fromWebContents(sender);
    if (window === null) return undefined;
    const held: Held = {
      view: newView(),
      window,
      taskId,
      attached: false,
      failure: undefined,
      drivers: 0,
      stops: 0,
      stopped: false,
    };
    viewsOf(sender).set(browserId, held);
    watch(sender, browserId, held);
    void held.view.webContents.loadURL(address).catch(() => undefined);
    return held;
  };

  /** Tells the panel how a page stands now, as its own moves do. */
  const toldOf = (sender: WebContents, browserId: string, held: Held) => () => {
    if (!sender.isDestroyed() && !held.view.webContents.isDestroyed()) {
      tellPage(sender, pageOf(browserId, held));
    }
  };

  /** One of the panel's tabs as an agent reaches it. */
  const agentTab = (sender: WebContents, browserId: string, held: Held): MacBrowserTab => ({
    id: browserId,
    page: () => ({
      url: held.view.webContents.getURL(),
      title: held.view.webContents.getTitle(),
    }),
    capture: (shot) => captureOf(held, shot),
    stopped: () => held.stopped,
    debugger: debuggerOf(held, toldOf(sender, browserId, held)),
  });

  return {
    open(sender, browserId, address, taskId) {
      const standing = heldOf(sender, browserId);
      if (standing !== undefined) return pageOf(browserId, standing);
      const held = opened(sender, browserId, address, taskId);
      return held === undefined ? undefined : pageOf(browserId, held);
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
    stop(sender, browserId) {
      const held = heldOf(sender, browserId);
      if (held === undefined) return false;
      held.stopped = true;
      held.stops += 1;
      held.drivers = 0;
      letGo(held);
      toldOf(sender, browserId, held)();
      return true;
    },
    agentTabs(sender, taskId) {
      const onTask = () =>
        [...(panels.get(sender) ?? new Map<string, Held>()).entries()].filter(
          ([, held]) => held.taskId === taskId,
        );
      return {
        list: () => onTask().map(([browserId, held]) => agentTab(sender, browserId, held)),
        open: (url) => {
          const browserId = randomUUID();
          const held = opened(sender, browserId, url, taskId);
          if (held === undefined) return undefined;
          held.view.setBounds({ x: 0, y: 0, ...UNPLACED_SIZE });
          tellOpened(sender, { browserId, taskId, address: url });
          return agentTab(sender, browserId, held);
        },
        close: (browserId) => {
          const views = panels.get(sender);
          const held = views?.get(browserId);
          if (views === undefined || held === undefined || held.taskId !== taskId) return false;
          views.delete(browserId);
          release(held);
          tellClosed(sender, { browserId });
          return true;
        },
      };
    },
  };
}
