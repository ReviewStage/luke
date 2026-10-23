/**
 * relay.ts -- one live view of one Browser tab: the agent's browser's frames of the tab out to a member's panel, and, while that member holds the takeover, their mouse and keys back into it.
 *
 * The tab was read under the member's reach before the socket stood
 * (`service.ts`); the relay reaches the browser of the agent whose
 * conversation holds it through `AgentBrowser`, which resumes a stopped
 * sandbox and starts the browser where it is not running, and which in
 * production reopens the agent's kept tabs where it started afresh
 * (`connectRestoring`), so the tab is read again for the target it now
 * stands on; then it attaches to that target and runs the page's screencast. Each frame goes to the
 * panel as it came, the page's size beside it, and is acknowledged no
 * sooner than `FRAME_EVERY` after the last, so Chromium sends no faster
 * than that; a frame the panel's socket has not drained the last of is
 * skipped rather than queued. The tab's address, title, and loading state
 * go as they change. None of it is read, kept, logged, traced, or counted
 * here: it reaches the panel alone (root `AGENTS.md`'s cloud browser line).
 *
 * Takeover goes over this same socket, on the tabs contract's store and
 * terms (`agent-browser-tabs-procedures.ts`): a member who controls the
 * agent takes the tab for `BROWSER_TAKEOVER_HOLD_MS`, and their input moves
 * the takeover on, written at most every `RENEW_EVERY`, so the takeover
 * always stands well past their last input. A takeover is the member's
 * rather than a socket's, so any of their sockets drives while it stands,
 * one that reconnected or another window among them, and its first input
 * moves it on in the store before it reaches the page. Input from a member
 * whose takeover does not stand is refused and goes nowhere. A step from the
 * tab's bar, an address opened or a step back, forward, or a reload, takes a
 * tab nobody drives over for the member first, as Take over would, and is
 * refused where another member holds it. Each move of the tab's page the
 * view sees is kept on the tab's row too (`notePage`), on the target it
 * watches alone, so a browser that starts afresh reopens the page the member
 * moved it to rather than where the agent last left it. Every point is in
 * the panel's own pixels at the viewport it last sent, and is mapped onto
 * the page's CSS pixels. Mouse moves that queue behind a slower browser are
 * folded into the last of each run, so the pointer never lags behind the
 * member's hand. The tab is read again every `TAB_CHECK_EVERY`, so a
 * driver change another window made reaches this one, and a tab that closed
 * or that the member no longer reaches closes the socket; as the socket
 * closes, however it closes, a takeover it took or moved on is handed back, unless
 * another window of the same member moved it on since, and a hand-back the
 * store did not take is tried again. Input still queued when a takeover
 * ends goes nowhere, a renewal the store could not answer keeps input going
 * only until the last write lapses, and the tab's screencast is stopped as
 * the view ends.
 *
 * A coding agent's sandbox stops at its turn's end, so while its tab is
 * watched the socket holds the sandbox through the lease every terminal of
 * it shares (`sandbox-terminal-lease.ts`), on the terminal's terms: the
 * connection holds it, and each message the panel sends moves it on,
 * written at most once a minute. The socket closes as idle once the panel
 * has sent nothing for the idle bound, and the sweep stops the sandbox
 * once the lease lapses. While the browser is reached, the connection also
 * keeps the sandbox alive past its short timeout every keep-alive interval
 * (`CODER.SANDBOX_KEEP_ALIVE_EVERY`, `agents/sandbox-keep-alive.ts`), so a
 * member watching after the agent's turn ended is never cut off by it.
 */

import type { ReachedBrowserTab } from "@luke/database/models/agent-browser-tabs";
import { browserTabDriver } from "@luke/database/models/agent-browser-tabs";
import { BROWSER_SHOWN_MAX_CHARS, isBrowserAddress } from "@luke/features/browser-acts";
import type { CdpCommand, CdpEvent, CdpFailure, CdpSession } from "@luke/features/browser-cdp";
import {
  BROWSER_LIVE_CLIENT,
  BROWSER_LIVE_CLOSE_CODE,
  BROWSER_LIVE_CLOSE_REASON,
  BROWSER_LIVE_HISTORY,
  BROWSER_LIVE_KEY_ACTION,
  BROWSER_LIVE_MODIFIER,
  BROWSER_LIVE_MOUSE_ACTION,
  BROWSER_LIVE_REFUSAL,
  BROWSER_LIVE_SERVER,
  type BrowserLiveClientMessage,
  type BrowserLiveCloseReason,
  type BrowserLiveServerMessage,
  browserLiveClientMessageSchema,
} from "@luke/features/browser-live-wire";
import { readEither } from "@luke/wire/effect";
import {
  type Cause,
  Clock,
  DateTime,
  Deferred,
  Duration,
  Effect,
  Option,
  Queue,
  Ref,
  Result,
  Schedule,
  Schema,
  type Scope,
  Stream,
} from "effect";
import { BROWSER_TAKEOVER_HOLD_MS } from "../agents/agent-browser-tabs-procedures.js";
import { controlsAgent } from "../agents/agent-reach.js";
import { BROWSER_UNREACHABLE, type BrowserUnreachable } from "../agents/browser/agent-browser.js";
import { CODER } from "../agents/coder-host/bounds.js";
import { EXCESS_KEYS, type UnparsedWireValue, unparsedWire } from "../core.js";
import type { RelaySocket } from "../terminal/relay.js";
import { BROWSER_LIVE_BOUNDS } from "./bounds.js";

/** The panel's socket: a relay side, and how many bytes it has yet to send, which paces the frames. */
export interface BrowserLiveViewer extends RelaySocket {
  readonly buffered: Effect.Effect<number>;
}

/** What a socket asks for: whose it is, and the task and tab it names. */
export interface BrowserLiveAsk {
  readonly userId: string;
  readonly taskId: string;
  readonly tabId: string;
}

/** What the relay stands on: the deployment's in production, a script's in a test. */
export interface BrowserLiveDependencies {
  /** The tab, where the member reaches it; none otherwise, and a failure where the store could not say. */
  readonly readTab: (
    userId: string,
    taskId: string,
    tabId: string,
  ) => Effect.Effect<Option.Option<ReachedBrowserTab>, unknown>;
  /** The eve session the agent's sandbox is tagged with; none before the agent first ran. */
  readonly sessionOf: (conversationId: string) => Effect.Effect<Option.Option<string>, unknown>;
  /**
   * Connects to the browser in the sandbox the session names, for the
   * caller's scope; in production through `connectRestoring`, which first
   * reopens the conversation's kept tabs where the browser started afresh.
   */
  readonly browser: {
    readonly connect: (
      sessionId: string,
      conversationId: string,
    ) => Effect.Effect<CdpSession, BrowserUnreachable, Scope.Scope>;
  };
  /** Makes the member the tab's driver until the instant given, answering whether they now drive it. */
  readonly takeOver: (
    tabId: string,
    userId: string,
    heldUntil: Date,
    now: Date,
  ) => Effect.Effect<boolean, unknown>;
  /** Moves the member's own standing takeover on, answering whether it stood. */
  readonly renew: (
    tabId: string,
    userId: string,
    heldUntil: Date,
    now: Date,
  ) => Effect.Effect<boolean, unknown>;
  readonly handBack: (tabId: string, userId: string) => Effect.Effect<boolean, unknown>;
  /** Keeps the tab's page as the view saw it move, on the target named alone, so a browser that starts afresh reopens it there; a write the store did not take is logged, for the next move to try again. */
  readonly notePage: (
    tabId: string,
    targetId: string,
    page: { readonly address: string; readonly title: string },
  ) => Effect.Effect<void>;
  readonly hold: (conversationId: string, heldUntil: Date) => Effect.Effect<void>;
  /** Keeps the running sandbox the eve session is tagged with alive the timeout from now; a keep-alive that fails is logged, for the next to try again. */
  readonly keepAlive: (sessionId: string) => Effect.Effect<void>;
}

/** The panel left: it is sent no close. */
const VIEWER_LEFT = "viewer-left";

type LiveEnd = BrowserLiveCloseReason | typeof VIEWER_LEFT;

/** The tab's target, attached: the CDP session and the target session its commands go to. */
interface LiveTarget {
  readonly cdp: CdpSession;
  readonly sessionId: string;
}

/** One input command, and whether it is a bare move, which a later move replaces; or a step through the page's history, which reads the history first. */
type QueuedInput =
  | { readonly command: CdpCommand; readonly move: boolean }
  | { readonly step: -1 | 1; readonly move: false };

const MOUSE_EVENT = {
  [BROWSER_LIVE_MOUSE_ACTION.MOVE]: "mouseMoved",
  [BROWSER_LIVE_MOUSE_ACTION.DOWN]: "mousePressed",
  [BROWSER_LIVE_MOUSE_ACTION.UP]: "mouseReleased",
} as const;

const CDP_METHOD = {
  SCREENCAST_FRAME: "Page.screencastFrame",
  TARGET_INFO_CHANGED: "Target.targetInfoChanged",
  TARGET_DESTROYED: "Target.targetDestroyed",
  DETACHED: "Target.detachedFromTarget",
  STARTED_LOADING: "Page.frameStartedLoading",
  STOPPED_LOADING: "Page.frameStoppedLoading",
  MOUSE: "Input.dispatchMouseEvent",
  KEY: "Input.dispatchKeyEvent",
  INSERT_TEXT: "Input.insertText",
  NAVIGATE: "Page.navigate",
  RELOAD: "Page.reload",
  HISTORY: "Page.getNavigationHistory",
  HISTORY_ENTRY: "Page.navigateToHistoryEntry",
} as const;

const read = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) =>
  readEither(schema, { excess: EXCESS_KEYS.DROP });

const readFrame = read(
  Schema.Struct({
    data: Schema.String,
    sessionId: Schema.Number,
    metadata: Schema.Struct({ deviceWidth: Schema.Number, deviceHeight: Schema.Number }),
  }),
);
const readTargetInfo = read(
  Schema.Struct({
    targetInfo: Schema.Struct({
      targetId: Schema.String,
      url: Schema.String,
      title: Schema.String,
    }),
  }),
);
const readTargetId = read(Schema.Struct({ targetId: Schema.String }));
const readFrameId = read(Schema.Struct({ frameId: Schema.String }));
const readSessionId = read(Schema.Struct({ sessionId: Schema.String }));
const readHistory = read(
  Schema.Struct({
    currentIndex: Schema.Number,
    entries: Schema.Array(Schema.Struct({ id: Schema.Number })),
  }),
);
const readClientMessage = readEither(browserLiveClientMessageSchema);

/** A text frame's JSON, or nothing a reader takes where it is none. */
function jsonOf(text: string): UnparsedWireValue {
  const parsed = Result.try(() => JSON.parse(text));
  return unparsedWire(Result.isSuccess(parsed) ? parsed.success : undefined);
}

/** The instant the lease reaches to from a write at the instant given: the idle bound, and the minute until the next write. */
function heldFrom(instant: Date): Date {
  const reach = Duration.sum(BROWSER_LIVE_BOUNDS.IDLE, BROWSER_LIVE_BOUNDS.LEASE_WRITE_EVERY);
  return new Date(instant.getTime() + Duration.toMillis(reach));
}

const shown = (text: string) => text.slice(0, BROWSER_SHOWN_MAX_CHARS);

function sendMessage(viewer: RelaySocket, message: BrowserLiveServerMessage): Effect.Effect<void> {
  return viewer.send({ text: JSON.stringify(message) });
}

/** Each run of bare moves folded into its last, every other input kept in order. */
function foldMoves(batch: readonly QueuedInput[]): readonly QueuedInput[] {
  return batch.filter((input, at) => !(input.move && batch[at + 1]?.move === true));
}

/** The text a key down types, where it types one: a printable key with no Control or Meta held, and Enter. */
function typedText(key: string, modifiers: number): string | undefined {
  if (key === "Enter") return "\r";
  if ((modifiers & (BROWSER_LIVE_MODIFIER.CONTROL | BROWSER_LIVE_MODIFIER.META)) !== 0)
    return undefined;
  return [...key].length === 1 ? key : undefined;
}

/** A message that acts in the page, which only the member holding the takeover may send. */
type InputMessage = Exclude<
  BrowserLiveClientMessage,
  {
    readonly type:
      | typeof BROWSER_LIVE_CLIENT.TAKE_OVER
      | typeof BROWSER_LIVE_CLIENT.HAND_BACK
      | typeof BROWSER_LIVE_CLIENT.VIEWPORT
      | typeof BROWSER_LIVE_CLIENT.NAVIGATE
      | typeof BROWSER_LIVE_CLIENT.HISTORY;
  }
>;

/** A step from the tab's bar: an address opened, or a step through its history. */
type SteerMessage = Extract<
  BrowserLiveClientMessage,
  { readonly type: typeof BROWSER_LIVE_CLIENT.NAVIGATE | typeof BROWSER_LIVE_CLIENT.HISTORY }
>;

/** What a step from the bar queues for the tab. */
function steeringOf(message: SteerMessage): QueuedInput {
  if (message.type === BROWSER_LIVE_CLIENT.NAVIGATE) {
    return {
      command: { method: CDP_METHOD.NAVIGATE, params: { url: message.address } },
      move: false,
    };
  }
  if (message.step === BROWSER_LIVE_HISTORY.RELOAD) {
    return { command: { method: CDP_METHOD.RELOAD }, move: false };
  }
  return { step: message.step === BROWSER_LIVE_HISTORY.BACK ? -1 : 1, move: false };
}

/** The DevTools command an input message is, its point mapped from the panel's viewport onto the page; none where either size is not known yet. */
function commandOf(
  message: InputMessage,
  viewport: { readonly width: number; readonly height: number } | undefined,
  page: { readonly width: number; readonly height: number } | undefined,
): QueuedInput | undefined {
  if (message.type === BROWSER_LIVE_CLIENT.TEXT) {
    return {
      command: { method: CDP_METHOD.INSERT_TEXT, params: { text: message.text } },
      move: false,
    };
  }
  if (message.type === BROWSER_LIVE_CLIENT.KEY) {
    const down = message.action === BROWSER_LIVE_KEY_ACTION.DOWN;
    const text = down ? typedText(message.key, message.modifiers) : undefined;
    const type = down ? (text === undefined ? "rawKeyDown" : "keyDown") : "keyUp";
    const params = {
      type,
      key: message.key,
      code: message.code,
      modifiers: message.modifiers,
      windowsVirtualKeyCode: message.keyCode,
      nativeVirtualKeyCode: message.keyCode,
      ...(text === undefined ? {} : { text, unmodifiedText: text }),
    };
    return { command: { method: CDP_METHOD.KEY, params }, move: false };
  }
  if (viewport === undefined || page === undefined) return undefined;
  const x = (Math.min(message.x, viewport.width) * page.width) / viewport.width;
  const y = (Math.min(message.y, viewport.height) * page.height) / viewport.height;
  if (message.type === BROWSER_LIVE_CLIENT.WHEEL) {
    const params = {
      type: "mouseWheel",
      x,
      y,
      deltaX: message.deltaX,
      deltaY: message.deltaY,
      modifiers: message.modifiers,
    };
    return { command: { method: CDP_METHOD.MOUSE, params }, move: false };
  }
  const params = {
    type: MOUSE_EVENT[message.action],
    x,
    y,
    button: message.button,
    buttons: message.buttons,
    clickCount: message.clickCount,
    modifiers: message.modifiers,
  };
  const move = message.action === BROWSER_LIVE_MOUSE_ACTION.MOVE && message.buttons === 0;
  return { command: { method: CDP_METHOD.MOUSE, params }, move };
}

/** Ends once the panel has sent nothing for the idle bound. */
function idleWatch(lastActive: Ref.Ref<number>): Effect.Effect<LiveEnd> {
  const activeLately = Effect.gen(function* () {
    const since = (yield* Clock.currentTimeMillis) - (yield* Ref.get(lastActive));
    return since < Duration.toMillis(BROWSER_LIVE_BOUNDS.IDLE);
  });
  return Effect.as(
    Effect.repeat(activeLately, {
      schedule: Schedule.spaced(BROWSER_LIVE_BOUNDS.IDLE_CHECK_EVERY),
      while: (active) => active,
    }),
    BROWSER_LIVE_CLOSE_REASON.IDLE,
  );
}

/** One live view's standing: what it was opened for, and what it has learned since. */
interface LiveView {
  readonly viewer: BrowserLiveViewer;
  readonly ask: BrowserLiveAsk;
  readonly reached: ReachedBrowserTab;
  readonly deps: BrowserLiveDependencies;
  /** Whether the member may drive the tab: one who controls the coding agent whose browser holds it. */
  readonly drivable: boolean;
  /** The instant this socket last took or moved on the member's takeover; none while it has written none that stands. */
  readonly driving: Ref.Ref<number | undefined>;
  /** Whether a hand-back the member asked for has yet to reach the store, which the close tries again. */
  readonly releasePending: Ref.Ref<boolean>;
  /** The driver last sent to the panel; none before the first. */
  readonly lastDriver: Ref.Ref<
    { readonly userId: string; readonly heldUntil: number } | null | undefined
  >;
  /** The size the panel draws the frames at, and the page's own, which every point is mapped between. */
  readonly viewport: Ref.Ref<PixelSize | undefined>;
  readonly page: Ref.Ref<PixelSize | undefined>;
  readonly pageState: Ref.Ref<PageState>;
  readonly live: Ref.Ref<LiveTarget | undefined>;
  /** The browser's target for the tab, read again once the browser is reached, since a fresh start reopens the tab on a new one. */
  readonly targetId: Ref.Ref<string>;
  readonly lastActive: Ref.Ref<number>;
  readonly lastHeld: Ref.Ref<number>;
  readonly lastFrame: Ref.Ref<number | undefined>;
  readonly inputs: Queue.Queue<QueuedInput, Cause.Done>;
  /** How the browser's side ended, where an event ended it. */
  readonly browserEnded: Deferred.Deferred<LiveEnd>;
}

interface PixelSize {
  readonly width: number;
  readonly height: number;
}

interface PageState {
  readonly address: string;
  readonly title: string;
  readonly loading: boolean;
}

function openView(
  viewer: BrowserLiveViewer,
  ask: BrowserLiveAsk,
  reached: ReachedBrowserTab,
  deps: BrowserLiveDependencies,
  startedAt: Date,
): Effect.Effect<LiveView> {
  return Effect.gen(function* () {
    const { tab, agent } = reached;
    return {
      viewer,
      ask,
      reached,
      deps,
      drivable: controlsAgent(ask.userId, agent),
      driving: yield* Ref.make<number | undefined>(undefined),
      releasePending: yield* Ref.make(false),
      lastDriver: yield* Ref.make<
        { readonly userId: string; readonly heldUntil: number } | null | undefined
      >(undefined),
      viewport: yield* Ref.make<PixelSize | undefined>(undefined),
      page: yield* Ref.make<PixelSize | undefined>(undefined),
      pageState: yield* Ref.make<PageState>({
        address: shown(tab.address),
        title: shown(tab.title),
        loading: false,
      }),
      live: yield* Ref.make<LiveTarget | undefined>(undefined),
      targetId: yield* Ref.make(tab.targetId),
      lastActive: yield* Ref.make(startedAt.getTime()),
      lastHeld: yield* Ref.make(startedAt.getTime()),
      lastFrame: yield* Ref.make<number | undefined>(undefined),
      inputs: yield* Queue.make<QueuedInput, Cause.Done>(),
      browserEnded: yield* Deferred.make<LiveEnd>(),
    };
  });
}

const send = (view: LiveView, message: BrowserLiveServerMessage) =>
  sendMessage(view.viewer, message);

/** Whether the driver given is this socket's member, who may drive the tab: what the panel is told as `yours`, and what lets a socket drive a takeover it did not write. */
function isYours(view: LiveView, driver: { readonly userId: string } | null | undefined): boolean {
  return view.drivable && driver?.userId === view.ask.userId;
}

/** The driver as the tab now stands, sent where it changed; a takeover that is no longer this member's is no longer this socket's. */
function publishDriver(view: LiveView, row: ReachedBrowserTab): Effect.Effect<void> {
  return Effect.gen(function* () {
    const found = browserTabDriver(row.tab, yield* DateTime.nowAsDate);
    const driver =
      found === null ? null : { userId: found.userId, heldUntil: found.heldUntil.getTime() };
    if (driver?.userId !== view.ask.userId) yield* Ref.set(view.driving, undefined);
    const last = yield* Ref.get(view.lastDriver);
    const same =
      last !== undefined &&
      last?.userId === driver?.userId &&
      last?.heldUntil === driver?.heldUntil;
    if (same) return;
    yield* Ref.set(view.lastDriver, driver);
    yield* send(view, {
      type: BROWSER_LIVE_SERVER.DRIVER,
      driver,
      yours: isYours(view, driver),
    });
  });
}

/** The tab read again under the member's reach: its driver published, and whether it still stands; a store that could not say counts as standing. */
function checkTab(view: LiveView): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const { ask, deps } = view;
    const found = yield* Effect.result(deps.readTab(ask.userId, ask.taskId, ask.tabId));
    if (Result.isFailure(found)) return true;
    if (Option.isNone(found.success)) return false;
    yield* publishDriver(view, found.success.value);
    return true;
  });
}

/** Ends as gone once the tab no longer stands for the member, read every `TAB_CHECK_EVERY`. */
function watchTab(view: LiveView): Effect.Effect<LiveEnd> {
  return Effect.as(
    Effect.repeat(checkTab(view), {
      schedule: Schedule.spaced(BROWSER_LIVE_BOUNDS.TAB_CHECK_EVERY),
      while: (standing) => standing,
    }),
    BROWSER_LIVE_CLOSE_REASON.GONE,
  );
}

/** The panel's message noted as someone watching, moving a coding agent's lease on at most once a minute. */
function noteActive(view: LiveView, at: Date): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* Ref.set(view.lastActive, at.getTime());
    const since = at.getTime() - (yield* Ref.get(view.lastHeld));
    if (since < Duration.toMillis(BROWSER_LIVE_BOUNDS.LEASE_WRITE_EVERY)) return;
    yield* Ref.set(view.lastHeld, at.getTime());
    yield* view.deps.hold(view.reached.tab.conversationId, heldFrom(at));
  });
}

/** The member takes the tab over for the hold, where they control its agent; a tab another member drives answers them as its driver. */
function takeOver(view: LiveView, at: Date): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (!view.drivable) {
      return yield* send(view, {
        type: BROWSER_LIVE_SERVER.REFUSED,
        reason: BROWSER_LIVE_REFUSAL.NOT_PERMITTED,
      });
    }
    const heldUntil = new Date(at.getTime() + BROWSER_TAKEOVER_HOLD_MS);
    const taken = yield* Effect.result(
      view.deps.takeOver(view.reached.tab.id, view.ask.userId, heldUntil, at),
    );
    yield* Ref.set(
      view.driving,
      Result.isSuccess(taken) && taken.success ? at.getTime() : undefined,
    );
    yield* checkTab(view);
  });
}

/** The instant a takeover written at the instant given lapses at. */
const lapsesAt = (writtenAt: number) => writtenAt + BROWSER_TAKEOVER_HOLD_MS;

/** Whether this socket's takeover stands at the instant given, by its last write alone. */
function standsAt(view: LiveView, at: number): Effect.Effect<boolean> {
  return Effect.map(
    Ref.get(view.driving),
    (writtenAt) => writtenAt !== undefined && at < lapsesAt(writtenAt),
  );
}

/** The member hands back the takeover this socket holds or stands on, one it reconnected to among them: input stops at once, and a hand-back the store did not take is tried again as the socket closes. */
function handBack(view: LiveView, at: Date): Effect.Effect<void> {
  return Effect.gen(function* () {
    const wrote = (yield* Ref.get(view.driving)) !== undefined;
    const pending = yield* Ref.get(view.releasePending);
    if (!wrote && !pending && !(yield* adoptable(view, at))) return;
    yield* Ref.set(view.driving, undefined);
    const released = yield* Effect.result(view.deps.handBack(view.reached.tab.id, view.ask.userId));
    yield* Ref.set(view.releasePending, Result.isFailure(released));
    yield* checkTab(view);
  });
}

/**
 * The close's release: a hand-back the member asked for that the store did
 * not take, tried again; and a takeover this socket still holds, handed
 * back unless another window of the same member moved it on past this
 * socket's own last write, since a takeover is the member's rather than a
 * socket's and that window still drives.
 */
function releaseOnClose(view: LiveView): Effect.Effect<void> {
  return Effect.gen(function* () {
    const { ask, deps, reached } = view;
    const writtenAt = yield* Ref.get(view.driving);
    if (writtenAt === undefined && !(yield* Ref.get(view.releasePending))) return;
    if (writtenAt !== undefined) {
      const found = yield* Effect.result(deps.readTab(ask.userId, ask.taskId, ask.tabId));
      const heldUntil = Result.isSuccess(found)
        ? Option.getOrUndefined(found.success)?.tab.heldUntil
        : undefined;
      if (heldUntil != null && heldUntil.getTime() > lapsesAt(writtenAt)) return;
    }
    yield* Effect.ignore(deps.handBack(reached.tab.id, ask.userId));
  });
}

/** Whether the member's takeover stood as the tab was last read, where this socket has no write of its own and no hand-back waits. */
function adoptable(view: LiveView, at: Date): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    if (yield* Ref.get(view.releasePending)) return false;
    const driver = yield* Ref.get(view.lastDriver);
    return driver != null && isYours(view, driver) && at.getTime() < driver.heldUntil;
  });
}

/**
 * Whether the member's takeover stands, moved on where this socket's last
 * write is `RENEW_EVERY` old. A socket with no write of its own, one that
 * reconnected or another window of the member, drives the takeover the tab
 * was last read with, once the store moves it on for this socket's first
 * input, so a hand-back or another member's take since is never driven past.
 */
function holding(view: LiveView, at: Date): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const renewedAt = yield* Ref.get(view.driving);
    if (renewedAt === undefined && !(yield* adoptable(view, at))) return false;
    const fresh = Duration.toMillis(BROWSER_LIVE_BOUNDS.RENEW_EVERY);
    if (renewedAt !== undefined && at.getTime() - renewedAt < fresh) return true;
    const heldUntil = new Date(at.getTime() + BROWSER_TAKEOVER_HOLD_MS);
    const renewed = yield* Effect.result(
      view.deps.renew(view.reached.tab.id, view.ask.userId, heldUntil, at),
    );
    // Note that a store that could not say leaves the takeover standing only until its last write lapses,
    // since no other member can take the row before then.
    if (Result.isFailure(renewed))
      return renewedAt !== undefined && at.getTime() < lapsesAt(renewedAt);
    if (renewed.success) {
      yield* Ref.set(view.driving, at.getTime());
      return true;
    }
    yield* Ref.set(view.driving, undefined);
    yield* checkTab(view);
    return false;
  });
}

/** An input queued for the tab where the member holds it, and refused where they do not. */
function drive(view: LiveView, message: InputMessage, at: Date): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (!(yield* holding(view, at))) {
      return yield* send(view, {
        type: BROWSER_LIVE_SERVER.REFUSED,
        reason: BROWSER_LIVE_REFUSAL.NOT_DRIVING,
      });
    }
    const input = commandOf(message, yield* Ref.get(view.viewport), yield* Ref.get(view.page));
    if (input !== undefined) yield* Queue.offer(view.inputs, input);
  });
}

/**
 * A step from the tab's bar, queued where the member holds the tab, and
 * taken over for them first where nobody else does; refused where they may
 * not drive the tab, or another member holds it.
 */
function steer(view: LiveView, message: SteerMessage, at: Date): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (!(yield* holding(view, at))) {
      // Note that a refused takeover says why itself, so nothing more is sent.
      if (!view.drivable) return yield* takeOver(view, at);
      yield* takeOver(view, at);
      if (!(yield* standsAt(view, at.getTime()))) {
        return yield* send(view, {
          type: BROWSER_LIVE_SERVER.REFUSED,
          reason: BROWSER_LIVE_REFUSAL.HELD,
        });
      }
    }
    yield* Queue.offer(view.inputs, steeringOf(message));
  });
}

function onMessage(view: LiveView, message: BrowserLiveClientMessage): Effect.Effect<void> {
  return Effect.gen(function* () {
    const at = yield* DateTime.nowAsDate;
    yield* noteActive(view, at);
    switch (message.type) {
      case BROWSER_LIVE_CLIENT.TAKE_OVER:
        return yield* takeOver(view, at);
      case BROWSER_LIVE_CLIENT.HAND_BACK:
        return yield* handBack(view, at);
      case BROWSER_LIVE_CLIENT.VIEWPORT:
        return yield* Ref.set(view.viewport, { width: message.width, height: message.height });
      case BROWSER_LIVE_CLIENT.NAVIGATE:
      case BROWSER_LIVE_CLIENT.HISTORY:
        return yield* steer(view, message, at);
      default:
        return yield* drive(view, message, at);
    }
  });
}

/** The panel's messages, each read as the wire has it and anything else passed over, until the panel goes. */
function readViewer(view: LiveView): Effect.Effect<LiveEnd> {
  return Effect.as(
    Stream.runForEach(view.viewer.frames, (frame) => {
      if (!("text" in frame)) return Effect.void;
      const message = readClientMessage(jsonOf(frame.text));
      return Result.isFailure(message) ? Effect.void : onMessage(view, message.success);
    }),
    VIEWER_LEFT,
  );
}

/**
 * The queued input sent to the tab in order, each run of bare moves folded
 * into its last; a command the browser refused goes nowhere. Each is sent
 * only while the takeover still stands, so input queued behind a slow
 * browser never lands after a hand-back or a lapse.
 */
function dispatchInput(view: LiveView, target: LiveTarget): Effect.Effect<void, Cause.Done> {
  return Effect.forever(
    Effect.gen(function* () {
      const batch = yield* Queue.takeAll(view.inputs);
      for (const input of foldMoves(batch)) {
        if (!(yield* standsAt(view, yield* Clock.currentTimeMillis))) return;
        if ("step" in input) yield* stepHistory(target, input.step);
        else
          yield* Effect.ignore(target.cdp.send({ ...input.command, sessionId: target.sessionId }));
      }
    }),
  );
}

/** Steps the tab's page back or forward by one, where its history holds a page there; a page with none there stays. */
function stepHistory(target: LiveTarget, by: -1 | 1): Effect.Effect<void> {
  const { cdp, sessionId } = target;
  return Effect.gen(function* () {
    const answer = yield* cdp.send({ method: CDP_METHOD.HISTORY, sessionId });
    const history = readHistory(answer);
    if (Result.isFailure(history)) return;
    const entry = history.success.entries[history.success.currentIndex + by];
    if (entry === undefined) return;
    yield* cdp.send({
      method: CDP_METHOD.HISTORY_ENTRY,
      params: { entryId: entry.id },
      sessionId,
    });
  }).pipe(Effect.ignore);
}

function publishPage(view: LiveView, next: PageState): Effect.Effect<void> {
  return Effect.gen(function* () {
    const last = yield* Ref.get(view.pageState);
    if (last.address === next.address && last.title === next.title && last.loading === next.loading)
      return;
    yield* Ref.set(view.pageState, next);
    yield* send(view, { type: BROWSER_LIVE_SERVER.PAGE, ...next });
  });
}

/** One frame to the panel, unless its socket is still sending the last ones, then acknowledged no sooner than `FRAME_EVERY` after the last. */
function relayFrame(
  view: LiveView,
  target: LiveTarget,
  params: UnparsedWireValue,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const frame = readFrame(params);
    if (Result.isFailure(frame)) return;
    const { data, sessionId: ackId, metadata } = frame.success;
    const size = {
      width: Math.max(0, metadata.deviceWidth),
      height: Math.max(0, metadata.deviceHeight),
    };
    yield* Ref.set(view.page, size);
    if ((yield* view.viewer.buffered) <= BROWSER_LIVE_BOUNDS.MAX_BUFFERED_BYTES) {
      yield* send(view, {
        type: BROWSER_LIVE_SERVER.FRAME,
        data,
        pageWidth: size.width,
        pageHeight: size.height,
      });
    }
    const last = yield* Ref.get(view.lastFrame);
    if (last !== undefined) {
      const wait =
        last +
        Duration.toMillis(BROWSER_LIVE_BOUNDS.FRAME_EVERY) -
        (yield* Clock.currentTimeMillis);
      if (wait > 0) yield* Effect.sleep(Duration.millis(wait));
    }
    yield* Ref.set(view.lastFrame, yield* Clock.currentTimeMillis);
    const ack = {
      method: "Page.screencastFrameAck",
      params: { sessionId: ackId },
      sessionId: target.sessionId,
    };
    yield* Effect.ignore(target.cdp.send(ack));
  });
}

/** One event of the agent's browser: the tab's frames, its page's changes, and its end; any other tab's are passed over. */
function onEvent(view: LiveView, event: CdpEvent): Effect.Effect<void> {
  return Effect.gen(function* () {
    const targetId = yield* Ref.get(view.targetId);
    const target = yield* Ref.get(view.live);
    const gone = Deferred.succeed(view.browserEnded, BROWSER_LIVE_CLOSE_REASON.GONE);
    switch (event.method) {
      case CDP_METHOD.SCREENCAST_FRAME:
        if (target !== undefined && event.sessionId === target.sessionId) {
          yield* relayFrame(view, target, event.params);
        }
        return;
      case CDP_METHOD.TARGET_INFO_CHANGED: {
        const info = readTargetInfo(event.params);
        if (Result.isFailure(info) || info.success.targetInfo.targetId !== targetId) return;
        const { url, title } = info.success.targetInfo;
        const last = yield* Ref.get(view.pageState);
        // Note that a page the member moved, from the bar or by driving it, is kept for a restart to
        // reopen; one no Browser tab loads, a blank or an error page, is not.
        if ((url !== last.address || title !== last.title) && isBrowserAddress(url)) {
          yield* view.deps.notePage(view.reached.tab.id, targetId, { address: url, title });
        }
        return yield* publishPage(view, { ...last, address: shown(url), title: shown(title) });
      }
      case CDP_METHOD.STARTED_LOADING:
      case CDP_METHOD.STOPPED_LOADING: {
        // A page's main frame has the id of its target.
        const frame = readFrameId(event.params);
        if (Result.isFailure(frame) || frame.success.frameId !== targetId) return;
        const last = yield* Ref.get(view.pageState);
        return yield* publishPage(view, {
          ...last,
          loading: event.method === CDP_METHOD.STARTED_LOADING,
        });
      }
      case CDP_METHOD.TARGET_DESTROYED: {
        const destroyed = readTargetId(event.params);
        if (Result.isSuccess(destroyed) && destroyed.success.targetId === targetId) yield* gone;
        return;
      }
      case CDP_METHOD.DETACHED: {
        const detached = readSessionId(event.params);
        if (Result.isSuccess(detached) && detached.success.sessionId === target?.sessionId)
          yield* gone;
        return;
      }
      default:
        return;
    }
  });
}

/** The tab's screencast stopped and its target let go, each tried once and briefly, since the connection's close ends both anyway. */
function endCast(target: LiveTarget): Effect.Effect<void> {
  const settle = (command: CdpCommand) =>
    Effect.ignore(Effect.timeout(target.cdp.send(command), BROWSER_LIVE_BOUNDS.CAST_END_TIMEOUT));
  return Effect.andThen(
    settle({ method: "Page.stopScreencast", sessionId: target.sessionId }),
    settle({ method: "Target.detachFromTarget", params: { sessionId: target.sessionId } }),
  );
}

/** The tab's target attached and its screencast started; none where the browser holds no such target. */
function castTab(
  view: LiveView,
  cdp: CdpSession,
): Effect.Effect<LiveTarget | undefined, CdpFailure, Scope.Scope> {
  return Effect.gen(function* () {
    const targetId = yield* Ref.get(view.targetId);
    const pages = yield* cdp.pages;
    const page = pages.find((candidate) => candidate.targetId === targetId);
    if (page === undefined) return undefined;
    yield* publishPage(view, {
      address: shown(page.url),
      title: shown(page.title),
      loading: false,
    });
    yield* cdp.send({ method: "Target.setDiscoverTargets", params: { discover: true } });
    const attach = { method: "Target.attachToTarget", params: { targetId, flatten: true } };
    const answer = readSessionId(yield* cdp.send(attach));
    if (Result.isFailure(answer)) return undefined;
    const target = { cdp, sessionId: answer.success.sessionId };
    // The cast ends with the view, ahead of the connection's own close, so no frame is made for nobody.
    yield* Effect.addFinalizer(() => endCast(target));
    yield* Ref.set(view.live, target);
    yield* cdp.send({ method: "Page.enable", sessionId: target.sessionId });
    const screencast = { ...BROWSER_LIVE_BOUNDS.SCREENCAST, everyNthFrame: 1 };
    yield* cdp.send({
      method: "Page.startScreencast",
      params: screencast,
      sessionId: target.sessionId,
    });
    return target;
  });
}

/** The agent's browser reached, the tab's target attached and cast, and how the browser's side ended. */
function watchBrowser(view: LiveView): Effect.Effect<LiveEnd, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { deps } = view;
    const session = yield* Effect.result(deps.sessionOf(view.reached.tab.conversationId));
    if (Result.isFailure(session)) return BROWSER_LIVE_CLOSE_REASON.UNAVAILABLE;
    if (Option.isNone(session.success)) return BROWSER_LIVE_CLOSE_REASON.NOT_OPENED;
    const connected = yield* Effect.result(
      deps.browser.connect(session.success.value, view.reached.tab.conversationId),
    );
    if (Result.isFailure(connected)) {
      return connected.failure.reason === BROWSER_UNREACHABLE.NOT_OPENED
        ? BROWSER_LIVE_CLOSE_REASON.NOT_OPENED
        : BROWSER_LIVE_CLOSE_REASON.UNAVAILABLE;
    }
    const cdp = connected.success;
    // The connect resumed the sandbox where it was stopped, so it is kept alive from here for as long as the view stands.
    yield* Effect.forkScoped(
      Effect.repeat(deps.keepAlive(session.success.value), {
        schedule: Schedule.spaced(CODER.SANDBOX_KEEP_ALIVE_EVERY),
      }),
    );
    // The tab is read again, since a browser that started afresh reopened it on a new target.
    const current = yield* Effect.result(
      deps.readTab(view.ask.userId, view.ask.taskId, view.ask.tabId),
    );
    // A store that could not say is unavailable, and a tab the member no longer reaches, or that closed, is gone.
    if (Result.isFailure(current)) return BROWSER_LIVE_CLOSE_REASON.UNAVAILABLE;
    if (Option.isNone(current.success)) return BROWSER_LIVE_CLOSE_REASON.GONE;
    yield* Ref.set(view.targetId, current.success.value.tab.targetId);
    // Note that the events are read from before the first command, so the screencast's first frame, after
    // which Chromium sends none until it is acknowledged, is never missed.
    yield* Effect.forkScoped(
      Effect.andThen(
        Stream.runForEach(cdp.events, (event) => onEvent(view, event)),
        Deferred.succeed(view.browserEnded, BROWSER_LIVE_CLOSE_REASON.UNAVAILABLE),
      ),
    );
    yield* Effect.yieldNow;
    const cast = yield* Effect.result(castTab(view, cdp));
    if (Result.isFailure(cast)) return BROWSER_LIVE_CLOSE_REASON.UNAVAILABLE;
    // The browser holds no such target: the tab closed, or a resume began the browser afresh.
    if (cast.success === undefined) return BROWSER_LIVE_CLOSE_REASON.GONE;
    yield* Effect.forkScoped(Effect.ignore(dispatchInput(view, cast.success)));
    return yield* Deferred.await(view.browserEnded);
  });
}

/** One live view, from its tab read to its close, everything it opens belonging to the scope it runs in. */
export function relayBrowserTab(
  viewer: BrowserLiveViewer,
  ask: BrowserLiveAsk,
  reached: ReachedBrowserTab,
  deps: BrowserLiveDependencies,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    const startedAt = yield* DateTime.nowAsDate;
    const view = yield* openView(viewer, ask, reached, deps, startedAt);
    // A takeover this socket took is handed back as it closes, however it closes.
    yield* Effect.addFinalizer(() => releaseOnClose(view));
    // A watched coding agent's sandbox is held from the start, so the resume a connection makes is held too.
    yield* deps.hold(reached.tab.conversationId, heldFrom(startedAt));
    const end = yield* Effect.raceAll([
      readViewer(view),
      watchBrowser(view),
      watchTab(view),
      idleWatch(view.lastActive),
    ]);
    yield* Queue.end(view.inputs);
    if (end === VIEWER_LEFT) return;
    yield* send(view, { type: BROWSER_LIVE_SERVER.CLOSED, reason: end });
    yield* viewer.close(BROWSER_LIVE_CLOSE_CODE[end]);
  });
}
