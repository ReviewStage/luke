import type { ReachedBrowserTab } from "@repo/database/models/agent-browser-tabs";
import { browserTabDriver } from "@repo/database/models/agent-browser-tabs";
import type { BrowserTabsPlace } from "@repo/features/agent-browser-tab-wire";
import { BROWSER_SHOWN_MAX_CHARS, isBrowserAddress } from "@repo/features/browser-acts";
import type { CdpCommand, CdpEvent, CdpFailure, CdpSession } from "@repo/features/browser-cdp";
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
} from "@repo/features/browser-live-wire";
import { readEither } from "@repo/wire/effect";
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
import { EXCESS_KEYS, type UnparsedWireValue } from "../core.js";
import type { ServerAgentTool } from "../events/server-events.js";
import { SERVER_AGENT_TOOL } from "../events/server-events.js";
import { jsonOf } from "../http/http-effect.js";
import type { RelaySocket } from "../terminal/relay.js";
import { BROWSER_LIVE_BOUNDS } from "./bounds.js";

export interface BrowserLiveViewer extends RelaySocket {
  readonly buffered: Effect.Effect<number>;
}

export interface BrowserLiveAsk {
  readonly userId: string;
  readonly place: BrowserTabsPlace;
  readonly tabId: string;
}

export interface BrowserLiveDependencies {
  readonly readTab: (
    userId: string,
    place: BrowserTabsPlace,
    tabId: string,
  ) => Effect.Effect<Option.Option<ReachedBrowserTab>, unknown>;
  readonly sessionOf: (conversationId: string) => Effect.Effect<Option.Option<string>, unknown>;
  readonly browser: {
    readonly connect: (
      sessionId: string,
      conversationId: string,
    ) => Effect.Effect<CdpSession, BrowserUnreachable, Scope.Scope>;
  };
  readonly takeOver: (
    tabId: string,
    userId: string,
    heldUntil: Date,
    now: Date,
  ) => Effect.Effect<boolean, unknown>;
  readonly renew: (
    tabId: string,
    userId: string,
    heldUntil: Date,
    now: Date,
  ) => Effect.Effect<boolean, unknown>;
  readonly handBack: (tabId: string, userId: string) => Effect.Effect<boolean, unknown>;
  readonly counted: (userId: string, agentId: string, tool: ServerAgentTool) => Effect.Effect<void>;
  readonly notePage: (
    tabId: string,
    targetId: string,
    page: { readonly address: string; readonly title: string },
  ) => Effect.Effect<void>;
  readonly hold: (conversationId: string, heldUntil: Date) => Effect.Effect<void>;
  readonly keepAlive: (sessionId: string) => Effect.Effect<void>;
}

const VIEWER_LEFT = "viewer-left";

type LiveEnd = BrowserLiveCloseReason | typeof VIEWER_LEFT;

interface LiveTarget {
  readonly cdp: CdpSession;
  readonly sessionId: string;
}

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

function heldFrom(instant: Date): Date {
  const reach = Duration.sum(BROWSER_LIVE_BOUNDS.IDLE, BROWSER_LIVE_BOUNDS.LEASE_WRITE_EVERY);
  return new Date(instant.getTime() + Duration.toMillis(reach));
}

const shown = (text: string) => text.slice(0, BROWSER_SHOWN_MAX_CHARS);

function sendMessage(viewer: RelaySocket, message: BrowserLiveServerMessage): Effect.Effect<void> {
  return viewer.send({ text: JSON.stringify(message) });
}

function foldMoves(batch: readonly QueuedInput[]): readonly QueuedInput[] {
  return batch.filter((input, at) => !(input.move && batch[at + 1]?.move === true));
}

function typedText(key: string, modifiers: number): string | undefined {
  if (key === "Enter") return "\r";
  if ((modifiers & (BROWSER_LIVE_MODIFIER.CONTROL | BROWSER_LIVE_MODIFIER.META)) !== 0)
    return undefined;
  return [...key].length === 1 ? key : undefined;
}

type InputMessage = Exclude<
  BrowserLiveClientMessage,
  {
    readonly type:
      | typeof BROWSER_LIVE_CLIENT.TAKE_OVER
      | typeof BROWSER_LIVE_CLIENT.HAND_BACK
      | typeof BROWSER_LIVE_CLIENT.VIEWPORT
      | typeof BROWSER_LIVE_CLIENT.NAVIGATE
      | typeof BROWSER_LIVE_CLIENT.HISTORY
      | typeof BROWSER_LIVE_CLIENT.WATCHING;
  }
>;

type SteerMessage = Extract<
  BrowserLiveClientMessage,
  { readonly type: typeof BROWSER_LIVE_CLIENT.NAVIGATE | typeof BROWSER_LIVE_CLIENT.HISTORY }
>;

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

function idleWatch(view: LiveView): Effect.Effect<LiveEnd> {
  const activeLately = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const watched = now - (yield* Ref.get(view.lastActive));
    const touched = now - (yield* Ref.get(view.lastInput));
    return (
      watched < Duration.toMillis(BROWSER_LIVE_BOUNDS.IDLE) &&
      touched < Duration.toMillis(BROWSER_LIVE_BOUNDS.INPUT_IDLE)
    );
  });
  return Effect.as(
    Effect.repeat(activeLately, {
      schedule: Schedule.spaced(BROWSER_LIVE_BOUNDS.IDLE_CHECK_EVERY),
      while: (active) => active,
    }),
    BROWSER_LIVE_CLOSE_REASON.IDLE,
  );
}

interface LiveView {
  readonly viewer: BrowserLiveViewer;
  readonly ask: BrowserLiveAsk;
  readonly reached: ReachedBrowserTab;
  readonly deps: BrowserLiveDependencies;
  readonly drivable: boolean;
  readonly driving: Ref.Ref<number | undefined>;
  readonly releasePending: Ref.Ref<boolean>;
  readonly lastDriver: Ref.Ref<
    { readonly userId: string; readonly heldUntil: number } | null | undefined
  >;
  readonly viewport: Ref.Ref<PixelSize | undefined>;
  readonly page: Ref.Ref<PixelSize | undefined>;
  readonly pageState: Ref.Ref<PageState>;
  readonly live: Ref.Ref<LiveTarget | undefined>;
  readonly targetId: Ref.Ref<string>;
  readonly lastActive: Ref.Ref<number>;
  readonly lastInput: Ref.Ref<number>;
  readonly lastHeld: Ref.Ref<number>;
  readonly lastFrame: Ref.Ref<number | undefined>;
  readonly inputs: Queue.Queue<QueuedInput, Cause.Done>;
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
      lastInput: yield* Ref.make(startedAt.getTime()),
      lastHeld: yield* Ref.make(startedAt.getTime()),
      lastFrame: yield* Ref.make<number | undefined>(undefined),
      inputs: yield* Queue.make<QueuedInput, Cause.Done>(),
      browserEnded: yield* Deferred.make<LiveEnd>(),
    };
  });
}

const send = (view: LiveView, message: BrowserLiveServerMessage) =>
  sendMessage(view.viewer, message);

function isYours(view: LiveView, driver: { readonly userId: string } | null | undefined): boolean {
  return view.drivable && driver?.userId === view.ask.userId;
}

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

function checkTab(view: LiveView): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const { ask, deps } = view;
    const found = yield* Effect.result(deps.readTab(ask.userId, ask.place, ask.tabId));
    if (Result.isFailure(found)) return true;
    if (Option.isNone(found.success)) return false;
    yield* publishDriver(view, found.success.value);
    return true;
  });
}

function watchTab(view: LiveView): Effect.Effect<LiveEnd> {
  return Effect.as(
    Effect.repeat(checkTab(view), {
      schedule: Schedule.spaced(BROWSER_LIVE_BOUNDS.TAB_CHECK_EVERY),
      while: (standing) => standing,
    }),
    BROWSER_LIVE_CLOSE_REASON.GONE,
  );
}

function noteActive(view: LiveView, at: Date): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* Ref.set(view.lastActive, at.getTime());
    const since = at.getTime() - (yield* Ref.get(view.lastHeld));
    if (since < Duration.toMillis(BROWSER_LIVE_BOUNDS.LEASE_WRITE_EVERY)) return;
    yield* Ref.set(view.lastHeld, at.getTime());
    yield* view.deps.hold(view.reached.tab.conversationId, heldFrom(at));
  });
}

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
    const standing = (yield* Ref.get(view.driving)) !== undefined || (yield* adoptable(view, at));
    const took = Result.isSuccess(taken) && taken.success;
    yield* Ref.set(view.driving, took ? at.getTime() : undefined);
    if (took && !standing) {
      yield* view.deps.counted(
        view.ask.userId,
        view.reached.agent.id,
        SERVER_AGENT_TOOL.BROWSER_TAKEOVER,
      );
    }
    yield* checkTab(view);
  });
}

const lapsesAt = (writtenAt: number) => writtenAt + BROWSER_TAKEOVER_HOLD_MS;

function standsAt(view: LiveView, at: number): Effect.Effect<boolean> {
  return Effect.map(
    Ref.get(view.driving),
    (writtenAt) => writtenAt !== undefined && at < lapsesAt(writtenAt),
  );
}

function handBack(view: LiveView, at: Date): Effect.Effect<void> {
  return Effect.gen(function* () {
    const wrote = (yield* Ref.get(view.driving)) !== undefined;
    const pending = yield* Ref.get(view.releasePending);
    if (!wrote && !pending && !(yield* adoptable(view, at))) return;
    yield* Ref.set(view.driving, undefined);
    const released = yield* Effect.result(view.deps.handBack(view.reached.tab.id, view.ask.userId));
    yield* Ref.set(view.releasePending, Result.isFailure(released));
    if (Result.isSuccess(released) && released.success) {
      yield* view.deps.counted(
        view.ask.userId,
        view.reached.agent.id,
        SERVER_AGENT_TOOL.BROWSER_HANDBACK,
      );
    }
    yield* checkTab(view);
  });
}

function releaseOnClose(view: LiveView): Effect.Effect<void> {
  return Effect.gen(function* () {
    const { ask, deps, reached } = view;
    const writtenAt = yield* Ref.get(view.driving);
    if (writtenAt === undefined && !(yield* Ref.get(view.releasePending))) return;
    if (writtenAt !== undefined) {
      const found = yield* Effect.result(deps.readTab(ask.userId, ask.place, ask.tabId));
      const heldUntil = Result.isSuccess(found)
        ? Option.getOrUndefined(found.success)?.tab.heldUntil
        : undefined;
      if (heldUntil != null && heldUntil.getTime() > lapsesAt(writtenAt)) return;
    }
    yield* Effect.ignore(deps.handBack(reached.tab.id, ask.userId));
  });
}

function adoptable(view: LiveView, at: Date): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    if (yield* Ref.get(view.releasePending)) return false;
    const driver = yield* Ref.get(view.lastDriver);
    return driver != null && isYours(view, driver) && at.getTime() < driver.heldUntil;
  });
}

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

function steer(view: LiveView, message: SteerMessage, at: Date): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (!(yield* holding(view, at))) {
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

function resizes(view: LiveView, size: PixelSize): Effect.Effect<boolean> {
  return Effect.map(
    Ref.get(view.viewport),
    (last) => last?.width !== size.width || last?.height !== size.height,
  );
}

function onMessage(view: LiveView, message: BrowserLiveClientMessage): Effect.Effect<void> {
  return Effect.gen(function* () {
    const at = yield* DateTime.nowAsDate;
    const watching =
      message.type !== BROWSER_LIVE_CLIENT.VIEWPORT || (yield* resizes(view, message));
    if (watching) yield* noteActive(view, at);
    if (watching && message.type !== BROWSER_LIVE_CLIENT.WATCHING)
      yield* Ref.set(view.lastInput, at.getTime());
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
      case BROWSER_LIVE_CLIENT.WATCHING:
        return;
      default:
        return yield* drive(view, message, at);
    }
  });
}

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
        if ((url !== last.address || title !== last.title) && isBrowserAddress(url)) {
          yield* view.deps.notePage(view.reached.tab.id, targetId, { address: url, title });
        }
        return yield* publishPage(view, { ...last, address: shown(url), title: shown(title) });
      }
      case CDP_METHOD.STARTED_LOADING:
      case CDP_METHOD.STOPPED_LOADING: {
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

function endCast(target: LiveTarget): Effect.Effect<void> {
  const settle = (command: CdpCommand) =>
    Effect.ignore(Effect.timeout(target.cdp.send(command), BROWSER_LIVE_BOUNDS.CAST_END_TIMEOUT));
  return Effect.andThen(
    settle({ method: "Page.stopScreencast", sessionId: target.sessionId }),
    settle({ method: "Target.detachFromTarget", params: { sessionId: target.sessionId } }),
  );
}

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
    yield* Effect.forkScoped(
      Effect.repeat(deps.keepAlive(session.success.value), {
        schedule: Schedule.spaced(CODER.SANDBOX_KEEP_ALIVE_EVERY),
      }),
    );
    const current = yield* Effect.result(
      deps.readTab(view.ask.userId, view.ask.place, view.ask.tabId),
    );
    if (Result.isFailure(current)) return BROWSER_LIVE_CLOSE_REASON.UNAVAILABLE;
    if (Option.isNone(current.success)) return BROWSER_LIVE_CLOSE_REASON.GONE;
    yield* Ref.set(view.targetId, current.success.value.tab.targetId);
    yield* Effect.forkScoped(
      Effect.andThen(
        Stream.runForEach(cdp.events, (event) => onEvent(view, event)),
        Deferred.succeed(view.browserEnded, BROWSER_LIVE_CLOSE_REASON.UNAVAILABLE),
      ),
    );
    yield* Effect.yieldNow;
    const cast = yield* Effect.result(castTab(view, cdp));
    if (Result.isFailure(cast)) return BROWSER_LIVE_CLOSE_REASON.UNAVAILABLE;
    if (cast.success === undefined) return BROWSER_LIVE_CLOSE_REASON.GONE;
    yield* Effect.forkScoped(Effect.ignore(dispatchInput(view, cast.success)));
    return yield* Deferred.await(view.browserEnded);
  });
}

export function relayBrowserTab(
  viewer: BrowserLiveViewer,
  ask: BrowserLiveAsk,
  reached: ReachedBrowserTab,
  deps: BrowserLiveDependencies,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    const startedAt = yield* DateTime.nowAsDate;
    const view = yield* openView(viewer, ask, reached, deps, startedAt);
    yield* Effect.addFinalizer(() => releaseOnClose(view));
    yield* deps.hold(reached.tab.conversationId, heldFrom(startedAt));
    const end = yield* Effect.raceAll([
      readViewer(view),
      watchBrowser(view),
      watchTab(view),
      idleWatch(view),
    ]);
    yield* Queue.end(view.inputs);
    if (end === VIEWER_LEFT) return;
    yield* send(view, { type: BROWSER_LIVE_SERVER.CLOSED, reason: end });
    yield* viewer.close(BROWSER_LIVE_CLOSE_CODE[end]);
  });
}
