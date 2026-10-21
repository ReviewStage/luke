/**
 * relay.ts -- one live view of one Browser tab: the agent's browser's frames of the tab out to a member's panel, and, while that member holds the takeover, their mouse and keys back into it.
 *
 * The tab was read under the member's reach before the socket stood
 * (`service.ts`); the relay reaches the browser of the agent whose
 * conversation holds it through `AgentBrowser`, which resumes a stopped
 * sandbox and starts the browser where it is not running, attaches to the
 * tab's target, and runs the page's screencast. Each frame goes to the
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
 * always stands well past their last input. Input from a member whose
 * takeover does not stand is refused and goes nowhere. Every point is in
 * the panel's own pixels at the viewport it last sent, and is mapped onto
 * the page's CSS pixels. Mouse moves that queue behind a slower browser are
 * folded into the last of each run, so the pointer never lags behind the
 * member's hand. The tab is read again every `TAB_CHECK_EVERY`, so a
 * driver change another window made reaches this one, and a tab that closed
 * or that the member no longer reaches closes the socket; as the socket
 * closes, however it closes, a takeover it took is handed back.
 *
 * A coding agent's sandbox stops at its turn's end, so while its tab is
 * watched the socket holds the sandbox through the lease every terminal of
 * it shares (`sandbox-terminal-lease.ts`), on the terminal's terms: the
 * connection holds it, and each message the panel sends moves it on,
 * written at most once a minute. The socket closes as idle once the panel
 * has sent nothing for the idle bound, and the sweep stops the sandbox
 * once the lease lapses. Luke's own sandbox is kept on its own rule and
 * takes no lease.
 */

import type { ReachedBrowserTab } from "@luke/database/models/agent-browser-tabs";
import { browserTabDriver } from "@luke/database/models/agent-browser-tabs";
import { BROWSER_SHOWN_MAX_CHARS } from "@luke/features/browser-acts";
import {
  BROWSER_LIVE_CLIENT,
  BROWSER_LIVE_CLOSE_CODE,
  BROWSER_LIVE_CLOSE_REASON,
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
import {
  type AgentBrowserService,
  BROWSER_UNREACHABLE,
  type CdpCommand,
  type CdpEvent,
  type CdpSession,
} from "../agents/browser/agent-browser.js";
import { EXCESS_KEYS, type UnparsedWireValue, unparsedWire } from "../core.js";
import type { RelaySocket } from "../terminal/relay.js";

export const BROWSER_LIVE_BOUNDS = {
  /** How long a socket stays open past the panel's last message. */
  IDLE: Duration.minutes(5),
  /** How often the panel's messages move the lease on, so a mouse move is not a write. */
  LEASE_WRITE_EVERY: Duration.minutes(1),
  /** How often a socket asks whether the panel has gone the idle bound silent. */
  IDLE_CHECK_EVERY: Duration.seconds(30),
  /** How often the tab is read again, for its driver and whether it still stands. */
  TAB_CHECK_EVERY: Duration.seconds(5),
  /** How often input moves the member's takeover on, well inside its hold. */
  RENEW_EVERY: Duration.seconds(10),
  /** The least time between two frames: at most eight a second. */
  FRAME_EVERY: Duration.millis(125),
  /** The most bytes the panel's socket may still be sending before a frame is skipped. */
  MAX_BUFFERED_BYTES: 1024 * 1024,
  /** The screencast: JPEG, no larger than a laptop's screen, at a quality text stays legible at. */
  SCREENCAST: { format: "jpeg", quality: 60, maxWidth: 1280, maxHeight: 800 },
} as const;

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
  readonly browser: Pick<AgentBrowserService, "connect">;
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
  readonly hold: (conversationId: string, heldUntil: Date) => Effect.Effect<void>;
}

/** The panel left: it is sent no close. */
const VIEWER_LEFT = "viewer-left";

type LiveEnd = BrowserLiveCloseReason | typeof VIEWER_LEFT;

/** The tab's target, attached: the CDP session and the target session its commands go to. */
interface LiveTarget {
  readonly cdp: CdpSession;
  readonly sessionId: string;
}

/** One input command, and whether it is a bare move, which a later move replaces. */
interface QueuedInput {
  readonly command: CdpCommand;
  readonly move: boolean;
}

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
const readClientMessage = readEither(browserLiveClientMessageSchema);

/** A text frame's JSON, or nothing a reader takes where it is none. */
function jsonOf(text: string): UnparsedWireValue {
  const parsed = Result.try(() => JSON.parse(text));
  return unparsedWire(Result.isSuccess(parsed) ? parsed.success : undefined);
}

const now = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis));

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
function foldMoves(batch: readonly QueuedInput[]): readonly CdpCommand[] {
  return batch
    .filter((input, at) => !(input.move && batch[at + 1]?.move === true))
    .map((input) => input.command);
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
      | typeof BROWSER_LIVE_CLIENT.VIEWPORT;
  }
>;

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
    const since = (yield* now).getTime() - (yield* Ref.get(lastActive));
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

/** One live view, from its tab read to its close, everything it opens belonging to the scope it runs in. */
export function relayBrowserTab(
  viewer: BrowserLiveViewer,
  ask: BrowserLiveAsk,
  reached: ReachedBrowserTab,
  deps: BrowserLiveDependencies,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { tab, agent } = reached;
    const drivable = agent === null || controlsAgent(ask.userId, agent);
    const startedAt = yield* now;
    // The instant this socket last took or moved on its takeover; none while it holds none.
    const driving = yield* Ref.make<number | undefined>(undefined);
    const lastDriver = yield* Ref.make<
      { readonly userId: string; readonly heldUntil: number } | null | undefined
    >(undefined);
    const viewport = yield* Ref.make<
      { readonly width: number; readonly height: number } | undefined
    >(undefined);
    const page = yield* Ref.make<{ readonly width: number; readonly height: number } | undefined>(
      undefined,
    );
    const pageState = yield* Ref.make({
      address: shown(tab.address),
      title: shown(tab.title),
      loading: false,
    });
    const live = yield* Ref.make<LiveTarget | undefined>(undefined);
    const lastActive = yield* Ref.make(startedAt.getTime());
    const lastHeld = yield* Ref.make(startedAt.getTime());
    const lastFrame = yield* Ref.make<number | undefined>(undefined);
    const inputs = yield* Queue.make<QueuedInput, Cause.Done>();
    const browserEnded = yield* Deferred.make<LiveEnd>();

    const send = (message: BrowserLiveServerMessage) => sendMessage(viewer, message);

    /** The driver as the tab now stands, sent where it changed. */
    const publishDriver = (row: ReachedBrowserTab) =>
      Effect.gen(function* () {
        const found = browserTabDriver(row.tab, yield* now);
        const driver =
          found === null ? null : { userId: found.userId, heldUntil: found.heldUntil.getTime() };
        if (driver?.userId !== ask.userId) yield* Ref.set(driving, undefined);
        const last = yield* Ref.get(lastDriver);
        if (
          last !== undefined &&
          last?.userId === driver?.userId &&
          last?.heldUntil === driver?.heldUntil
        )
          return;
        yield* Ref.set(lastDriver, driver);
        yield* send({
          type: BROWSER_LIVE_SERVER.DRIVER,
          driver,
          yours: driver?.userId === ask.userId,
        });
      });

    /** The tab read again: its driver published, and whether it still stands for the member; a store that could not say is asked again next time. */
    const checkTab = Effect.gen(function* () {
      const found = yield* Effect.result(deps.readTab(ask.userId, ask.taskId, ask.tabId));
      if (Result.isFailure(found)) return true;
      if (Option.isNone(found.success)) return false;
      yield* publishDriver(found.success.value);
      return true;
    });

    const watchTab: Effect.Effect<LiveEnd> = Effect.as(
      Effect.repeat(checkTab, {
        schedule: Schedule.spaced(BROWSER_LIVE_BOUNDS.TAB_CHECK_EVERY),
        while: (standing) => standing,
      }),
      BROWSER_LIVE_CLOSE_REASON.GONE,
    );

    // A takeover this socket took is handed back as it closes, however it closes.
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        if ((yield* Ref.get(driving)) === undefined) return;
        yield* Effect.ignore(deps.handBack(tab.id, ask.userId));
      }),
    );

    /** The panel's message noted as someone watching, moving a coding agent's lease on at most once a minute. */
    const noteActive = (at: Date) =>
      Effect.gen(function* () {
        yield* Ref.set(lastActive, at.getTime());
        if (agent === null) return;
        const since = at.getTime() - (yield* Ref.get(lastHeld));
        if (since < Duration.toMillis(BROWSER_LIVE_BOUNDS.LEASE_WRITE_EVERY)) return;
        yield* Ref.set(lastHeld, at.getTime());
        yield* deps.hold(tab.conversationId, heldFrom(at));
      });

    /** The tab read again after a takeover's write, its driver published; a tab gone meanwhile is the next check's to close. */
    const republish = Effect.gen(function* () {
      const found = yield* Effect.result(deps.readTab(ask.userId, ask.taskId, ask.tabId));
      if (Result.isSuccess(found) && Option.isSome(found.success)) {
        yield* publishDriver(found.success.value);
      }
    });

    const takeOver = (at: Date) =>
      Effect.gen(function* () {
        if (!drivable) {
          return yield* send({
            type: BROWSER_LIVE_SERVER.REFUSED,
            reason: BROWSER_LIVE_REFUSAL.NOT_PERMITTED,
          });
        }
        const heldUntil = new Date(at.getTime() + BROWSER_TAKEOVER_HOLD_MS);
        const taken = yield* Effect.result(deps.takeOver(tab.id, ask.userId, heldUntil, at));
        yield* Ref.set(
          driving,
          Result.isSuccess(taken) && taken.success ? at.getTime() : undefined,
        );
        // Note that a tab another member drives answers them as its driver, rather than a refusal.
        yield* republish;
      });

    const handBack = Effect.gen(function* () {
      if ((yield* Ref.get(driving)) === undefined) return;
      yield* Ref.set(driving, undefined);
      yield* Effect.ignore(deps.handBack(tab.id, ask.userId));
      yield* republish;
    });

    /** Whether the member's takeover stands, moved on where its last write is `RENEW_EVERY` old. */
    const holding = (at: Date) =>
      Effect.gen(function* () {
        const renewedAt = yield* Ref.get(driving);
        if (renewedAt === undefined) return false;
        if (at.getTime() - renewedAt < Duration.toMillis(BROWSER_LIVE_BOUNDS.RENEW_EVERY))
          return true;
        const heldUntil = new Date(at.getTime() + BROWSER_TAKEOVER_HOLD_MS);
        const renewed = yield* Effect.result(deps.renew(tab.id, ask.userId, heldUntil, at));
        // Note that a store that could not say keeps the takeover until the next renewal, as the row still holds it.
        if (Result.isFailure(renewed)) return true;
        if (!renewed.success) {
          yield* Ref.set(driving, undefined);
          yield* republish;
          return false;
        }
        yield* Ref.set(driving, at.getTime());
        return true;
      });

    const drive = (message: InputMessage, at: Date) =>
      Effect.gen(function* () {
        if (!(yield* holding(at))) {
          return yield* send({
            type: BROWSER_LIVE_SERVER.REFUSED,
            reason: BROWSER_LIVE_REFUSAL.NOT_DRIVING,
          });
        }
        const input = commandOf(message, yield* Ref.get(viewport), yield* Ref.get(page));
        if (input !== undefined) yield* Queue.offer(inputs, input);
      });

    const onMessage = (message: BrowserLiveClientMessage) =>
      Effect.gen(function* () {
        const at = yield* now;
        yield* noteActive(at);
        switch (message.type) {
          case BROWSER_LIVE_CLIENT.TAKE_OVER:
            return yield* takeOver(at);
          case BROWSER_LIVE_CLIENT.HAND_BACK:
            return yield* handBack;
          case BROWSER_LIVE_CLIENT.VIEWPORT:
            return yield* Ref.set(viewport, { width: message.width, height: message.height });
          default:
            return yield* drive(message, at);
        }
      });

    const readViewer: Effect.Effect<LiveEnd> = Effect.as(
      Stream.runForEach(viewer.frames, (frame) => {
        if (!("text" in frame)) return Effect.void;
        const message = readClientMessage(jsonOf(frame.text));
        return Result.isFailure(message) ? Effect.void : onMessage(message.success);
      }),
      VIEWER_LEFT,
    );

    /** The queued input sent to the tab in order, each run of bare moves folded into its last; a command the browser refused goes nowhere. */
    const dispatchInput = Effect.forever(
      Effect.gen(function* () {
        const batch = yield* Queue.takeAll(inputs);
        const target = yield* Ref.get(live);
        if (target === undefined) return;
        for (const command of foldMoves(batch)) {
          yield* Effect.ignore(target.cdp.send({ ...command, sessionId: target.sessionId }));
        }
      }),
    );

    const publishPage = (next: { address: string; title: string; loading: boolean }) =>
      Effect.gen(function* () {
        const last = yield* Ref.get(pageState);
        if (
          last.address === next.address &&
          last.title === next.title &&
          last.loading === next.loading
        )
          return;
        yield* Ref.set(pageState, next);
        yield* send({ type: BROWSER_LIVE_SERVER.PAGE, ...next });
      });

    /** One frame to the panel, unless its socket is still sending the last ones, then acknowledged no sooner than `FRAME_EVERY` after the last. */
    const relayFrame = (target: LiveTarget, params: UnparsedWireValue) =>
      Effect.gen(function* () {
        const frame = readFrame(params);
        if (Result.isFailure(frame)) return;
        const { data, sessionId: ackId, metadata } = frame.success;
        yield* Ref.set(page, { width: metadata.deviceWidth, height: metadata.deviceHeight });
        if ((yield* viewer.buffered) <= BROWSER_LIVE_BOUNDS.MAX_BUFFERED_BYTES) {
          yield* send({
            type: BROWSER_LIVE_SERVER.FRAME,
            data,
            pageWidth: Math.max(0, metadata.deviceWidth),
            pageHeight: Math.max(0, metadata.deviceHeight),
          });
        }
        const last = yield* Ref.get(lastFrame);
        if (last !== undefined) {
          const wait =
            last + Duration.toMillis(BROWSER_LIVE_BOUNDS.FRAME_EVERY) - (yield* now).getTime();
          if (wait > 0) yield* Effect.sleep(Duration.millis(wait));
        }
        yield* Ref.set(lastFrame, (yield* now).getTime());
        yield* Effect.ignore(
          target.cdp.send({
            method: "Page.screencastFrameAck",
            params: { sessionId: ackId },
            sessionId: target.sessionId,
          }),
        );
      });

    const gone = Deferred.succeed(browserEnded, BROWSER_LIVE_CLOSE_REASON.GONE);

    const onEvent = (event: CdpEvent) =>
      Effect.gen(function* () {
        const target = yield* Ref.get(live);
        const ours = target !== undefined && event.sessionId === target.sessionId;
        switch (event.method) {
          case CDP_METHOD.SCREENCAST_FRAME:
            if (ours) yield* relayFrame(target, event.params);
            return;
          case CDP_METHOD.TARGET_INFO_CHANGED: {
            const info = readTargetInfo(event.params);
            if (Result.isFailure(info) || info.success.targetInfo.targetId !== tab.targetId) return;
            const { url, title } = info.success.targetInfo;
            const last = yield* Ref.get(pageState);
            return yield* publishPage({ ...last, address: shown(url), title: shown(title) });
          }
          case CDP_METHOD.STARTED_LOADING:
          case CDP_METHOD.STOPPED_LOADING: {
            // A page's main frame has the id of its target.
            const frame = readFrameId(event.params);
            if (Result.isFailure(frame) || frame.success.frameId !== tab.targetId) return;
            const last = yield* Ref.get(pageState);
            return yield* publishPage({
              ...last,
              loading: event.method === CDP_METHOD.STARTED_LOADING,
            });
          }
          case CDP_METHOD.TARGET_DESTROYED: {
            const destroyed = readTargetId(event.params);
            if (Result.isSuccess(destroyed) && destroyed.success.targetId === tab.targetId)
              yield* gone;
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

    /** The agent's browser reached, the tab's target attached and cast, and how the browser's side ended. */
    const watchBrowser: Effect.Effect<LiveEnd, never, Scope.Scope> = Effect.gen(function* () {
      const session = yield* Effect.result(deps.sessionOf(tab.conversationId));
      if (Result.isFailure(session)) return BROWSER_LIVE_CLOSE_REASON.UNAVAILABLE;
      if (Option.isNone(session.success)) return BROWSER_LIVE_CLOSE_REASON.NOT_OPENED;
      const connected = yield* Effect.result(deps.browser.connect(session.success.value));
      if (Result.isFailure(connected)) {
        return connected.failure.reason === BROWSER_UNREACHABLE.NOT_OPENED
          ? BROWSER_LIVE_CLOSE_REASON.NOT_OPENED
          : BROWSER_LIVE_CLOSE_REASON.UNAVAILABLE;
      }
      const cdp = connected.success;
      // Note that the events are read from before the first command, so the screencast's first frame, which
      // Chromium sends no other until it is acknowledged, is never missed.
      yield* Effect.forkScoped(
        Effect.andThen(
          Stream.runForEach(cdp.events, onEvent),
          Deferred.succeed(browserEnded, BROWSER_LIVE_CLOSE_REASON.UNAVAILABLE),
        ),
      );
      yield* Effect.yieldNow;
      const attached = yield* Effect.result(
        Effect.gen(function* () {
          const pages = yield* cdp.pages;
          const target = pages.find((candidate) => candidate.targetId === tab.targetId);
          if (target === undefined) return undefined;
          yield* publishPage({
            address: shown(target.url),
            title: shown(target.title),
            loading: false,
          });
          yield* cdp.send({ method: "Target.setDiscoverTargets", params: { discover: true } });
          const answer = readSessionId(
            yield* cdp.send({
              method: "Target.attachToTarget",
              params: { targetId: tab.targetId, flatten: true },
            }),
          );
          if (Result.isFailure(answer)) return undefined;
          const sessionId = answer.success.sessionId;
          yield* Ref.set(live, { cdp, sessionId });
          yield* cdp.send({ method: "Page.enable", sessionId });
          yield* cdp.send({
            method: "Page.startScreencast",
            params: { ...BROWSER_LIVE_BOUNDS.SCREENCAST, everyNthFrame: 1 },
            sessionId,
          });
          return sessionId;
        }),
      );
      if (Result.isFailure(attached)) return BROWSER_LIVE_CLOSE_REASON.UNAVAILABLE;
      // The browser holds no such target: the tab closed, or a resume began the browser afresh.
      if (attached.success === undefined) return BROWSER_LIVE_CLOSE_REASON.GONE;
      yield* Effect.forkScoped(dispatchInput);
      return yield* Deferred.await(browserEnded);
    });

    // A watched coding agent's sandbox is held from the start, so the resume a connection makes is held too.
    if (agent !== null) yield* deps.hold(tab.conversationId, heldFrom(startedAt));
    const end = yield* Effect.raceAll([readViewer, watchBrowser, watchTab, idleWatch(lastActive)]);
    yield* Queue.end(inputs);
    if (end === VIEWER_LEFT) return;
    yield* send({ type: BROWSER_LIVE_SERVER.CLOSED, reason: end });
    yield* viewer.close(BROWSER_LIVE_CLOSE_CODE[end]);
  });
}
