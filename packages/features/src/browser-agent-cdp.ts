/**
 * browser-agent-cdp.ts -- an agent's browser actions run on a DevTools protocol session: each action as the commands it sends, a sequence run in order up to its first failure, and what each step answers.
 *
 * The vocabulary is `browser-agent-actions.ts`; this is its one
 * implementation over CDP (`browser-cdp.ts`), which the browser in an
 * agent's sandbox speaks (`packages/service`'s `agent-browser.ts`) and the
 * Mac's Browser tabs speak through their views' debuggers
 * (`packages/host`'s `mac-browser-tabs.ts`). A tab is a page target, reached through a session
 * of its own attached flattened (`Target.attachToTarget`) the first time a
 * sequence acts on it and detached as the sequence ends. Clicks, keys, and
 * scrolls are the browser's own input events, typing is inserted text, an
 * element named by its ref is found by its backend node id, and a page's
 * console is what the browser replays as its console and log are enabled.
 * Nothing a page holds is kept or logged here; it reaches only the caller.
 *
 * Every action is bounded: `wait` by its own timeout, every other by the
 * action timeout. A sequence stops at its first failure, whose reason is in
 * words a model can act on, and answers every step that ran.
 *
 * A caller that draws the agent's pointer passes a cursor
 * (`BrowserCursor`): each click, type, and wheel turn reports its point
 * just before its input is dispatched, and where someone is watching the
 * input waits `BROWSER_CURSOR_BEAT` after it, so a pointer drawn gliding to
 * the point arrives as the action lands. A caller that passes none sends
 * exactly the commands it always did.
 *
 * A `wait` right after an action that may navigate (a click, Enter, a
 * navigation, a step through history) on the same tab first waits out the
 * navigation that action started, where one starts within a short grace,
 * since the document it would otherwise ask about is still the old one. A
 * screenshot of a tab that has drawn nothing yet, such as one just opened,
 * is asked again for a moment before it fails.
 */

import { EXCESS_KEYS, type UnparsedWireValue, WireValueSchema } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import {
  Clock,
  Data,
  Deferred,
  Duration,
  Effect,
  Option,
  Result,
  Schedule,
  Schema,
  type Scope,
  Stream,
} from "effect";
import {
  BROWSER_AGENT_ACTION,
  BROWSER_AGENT_LIMITS,
  BROWSER_CONSOLE_LEVEL,
  BROWSER_CURSOR_KIND,
  BROWSER_KEYS,
  BROWSER_MODIFIER,
  BROWSER_SCREENSHOT,
  BROWSER_STEP_STATUS,
  type BrowserAgentAction,
  type BrowserAgentActionName,
  type BrowserAgentRun,
  type BrowserAgentStep,
  type BrowserConsoleMessage,
  type BrowserCursorKind,
  type BrowserCursorMove,
  backendNodeIdOf,
  cutBrowserText,
} from "./browser-agent-actions.js";
import { snapshotTextOf } from "./browser-agent-snapshot.js";
import {
  CDP_FAILURE,
  type CdpEvent,
  CdpFailure,
  type CdpParams,
  type CdpSession,
} from "./browser-cdp.js";

/** How often `wait` asks whether what it waits for has come. */
const WAIT_POLL = Duration.millis(250);

/** How long a watched pointer's input waits after its move is reported: about the glide the panel draws to the point. */
export const BROWSER_CURSOR_BEAT = Duration.millis(250);

/**
 * Where a run reports the agent's pointer: `report` is told of each move
 * just before its input is dispatched, and `watched` says whether someone
 * is watching the tabs, which holds each input `BROWSER_CURSOR_BEAT` after
 * its report. Note that a report never fails the action: one that could
 * not be made is the caller's to swallow.
 */
export interface BrowserCursor<R = never> {
  readonly report: (move: BrowserCursorMove) => Effect.Effect<void, never, R>;
  readonly watched: boolean;
}

/**
 * How long a `wait` after an action that may navigate gives that action's
 * navigation to start before it asks about the page as it stands.
 */
const NAVIGATION_GRACE = Duration.millis(500);

/** How often, and how many times more, a screenshot of a tab that has drawn nothing yet is asked for: two seconds in all. */
const CAPTURE_RETRY = Duration.millis(250);
const CAPTURE_RETRIES = 8;

/** The actions that may start a navigation, a key's only by Enter. */
const NAVIGATING_ACTIONS: ReadonlySet<BrowserAgentActionName> = new Set([
  BROWSER_AGENT_ACTION.NAVIGATE,
  BROWSER_AGENT_ACTION.BACK,
  BROWSER_AGENT_ACTION.FORWARD,
  BROWSER_AGENT_ACTION.CLICK,
  BROWSER_AGENT_ACTION.KEY,
]);

/** The page events that say a frame began or committed a navigation, stopped loading or was removed, or the page loaded. */
const NAVIGATION_EVENT = {
  STARTED: "Page.frameStartedLoading",
  NAVIGATED: "Page.frameNavigated",
  STOPPED: "Page.frameStoppedLoading",
  DETACHED: "Page.frameDetached",
  LOADED: "Page.loadEventFired",
} as const;

/** How long a tab's session is given to detach as a sequence ends, so a browser that stopped answering holds no one up. */
const DETACH_TIMEOUT = Duration.seconds(2);

/** The modifier bits a key event carries. */
const MODIFIER_BITS = {
  [BROWSER_MODIFIER.ALT]: 1,
  [BROWSER_MODIFIER.CONTROL]: 2,
  [BROWSER_MODIFIER.META]: 4,
  [BROWSER_MODIFIER.SHIFT]: 8,
} as const;

/** The modifiers under which a key is a shortcut, which types no text. */
const SHORTCUT_MODIFIERS: ReadonlySet<string> = new Set([
  BROWSER_MODIFIER.ALT,
  BROWSER_MODIFIER.CONTROL,
  BROWSER_MODIFIER.META,
]);

const NAMED_KEYS: ReadonlyMap<string, (typeof BROWSER_KEYS)[keyof typeof BROWSER_KEYS]> = new Map(
  Object.entries(BROWSER_KEYS),
);

/** A runtime console call's level by its type; any other type is a plain log. */
const CONSOLE_TYPE_LEVEL: ReadonlyMap<string, BrowserConsoleMessage["level"]> = new Map([
  ["debug", BROWSER_CONSOLE_LEVEL.DEBUG],
  ["info", BROWSER_CONSOLE_LEVEL.INFO],
  ["warning", BROWSER_CONSOLE_LEVEL.WARNING],
  ["error", BROWSER_CONSOLE_LEVEL.ERROR],
  ["assert", BROWSER_CONSOLE_LEVEL.ERROR],
]);

/** A log entry's level by the browser's word for it. */
const LOG_LEVEL: ReadonlyMap<string, BrowserConsoleMessage["level"]> = new Map([
  ["verbose", BROWSER_CONSOLE_LEVEL.DEBUG],
  ["info", BROWSER_CONSOLE_LEVEL.INFO],
  ["warning", BROWSER_CONSOLE_LEVEL.WARNING],
  ["error", BROWSER_CONSOLE_LEVEL.ERROR],
]);

/** A step that could not be done, and why, in words a model can act on. */
class ActionFailed extends Data.TaggedError("ActionFailed")<{ readonly reason: string }> {}

const failed = (reason: string) => Effect.fail(new ActionFailed({ reason }));

const AttachedSchema = Schema.Struct({ sessionId: Schema.String });
const NavigatedSchema = Schema.Struct({ errorText: Schema.optional(Schema.String) });
const HistorySchema = Schema.Struct({
  currentIndex: Schema.Number,
  entries: Schema.Array(Schema.Struct({ id: Schema.Number })),
});
const QuadsSchema = Schema.Struct({ quads: Schema.Array(Schema.Array(Schema.Number)) });
const ViewportSchema = Schema.Struct({
  pageX: Schema.Number,
  pageY: Schema.Number,
  clientWidth: Schema.Number,
  clientHeight: Schema.Number,
});
const MetricsSchema = Schema.Struct({
  cssLayoutViewport: Schema.Struct({ clientWidth: Schema.Number, clientHeight: Schema.Number }),
  cssVisualViewport: ViewportSchema,
});
const EvaluatedSchema = Schema.Struct({
  result: Schema.Struct({ value: Schema.optional(WireValueSchema) }),
});
const CapturedSchema = Schema.Struct({ data: Schema.String });
const PointSchema = Schema.Struct({ x: Schema.Number, y: Schema.Number });
const ClosedSchema = Schema.Struct({ success: Schema.optional(Schema.Boolean) });
const ConsoleCallSchema = Schema.Struct({
  type: Schema.String,
  timestamp: Schema.Number,
  args: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      value: Schema.optional(WireValueSchema),
      description: Schema.optional(Schema.String),
      unserializableValue: Schema.optional(Schema.String),
    }),
  ),
});
const LogEntrySchema = Schema.Struct({
  entry: Schema.Struct({ level: Schema.String, text: Schema.String, timestamp: Schema.Number }),
});
/** A frame event: `frameId` on a load's start, stop, and removal, `frame.id` on a commit. */
const FrameEventSchema = Schema.Struct({
  frameId: Schema.optional(Schema.String),
  frame: Schema.optional(Schema.Struct({ id: Schema.String })),
});

const readConsoleCall = readEither(ConsoleCallSchema, { excess: EXCESS_KEYS.DROP });
const readLogEntry = readEither(LogEntrySchema, { excess: EXCESS_KEYS.DROP });
const readFrameEvent = readEither(FrameEventSchema, { excess: EXCESS_KEYS.DROP });
const readPoint = readEither(PointSchema, { excess: EXCESS_KEYS.DROP });

/** The middle of the focused element in CSS pixels of the visible page, or null where the page's body has the focus. */
const FOCUSED_POINT = `(() => {
  const focused = document.activeElement;
  if (focused === null || focused === document.body) return null;
  const box = focused.getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
})()`;

/** A reader of a command's answer, which fails as malformed where the answer is not what the method answers. */
function answerOf<S extends Schema.ConstraintDecoder<unknown>>(schema: S) {
  const read = readEither(schema, { excess: EXCESS_KEYS.DROP });
  return (method: string, value: UnparsedWireValue): Effect.Effect<S["Type"], CdpFailure> => {
    const result = read(value);
    return Result.isFailure(result)
      ? Effect.fail(new CdpFailure({ kind: CDP_FAILURE.MALFORMED, method }))
      : Effect.succeed(result.success);
  };
}

/** A command's failure in words a model can act on. */
function wordsOfCdp(failure: CdpFailure): string {
  switch (failure.kind) {
    case CDP_FAILURE.REFUSED:
      return `the browser refused ${failure.method}: ${failure.detail ?? "it gave no reason"}`;
    case CDP_FAILURE.TIMED_OUT:
      return `the browser did not answer ${failure.method} in time; try again`;
    case CDP_FAILURE.MALFORMED:
      return `the browser answered ${failure.method} with something unexpected`;
    case CDP_FAILURE.CLOSED:
      return "the connection to the browser closed; try again";
    case CDP_FAILURE.DENIED:
      return failure.detail ?? `${failure.method} was not let run`;
  }
}

/** A refusal read as the failure given, any other failure left as it is. */
const refusedAs = (reason: string) => (failure: CdpFailure) =>
  failure.kind === CDP_FAILURE.REFUSED ? new ActionFailed({ reason }) : failure;

const goneRef = (ref: string) =>
  `${ref} is not on the page any more; take a new snapshot for the refs that are`;

/** A tab reached through its own flattened session: its id, and its commands. */
interface Page {
  readonly targetId: string;
  readonly sessionId: string;
  readonly send: (
    method: string,
    params?: CdpParams,
  ) => Effect.Effect<UnparsedWireValue, CdpFailure>;
}

/** The tabs a sequence attached to, each attached the first time it is acted on and detached as the scope ends. */
interface Pages {
  readonly page: (targetId: string) => Effect.Effect<Page, ActionFailed | CdpFailure>;
  /** Forgets a tab that is closed, which has no session left to detach. */
  readonly forget: (targetId: string) => void;
  /** Hears the tab's navigations from now on, for the `wait` after the action about to run. */
  readonly watch: (page: Page) => Effect.Effect<void>;
  /** Waits out a navigation heard on the tab since its watch began, where one starts within the grace; nothing where the tab is not watched. */
  readonly settle: (targetId: string) => Effect.Effect<void>;
}

/** A tab's navigations as a watch hears them: whether one started, and whether every frame it started has stopped loading. */
interface Watched {
  readonly targetId: string;
  readonly started: Deferred.Deferred<void>;
  readonly settled: Deferred.Deferred<void>;
}

const readAttached = answerOf(AttachedSchema);

/**
 * Hears one navigation event: a frame that starts loading or commits marks
 * the navigation started and is loading until it stops or is removed, as an
 * iframe taken off the page mid-load is; once none is, or the page fires its
 * load, the navigation is settled. Note that a stop or a load
 * before anything started is the end of an earlier load, so it settles
 * nothing.
 */
function hearNavigation(event: CdpEvent, watched: Watched, loading: Set<string>) {
  return Effect.gen(function* () {
    const read = readFrameEvent(event.params);
    const frame = Result.isFailure(read)
      ? undefined
      : (read.success.frameId ?? read.success.frame?.id);
    if (event.method === NAVIGATION_EVENT.STARTED || event.method === NAVIGATION_EVENT.NAVIGATED) {
      if (frame !== undefined) loading.add(frame);
      yield* Deferred.succeed(watched.started, undefined);
      return;
    }
    if (!(yield* Deferred.isDone(watched.started))) return;
    const ended =
      event.method === NAVIGATION_EVENT.STOPPED || event.method === NAVIGATION_EVENT.DETACHED;
    const stopped = ended && frame !== undefined && loading.delete(frame);
    if (event.method === NAVIGATION_EVENT.LOADED || (stopped && loading.size === 0)) {
      yield* Deferred.succeed(watched.settled, undefined);
    }
  });
}

/** Waits out a watched navigation: none where nothing started within the grace, else until it settles. */
function settleWatched(watched: Watched) {
  return Deferred.await(watched.started).pipe(
    Effect.timeoutOption(NAVIGATION_GRACE),
    Effect.flatMap((started) =>
      Option.isSome(started) ? Deferred.await(watched.settled) : Effect.void,
    ),
  );
}

/**
 * The tabs a sequence acts on, each attached once. Note that a closed tab is
 * forgotten rather than detached, since its session went with it.
 */
function pagesOver(cdp: CdpSession): Effect.Effect<Pages, never, Scope.Scope> {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const attached = new Map<string, Page>();
    let watching: Watched | undefined;
    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        [...attached.values()],
        (page) =>
          Effect.ignore(
            cdp
              .send({ method: "Target.detachFromTarget", params: { sessionId: page.sessionId } })
              .pipe(Effect.timeout(DETACH_TIMEOUT)),
          ),
        { discard: true },
      ),
    );
    const attach = (targetId: string) =>
      Effect.gen(function* () {
        const method = "Target.attachToTarget";
        const answer = yield* cdp
          .send({ method, params: { targetId, flatten: true } })
          .pipe(
            Effect.mapError(
              refusedAs(`there is no tab ${targetId}; list the tabs to see which are open`),
            ),
          );
        const { sessionId } = yield* readAttached(method, answer);
        const page: Page = {
          targetId,
          sessionId,
          send: (command, params) =>
            cdp.send(
              params === undefined
                ? { method: command, sessionId }
                : { method: command, params, sessionId },
            ),
        };
        attached.set(targetId, page);
        return page;
      });
    return {
      page: (targetId) =>
        Effect.suspend(() => {
          const page = attached.get(targetId);
          return page === undefined ? attach(targetId) : Effect.succeed(page);
        }),
      forget: (targetId) => void attached.delete(targetId),
      watch: (page) =>
        Effect.gen(function* () {
          const watched: Watched = {
            targetId: page.targetId,
            started: yield* Deferred.make<void>(),
            settled: yield* Deferred.make<void>(),
          };
          const loading = new Set<string>();
          const own = Stream.filter(cdp.events, (event) => event.sessionId === page.sessionId);
          yield* Effect.forkIn(
            Stream.runForEach(own, (event) => hearNavigation(event, watched, loading)),
            scope,
          );
          yield* Effect.yieldNow;
          // Note that a browser that will not send the page's events leaves the wait to its own check.
          const enabled = yield* Effect.result(page.send("Page.enable"));
          watching = Result.isSuccess(enabled) ? watched : undefined;
        }),
      settle: (targetId) =>
        Effect.suspend(() => {
          const watched = watching;
          watching = undefined;
          return watched?.targetId === targetId ? settleWatched(watched) : Effect.void;
        }),
    };
  });
}

/** The step a tab-only action answers. */
function actedOn<const Name extends BrowserAgentActionName>(action: Name, tab: string) {
  return { action, status: BROWSER_STEP_STATUS.DONE, tab } as const;
}

const readNavigated = answerOf(NavigatedSchema);
const readHistory = answerOf(HistorySchema);
const readQuads = answerOf(QuadsSchema);
const readMetrics = answerOf(MetricsSchema);
const readEvaluated = answerOf(EvaluatedSchema);
const readCaptured = answerOf(CapturedSchema);
const readClosed = answerOf(ClosedSchema);

function navigate(page: Page, url: string) {
  return Effect.gen(function* () {
    const method = "Page.navigate";
    const { errorText } = yield* readNavigated(method, yield* page.send(method, { url }));
    if (errorText !== undefined && errorText !== "") {
      return yield* failed(`the page at ${url} did not load: ${errorText}`);
    }
  });
}

/** Steps the tab's history by one, back or forward. */
function stepHistory(page: Page, by: -1 | 1) {
  return Effect.gen(function* () {
    const method = "Page.getNavigationHistory";
    const history = yield* readHistory(method, yield* page.send(method));
    const entry = history.entries[history.currentIndex + by];
    if (entry === undefined) {
      return yield* failed(`the tab has no page to go ${by < 0 ? "back" : "forward"} to`);
    }
    yield* page.send("Page.navigateToHistoryEntry", { entryId: entry.id });
  });
}

/** The quads an element is drawn in, or none where it is not drawn; a ref no longer on the page fails. */
function quadsOf(page: Page, ref: string) {
  const method = "DOM.getContentQuads";
  return page.send(method, { backendNodeId: backendNodeIdOf(ref) }).pipe(
    Effect.flatMap((answer) => readQuads(method, answer)),
    Effect.map(({ quads }) => quads.filter((quad) => quad.length === 8)),
  );
}

/** The middle of an element named by its ref, scrolled into view first, in CSS pixels of the visible page. */
function pointOfRef(page: Page, ref: string) {
  return Effect.gen(function* () {
    yield* page
      .send("DOM.scrollIntoViewIfNeeded", { backendNodeId: backendNodeIdOf(ref) })
      .pipe(Effect.mapError(refusedAs(goneRef(ref))));
    const [quad] = yield* quadsOf(page, ref).pipe(
      Effect.mapError(refusedAs(`${ref} is not drawn on the page; it may be hidden`)),
    );
    if (quad === undefined) {
      return yield* failed(`${ref} is not drawn on the page; it may be hidden`);
    }
    const xs = [quad[0] ?? 0, quad[2] ?? 0, quad[4] ?? 0, quad[6] ?? 0];
    const ys = [quad[1] ?? 0, quad[3] ?? 0, quad[5] ?? 0, quad[7] ?? 0];
    return { x: xs.reduce((sum, x) => sum + x, 0) / 4, y: ys.reduce((sum, y) => sum + y, 0) / 4 };
  });
}

/** A left click at a point: the pointer moves there, presses, and lets go. */
function clickAt(page: Page, point: { readonly x: number; readonly y: number }) {
  const mouse = (type: string, buttons: number) =>
    page.send("Input.dispatchMouseEvent", {
      type,
      x: point.x,
      y: point.y,
      button: type === "mouseMoved" ? "none" : "left",
      buttons,
      clickCount: type === "mouseMoved" ? 0 : 1,
    });
  return Effect.andThen(
    mouse("mouseMoved", 0),
    Effect.andThen(mouse("mousePressed", 1), mouse("mouseReleased", 0)),
  );
}

function typeText(page: Page, text: string, ref: string | undefined) {
  return Effect.gen(function* () {
    if (ref !== undefined) {
      yield* page
        .send("DOM.focus", { backendNodeId: backendNodeIdOf(ref) })
        .pipe(
          Effect.mapError(refusedAs(`${ref} cannot take the focus; click it, or name a field`)),
        );
    }
    yield* page.send("Input.insertText", { text });
  });
}

/**
 * Reports the pointer's move to a point, with the visible page's size, and
 * holds the input after it for the beat where someone watches. Note that a
 * page whose size cannot be read reports nothing, since a point the panel
 * cannot place is no use, and the action goes on as it would have.
 */
function pointTo<R>(
  page: Page,
  cursor: BrowserCursor<R> | undefined,
  kind: BrowserCursorKind,
  point: { readonly x: number; readonly y: number },
) {
  return Effect.gen(function* () {
    if (cursor === undefined) return;
    const method = "Page.getLayoutMetrics";
    const metrics = yield* Effect.option(
      Effect.flatMap(page.send(method), (answer) => readMetrics(method, answer)),
    );
    if (Option.isNone(metrics)) return;
    const view = metrics.value.cssVisualViewport;
    yield* cursor.report({
      tab: page.targetId,
      x: point.x,
      y: point.y,
      kind,
      viewport: { width: view.clientWidth, height: view.clientHeight },
      at: yield* Clock.currentTimeMillis,
    });
    if (cursor.watched) yield* Effect.sleep(BROWSER_CURSOR_BEAT);
  });
}

/**
 * Where typing lands, for the pointer alone: the middle of the element a
 * ref names, or of the focused one. None where it cannot be told, which
 * leaves the typing to say what went wrong, if anything did.
 */
function typingPointOf(page: Page, ref: string | undefined) {
  if (ref !== undefined) return Effect.option(pointOfRef(page, ref));
  const method = "Runtime.evaluate";
  return Effect.option(
    page.send(method, { expression: FOCUSED_POINT, returnByValue: true }).pipe(
      Effect.flatMap((answer) => readEvaluated(method, answer)),
      Effect.flatMap(({ result }) => {
        const point = readPoint(result.value ?? null);
        return Result.isSuccess(point) ? Effect.succeed(point.success) : Effect.fail("none");
      }),
    ),
  );
}

/** Types the text, the pointer moved to where it lands first where a cursor is drawn. */
function typeWithCursor<R>(
  page: Page,
  cursor: BrowserCursor<R> | undefined,
  text: string,
  ref: string | undefined,
) {
  if (cursor === undefined) return typeText(page, text, ref);
  return Effect.gen(function* () {
    const point = yield* typingPointOf(page, ref);
    if (Option.isSome(point)) yield* pointTo(page, cursor, BROWSER_CURSOR_KIND.TYPE, point.value);
    yield* typeText(page, text, ref);
  });
}

/** What a key event says of a key, Shift held or not: its name, code, Windows key code, and the text it types. */
function keyOf(key: string, shifted: boolean) {
  const named = NAMED_KEYS.get(key);
  if (named !== undefined) return { key: named.text === " " ? " " : key, ...named };
  const upper = key.toUpperCase();
  if (/^[A-Z]$/u.test(upper)) {
    // Note that a letter under Shift is its capital, as a keyboard's own event says it.
    const letter = shifted ? upper : key;
    return { key: letter, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: letter };
  }
  if (/^\d$/u.test(key)) return { key, code: `Digit${key}`, keyCode: key.charCodeAt(0), text: key };
  return { key, code: "", keyCode: 0, text: key };
}

/** A key pressed and let go, with the modifiers held; under a shortcut's modifier it types nothing. */
function pressKey(page: Page, key: string, modifiers: readonly (keyof typeof MODIFIER_BITS)[]) {
  const pressed = keyOf(key, modifiers.includes(BROWSER_MODIFIER.SHIFT));
  const bits = modifiers.reduce((sum, modifier) => sum | MODIFIER_BITS[modifier], 0);
  const text = modifiers.some((modifier) => SHORTCUT_MODIFIERS.has(modifier)) ? "" : pressed.text;
  const event = {
    modifiers: bits,
    key: pressed.key,
    code: pressed.code,
    windowsVirtualKeyCode: pressed.keyCode,
  };
  const down = text === "" ? { type: "rawKeyDown", ...event } : { type: "keyDown", ...event, text };
  return Effect.andThen(
    page.send("Input.dispatchKeyEvent", down),
    page.send("Input.dispatchKeyEvent", { type: "keyUp", ...event }),
  );
}

/** Scrolls an element into view, or turns the wheel over the middle of the visible page. */
function scroll<R>(
  page: Page,
  by: { readonly deltaX?: number; readonly deltaY?: number; readonly ref?: string },
  cursor: BrowserCursor<R> | undefined,
) {
  return Effect.gen(function* () {
    if (by.ref !== undefined) {
      yield* page
        .send("DOM.scrollIntoViewIfNeeded", { backendNodeId: backendNodeIdOf(by.ref) })
        .pipe(Effect.mapError(refusedAs(goneRef(by.ref))));
      return;
    }
    const method = "Page.getLayoutMetrics";
    const { cssLayoutViewport } = yield* readMetrics(method, yield* page.send(method));
    const middle = { x: cssLayoutViewport.clientWidth / 2, y: cssLayoutViewport.clientHeight / 2 };
    yield* pointTo(page, cursor, BROWSER_CURSOR_KIND.MOVE, middle);
    yield* page.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: middle.x,
      y: middle.y,
      deltaX: by.deltaX ?? 0,
      deltaY: by.deltaY ?? 0,
    });
  });
}

/** Whether the page has finished loading; a page between documents has not. */
function loaded(page: Page) {
  const method = "Runtime.evaluate";
  return page.send(method, { expression: "document.readyState", returnByValue: true }).pipe(
    Effect.flatMap((answer) => readEvaluated(method, answer)),
    Effect.map(({ result }) => result.value === "complete"),
  );
}

/** Asks until the check says yes, a refusal read as not yet. */
function waitUntil(check: Effect.Effect<boolean, CdpFailure>) {
  const asked = check.pipe(
    Effect.catchTag("CdpFailure", (failure) =>
      failure.kind === CDP_FAILURE.REFUSED ? Effect.succeed(false) : Effect.fail(failure),
    ),
  );
  return Effect.asVoid(
    Effect.repeat(asked, { schedule: Schedule.spaced(WAIT_POLL), until: (ready) => ready }),
  );
}

/** How many bytes a base64 text carries. */
function bytesOf(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

/**
 * One capture of the visible page. Note that a refusal is asked again for a
 * moment, because a tab just opened refuses until it has drawn its first
 * frame (the Mac's view says it draws nothing yet), and that frame comes a
 * moment later.
 */
function capture(page: Page, params: CdpParams) {
  const method = "Page.captureScreenshot";
  return page.send(method, params).pipe(
    Effect.retry({
      schedule: Schedule.spaced(CAPTURE_RETRY),
      times: CAPTURE_RETRIES,
      while: (failure) => failure.kind === CDP_FAILURE.REFUSED,
    }),
    Effect.flatMap((answer) => readCaptured(method, answer)),
  );
}

/**
 * The visible page as a JPEG no longer than the longest side and no larger
 * than the byte cap, trying each quality in turn. The tab is brought to the
 * front first, because a tab behind another draws no frame to capture.
 * Note that the clip's scale multiplies the page's own pixel ratio, so the
 * ratio is read and divided out.
 */
function screenshot(cdp: CdpSession, page: Page) {
  return Effect.gen(function* () {
    yield* cdp.send({ method: "Target.activateTarget", params: { targetId: page.targetId } });
    const metrics = yield* readMetrics(
      "Page.getLayoutMetrics",
      yield* page.send("Page.getLayoutMetrics"),
    );
    const evaluated = yield* readEvaluated(
      "Runtime.evaluate",
      yield* page.send("Runtime.evaluate", {
        expression: "window.devicePixelRatio",
        returnByValue: true,
      }),
    );
    const ratio =
      typeof evaluated.result.value === "number" && evaluated.result.value > 0
        ? evaluated.result.value
        : 1;
    const view = metrics.cssVisualViewport;
    const longest = Math.max(view.clientWidth, view.clientHeight);
    if (longest <= 0)
      return yield* failed("the tab shows nothing to capture; it has no visible area");
    const scale = Math.min(1, BROWSER_SCREENSHOT.LONGEST_SIDE / (longest * ratio));
    const side = (css: number) =>
      Math.min(BROWSER_SCREENSHOT.LONGEST_SIDE, Math.max(1, Math.round(css * scale * ratio)));
    const clip = {
      x: view.pageX,
      y: view.pageY,
      width: view.clientWidth,
      height: view.clientHeight,
      scale,
    };
    for (const quality of BROWSER_SCREENSHOT.QUALITIES) {
      const { data } = yield* capture(page, {
        format: "jpeg",
        quality,
        clip,
        captureBeyondViewport: false,
      });
      if (bytesOf(data) <= BROWSER_SCREENSHOT.MAX_BYTES) {
        return {
          mime: BROWSER_SCREENSHOT.MIME,
          data,
          width: side(view.clientWidth),
          height: side(view.clientHeight),
        };
      }
    }
    return yield* failed(
      `the screenshot stayed over ${BROWSER_SCREENSHOT.MAX_BYTES} bytes at every quality; take a snapshot instead`,
    );
  });
}

/** The page's accessibility tree as text, with its address and title. */
function snapshot(cdp: CdpSession, page: Page) {
  return Effect.gen(function* () {
    const method = "Accessibility.getFullAXTree";
    const tree = snapshotTextOf(yield* page.send(method));
    if (tree === undefined) return yield* new CdpFailure({ kind: CDP_FAILURE.MALFORMED, method });
    const target = (yield* cdp.pages).find((listed) => listed.targetId === page.targetId);
    return {
      url: cutBrowserText(target?.url ?? "", BROWSER_AGENT_LIMITS.SHOWN_MAX_CHARS),
      title: cutBrowserText(target?.title ?? "", BROWSER_AGENT_LIMITS.SHOWN_MAX_CHARS),
      ...tree,
    };
  });
}

/** A console call's words: each argument as the console prints it, a string as it is. */
function wordsOfArgs(args: (typeof ConsoleCallSchema.Type)["args"]): string {
  return args
    .map((arg) => {
      if (typeof arg.value === "string") return arg.value;
      if (arg.value !== undefined) return JSON.stringify(arg.value);
      return arg.unserializableValue ?? arg.description ?? arg.type;
    })
    .join(" ");
}

/** A console message an event carries, with when it was made, or none for any other event. */
function consoleMessageOf(event: CdpEvent) {
  const max = BROWSER_AGENT_LIMITS.CONSOLE_MESSAGE_MAX_CHARS;
  if (event.method === "Runtime.consoleAPICalled") {
    const call = readConsoleCall(event.params);
    if (Result.isFailure(call)) return undefined;
    const level = CONSOLE_TYPE_LEVEL.get(call.success.type) ?? BROWSER_CONSOLE_LEVEL.LOG;
    const text = cutBrowserText(wordsOfArgs(call.success.args), max);
    return { at: call.success.timestamp, message: { level, text } };
  }
  if (event.method === "Log.entryAdded") {
    const read = readLogEntry(event.params);
    if (Result.isFailure(read)) return undefined;
    const { entry } = read.success;
    const level = LOG_LEVEL.get(entry.level) ?? BROWSER_CONSOLE_LEVEL.LOG;
    return { at: entry.timestamp, message: { level, text: cutBrowserText(entry.text, max) } };
  }
  return undefined;
}

/**
 * The page's latest console messages, oldest first. The browser keeps what a
 * page logged and replays it to a session that enables its runtime and its
 * log, before it answers the enable; the disables after are one more round
 * trip, by which every replayed message has reached the listener.
 */
function consoleOf(cdp: CdpSession, page: Page) {
  return Effect.scoped(
    Effect.gen(function* () {
      const heard: { readonly at: number; readonly message: BrowserConsoleMessage }[] = [];
      const own = Stream.filter(cdp.events, (event) => event.sessionId === page.sessionId);
      yield* Effect.forkScoped(
        Stream.runForEach(own, (event) =>
          Effect.sync(() => {
            const message = consoleMessageOf(event);
            if (message !== undefined) heard.push(message);
          }),
        ),
      );
      yield* Effect.yieldNow;
      for (const method of ["Runtime.enable", "Log.enable", "Runtime.disable", "Log.disable"]) {
        yield* page.send(method);
      }
      yield* Effect.yieldNow;
      const ordered = heard
        .toSorted((one, other) => one.at - other.at)
        .map(({ message }) => message);
      const max = BROWSER_AGENT_LIMITS.CONSOLE_MAX_MESSAGES;
      return { messages: ordered.slice(-max), truncated: ordered.length > max };
    }),
  );
}

/** The step an action on a tab answers, once the tab is reached. */
function onPage<R>(
  cdp: CdpSession,
  pages: Pages,
  page: Page,
  action: BrowserAgentAction,
  cursor: BrowserCursor<R> | undefined,
): Effect.Effect<BrowserAgentStep, ActionFailed | CdpFailure, R> {
  const tab = page.targetId;
  switch (action.action) {
    case BROWSER_AGENT_ACTION.NAVIGATE:
      return Effect.as(navigate(page, action.url), actedOn(action.action, tab));
    case BROWSER_AGENT_ACTION.BACK:
    case BROWSER_AGENT_ACTION.FORWARD:
      return Effect.as(
        stepHistory(page, action.action === BROWSER_AGENT_ACTION.BACK ? -1 : 1),
        actedOn(action.action, tab),
      );
    case BROWSER_AGENT_ACTION.CLICK: {
      const at =
        action.ref === undefined
          ? Effect.succeed({ x: action.x ?? 0, y: action.y ?? 0 })
          : pointOfRef(page, action.ref);
      return Effect.as(
        Effect.flatMap(at, (point) =>
          Effect.andThen(
            pointTo(page, cursor, BROWSER_CURSOR_KIND.CLICK, point),
            clickAt(page, point),
          ),
        ),
        actedOn(action.action, tab),
      );
    }
    case BROWSER_AGENT_ACTION.TYPE:
      return Effect.as(
        typeWithCursor(page, cursor, action.text, action.ref),
        actedOn(action.action, tab),
      );
    case BROWSER_AGENT_ACTION.KEY:
      return Effect.as(
        pressKey(page, action.key, action.modifiers ?? []),
        actedOn(action.action, tab),
      );
    case BROWSER_AGENT_ACTION.SCROLL:
      return Effect.as(scroll(page, action, cursor), actedOn(action.action, tab));
    case BROWSER_AGENT_ACTION.WAIT: {
      const ref = action.ref;
      const check =
        ref === undefined
          ? loaded(page)
          : Effect.map(quadsOf(page, ref), (quads) => quads.length > 0);
      return Effect.as(
        Effect.andThen(pages.settle(tab), waitUntil(check)),
        actedOn(action.action, tab),
      );
    }
    case BROWSER_AGENT_ACTION.SCREENSHOT:
      return Effect.map(screenshot(cdp, page), (image) => ({
        ...actedOn(BROWSER_AGENT_ACTION.SCREENSHOT, tab),
        image,
      }));
    case BROWSER_AGENT_ACTION.SNAPSHOT:
      return Effect.map(snapshot(cdp, page), (tree) => ({
        ...actedOn(BROWSER_AGENT_ACTION.SNAPSHOT, tab),
        ...tree,
      }));
    case BROWSER_AGENT_ACTION.CONSOLE:
      return Effect.map(consoleOf(cdp, page), (heard) => ({
        ...actedOn(BROWSER_AGENT_ACTION.CONSOLE, tab),
        ...heard,
      }));
    default:
      return failed(`${action.action} is not an action on a tab`);
  }
}

/**
 * Closes a tab, forgetting its session once it is gone. Note that the close
 * is sent here rather than through the session's `closePage`, because
 * Chrome may answer a target it could not close with `success: false`
 * rather than a refusal, and that answer has to be read.
 */
function closeTab(cdp: CdpSession, pages: Pages, tab: string) {
  return Effect.gen(function* () {
    const method = "Target.closeTarget";
    const gone = `there is no tab ${tab}; list the tabs to see which are open`;
    const answer = yield* cdp
      .send({ method, params: { targetId: tab } })
      .pipe(Effect.mapError(refusedAs(gone)));
    const { success } = yield* readClosed(method, answer);
    if (success === false) return yield* failed(gone);
    pages.forget(tab);
    return actedOn(BROWSER_AGENT_ACTION.CLOSE, tab);
  });
}

/**
 * The step an action answers, the tab it names or the one before it acted on
 * standing in for a tab it leaves out; where a `wait` follows it on that
 * tab, its navigations are heard from before it acts.
 */
function stepOf<R>(
  cdp: CdpSession,
  pages: Pages,
  action: BrowserAgentAction,
  tab: string | undefined,
  watched: boolean,
  cursor: BrowserCursor<R> | undefined,
): Effect.Effect<BrowserAgentStep, ActionFailed | CdpFailure, R> {
  if (action.action === BROWSER_AGENT_ACTION.LIST) {
    return Effect.map(cdp.pages, (listed) => ({
      action: action.action,
      status: BROWSER_STEP_STATUS.DONE,
      tabs: listed.slice(0, BROWSER_AGENT_LIMITS.MAX_TABS).map((page) => ({
        tab: page.targetId,
        url: cutBrowserText(page.url, BROWSER_AGENT_LIMITS.SHOWN_MAX_CHARS),
        title: cutBrowserText(page.title, BROWSER_AGENT_LIMITS.SHOWN_MAX_CHARS),
      })),
    }));
  }
  if (action.action === BROWSER_AGENT_ACTION.OPEN) {
    return Effect.map(cdp.openPage(action.url), (opened) => actedOn(action.action, opened));
  }
  if (tab === undefined) {
    return failed(
      "name the tab: no action before this one acted on a tab; list the tabs to find its id",
    );
  }
  if (action.action === BROWSER_AGENT_ACTION.CLOSE) {
    return closeTab(cdp, pages, tab);
  }
  return Effect.flatMap(pages.page(tab), (page) =>
    Effect.andThen(
      watched ? pages.watch(page) : Effect.void,
      onPage(cdp, pages, page, action, cursor),
    ),
  );
}

/** How long an action may take, and what is said when it takes longer. */
function boundOf(action: BrowserAgentAction): { readonly millis: number; readonly reason: string } {
  if (action.action !== BROWSER_AGENT_ACTION.WAIT) {
    const millis = BROWSER_AGENT_LIMITS.ACTION_TIMEOUT_MS;
    return { millis, reason: `${action.action} did not finish within ${millis / 1000} seconds` };
  }
  const millis = action.timeoutMs ?? BROWSER_AGENT_LIMITS.WAIT_DEFAULT_MS;
  const waited =
    action.ref === undefined
      ? "the page did not finish loading"
      : `${action.ref} did not show on the page`;
  return { millis, reason: `${waited} within ${millis / 1000} seconds` };
}

/** The step an action answers within its bound, or the failure that says why it could not. */
function boundedStep<R>(
  cdp: CdpSession,
  pages: Pages,
  action: BrowserAgentAction,
  tab: string | undefined,
  watched: boolean,
  cursor: BrowserCursor<R> | undefined,
) {
  const bound = boundOf(action);
  return stepOf(cdp, pages, action, tab, watched, cursor).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(bound.millis),
      orElse: () => failed(bound.reason),
    }),
    Effect.mapError((failure) =>
      failure instanceof CdpFailure ? wordsOfCdp(failure) : failure.reason,
    ),
  );
}

/** Whether an action may navigate its tab and a `wait` on that same tab comes right after it, which then waits out that navigation. */
function watchedFor(
  action: BrowserAgentAction,
  tab: string | undefined,
  next: BrowserAgentAction | undefined,
): boolean {
  if (!NAVIGATING_ACTIONS.has(action.action)) return false;
  if (action.action === BROWSER_AGENT_ACTION.KEY && action.key !== "Enter") return false;
  return next?.action === BROWSER_AGENT_ACTION.WAIT && (next.tab === undefined || next.tab === tab);
}

/** The tab a step leaves the next action on: the one it acted on, none once that is closed, and the one before for a list. */
function tabAfter(step: BrowserAgentStep, before: string | undefined): string | undefined {
  if (step.action === BROWSER_AGENT_ACTION.CLOSE) return undefined;
  return "tab" in step ? step.tab : before;
}

/**
 * Runs a sequence of actions on the browser, in order, up to the first that
 * fails: every step that ran, the failed one last, and how many never ran.
 * It never fails itself; a browser that cannot be reached is the session's
 * own failure, before any action. A cursor, where given, hears each move
 * of the agent's pointer just before its input (`BrowserCursor`).
 */
export function runBrowserActions<R = never>(
  cdp: CdpSession,
  actions: readonly BrowserAgentAction[],
  options: { readonly cursor?: BrowserCursor<R> } = {},
): Effect.Effect<BrowserAgentRun, never, R> {
  return Effect.scoped(
    Effect.gen(function* () {
      const pages = yield* pagesOver(cdp);
      const steps: BrowserAgentStep[] = [];
      let tab: string | undefined;
      for (const [at, action] of actions.entries()) {
        const named =
          action.action === BROWSER_AGENT_ACTION.LIST || action.action === BROWSER_AGENT_ACTION.OPEN
            ? undefined
            : (action.tab ?? tab);
        const watched = watchedFor(action, named, actions[at + 1]);
        const ran = yield* Effect.result(
          boundedStep(cdp, pages, action, named, watched, options.cursor),
        );
        if (Result.isFailure(ran)) {
          const error = cutBrowserText(ran.failure, BROWSER_AGENT_LIMITS.ERROR_MAX_CHARS);
          const failedOn = named === undefined ? {} : { tab: named };
          steps.push({
            action: action.action,
            status: BROWSER_STEP_STATUS.FAILED,
            ...failedOn,
            error,
          });
          break;
        }
        steps.push(ran.success);
        tab = tabAfter(ran.success, tab);
      }
      return { steps, skipped: actions.length - steps.length };
    }),
  );
}
