import { EXCESS_KEYS, type UnparsedWireValue, WireValueSchema } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
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
  BROWSER_KEPT_SCREENSHOT,
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
  type BrowserRecordingStopped,
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

const WAIT_POLL = Duration.millis(250);

export const BROWSER_CURSOR_BEAT = Duration.millis(250);

export const BROWSER_RECORDING_POINTER_MARK = "agent.recordingCursor";

const DRAWS_RECORDING_POINTER = `window[Symbol.for(${JSON.stringify(BROWSER_RECORDING_POINTER_MARK)})] === true`;

const CURSOR_REPORT_TIMEOUT = Duration.seconds(1);

export interface BrowserCursor<R = never> {
  readonly report: (move: BrowserCursorMove) => Effect.Effect<void, never, R>;
  readonly watched: boolean;
}

export interface BrowserRecorder<R = never> {
  readonly start: Effect.Effect<number, string, R>;
  readonly stop: (
    caption: string | undefined,
  ) => Effect.Effect<Omit<BrowserRecordingStopped, "action" | "status">, string, R>;
}

export interface BrowserRunOptions<R = never> {
  readonly cursor?: BrowserCursor<R>;
  readonly keepScreenshots?: boolean;
  readonly recorder?: BrowserRecorder<R>;
}

const NO_RECORDER = "this browser cannot record a video";

function recordingStep<R>(
  action: Extract<
    BrowserAgentAction,
    {
      readonly action:
        | typeof BROWSER_AGENT_ACTION.RECORD
        | typeof BROWSER_AGENT_ACTION.STOP_RECORDING;
    }
  >,
  recorder: BrowserRecorder<R> | undefined,
): Effect.Effect<BrowserAgentStep, ActionFailed, R> {
  if (recorder === undefined) return failed(NO_RECORDER);
  const refused = (reason: string) => new ActionFailed({ reason });
  if (action.action === BROWSER_AGENT_ACTION.RECORD) {
    return recorder.start.pipe(
      Effect.map((maxSeconds) => ({
        action: action.action,
        status: BROWSER_STEP_STATUS.DONE,
        maxSeconds,
      })),
      Effect.mapError(refused),
    );
  }
  return recorder.stop(action.caption).pipe(
    Effect.map((stopped) => ({
      action: action.action,
      status: BROWSER_STEP_STATUS.DONE,
      ...stopped,
    })),
    Effect.mapError(refused),
  );
}

const NAVIGATION_GRACE = Duration.millis(500);

const CAPTURE_RETRY = Duration.millis(250);
const CAPTURE_RETRIES = 8;

const NAVIGATING_ACTIONS: ReadonlySet<BrowserAgentActionName> = new Set([
  BROWSER_AGENT_ACTION.NAVIGATE,
  BROWSER_AGENT_ACTION.BACK,
  BROWSER_AGENT_ACTION.FORWARD,
  BROWSER_AGENT_ACTION.CLICK,
  BROWSER_AGENT_ACTION.SELECT,
  BROWSER_AGENT_ACTION.KEY,
]);

const SELECT_CLASS = "HTMLSelectElement";

const CHOICE = {
  CHOSEN: "chosen",
  UNMATCHED: "unmatched",
  DISABLED: "disabled",
  NOT_SELECT: "not-select",
} as const;

const CHOOSE_OPTION = `function (wanted) {
  if (!(this instanceof HTMLSelectElement)) return { kind: ${JSON.stringify(CHOICE.NOT_SELECT)} };
  const options = Array.from(this.options);
  const chosen = options.find((option) => option.label === wanted) ?? options.find((option) => option.value === wanted);
  if (chosen === undefined) return { kind: ${JSON.stringify(CHOICE.UNMATCHED)}, labels: options.map((option) => option.label) };
  if (this.matches(":disabled") || chosen.matches(":disabled")) return { kind: ${JSON.stringify(CHOICE.DISABLED)} };
  for (const option of options) option.selected = option === chosen;
  this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
  const now = Array.from(this.options).find((option) => option.selected);
  return { kind: ${JSON.stringify(CHOICE.CHOSEN)}, label: now === undefined ? "" : now.label, value: now === undefined ? "" : now.value };
}`;

const NAVIGATION_EVENT = {
  STARTED: "Page.frameStartedLoading",
  NAVIGATED: "Page.frameNavigated",
  STOPPED: "Page.frameStoppedLoading",
  DETACHED: "Page.frameDetached",
  LOADED: "Page.loadEventFired",
} as const;

const DETACH_TIMEOUT = Duration.seconds(2);

const MODIFIER_BITS = {
  [BROWSER_MODIFIER.ALT]: 1,
  [BROWSER_MODIFIER.CONTROL]: 2,
  [BROWSER_MODIFIER.META]: 4,
  [BROWSER_MODIFIER.SHIFT]: 8,
} as const;

const SHORTCUT_MODIFIERS: ReadonlySet<string> = new Set([
  BROWSER_MODIFIER.ALT,
  BROWSER_MODIFIER.CONTROL,
  BROWSER_MODIFIER.META,
]);

const NAMED_KEYS: ReadonlyMap<string, (typeof BROWSER_KEYS)[keyof typeof BROWSER_KEYS]> = new Map(
  Object.entries(BROWSER_KEYS),
);

const CONSOLE_TYPE_LEVEL: ReadonlyMap<string, BrowserConsoleMessage["level"]> = new Map([
  ["debug", BROWSER_CONSOLE_LEVEL.DEBUG],
  ["info", BROWSER_CONSOLE_LEVEL.INFO],
  ["warning", BROWSER_CONSOLE_LEVEL.WARNING],
  ["error", BROWSER_CONSOLE_LEVEL.ERROR],
  ["assert", BROWSER_CONSOLE_LEVEL.ERROR],
]);

const LOG_LEVEL: ReadonlyMap<string, BrowserConsoleMessage["level"]> = new Map([
  ["verbose", BROWSER_CONSOLE_LEVEL.DEBUG],
  ["info", BROWSER_CONSOLE_LEVEL.INFO],
  ["warning", BROWSER_CONSOLE_LEVEL.WARNING],
  ["error", BROWSER_CONSOLE_LEVEL.ERROR],
]);

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
const ResolvedSchema = Schema.Struct({
  object: Schema.Struct({ objectId: Schema.String, className: Schema.optional(Schema.String) }),
});
const ChoiceSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal(CHOICE.CHOSEN),
    label: Schema.String,
    value: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal(CHOICE.UNMATCHED), labels: Schema.Array(Schema.String) }),
  Schema.Struct({ kind: Schema.Literals([CHOICE.DISABLED, CHOICE.NOT_SELECT]) }),
]);
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
const FrameEventSchema = Schema.Struct({
  frameId: Schema.optional(Schema.String),
  frame: Schema.optional(Schema.Struct({ id: Schema.String })),
});

const readConsoleCall = readEither(ConsoleCallSchema, { excess: EXCESS_KEYS.DROP });
const readLogEntry = readEither(LogEntrySchema, { excess: EXCESS_KEYS.DROP });
const readFrameEvent = readEither(FrameEventSchema, { excess: EXCESS_KEYS.DROP });
const readPoint = readEither(PointSchema, { excess: EXCESS_KEYS.DROP });
const readChoice = readEither(ChoiceSchema, { excess: EXCESS_KEYS.DROP });

const FOCUSED_POINT = `(() => {
  const focused = document.activeElement;
  if (focused === null || focused === document.body) return null;
  const box = focused.getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
})()`;

const TAKES_TEXT = `(() => {
  let focused = document.activeElement;
  for (;;) {
    if (focused === null) return false;
    if (focused.shadowRoot && focused.shadowRoot.activeElement) {
      focused = focused.shadowRoot.activeElement;
      continue;
    }
    if (focused.tagName !== "IFRAME" && focused.tagName !== "FRAME") break;
    let inner;
    try { inner = focused.contentDocument; } catch { inner = null; }
    if (!inner) return true;
    focused = inner.activeElement;
    if (focused === null || focused === inner.body) return false;
  }
  if (focused === document.body) return false;
  if (focused.isContentEditable) return true;
  if (focused.tagName.includes("-") && focused.shadowRoot === null) return true;
  const textless = ["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"];
  if (focused.tagName === "INPUT" && textless.includes(focused.type)) return false;
  if (focused.tagName !== "INPUT" && focused.tagName !== "TEXTAREA") return false;
  return !focused.readOnly && !focused.disabled;
})()`;

const COVERED_BY = `function (x, y) {
  if (window !== window.top) return "";
  let hit = document.elementFromPoint(x, y);
  while (hit !== null && hit.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (inner === null || inner === hit) break;
    hit = inner;
  }
  if (hit === null) return "";
  for (let node = hit; node; node = node.parentNode || node.host) if (node === this) return "";
  const label = hit.closest("label");
  if (label !== null && label.control === this) return "";
  return hit.tagName.toLowerCase();
}`;

function answerOf<S extends Schema.ConstraintDecoder<unknown>>(schema: S) {
  const read = readEither(schema, { excess: EXCESS_KEYS.DROP });
  return (method: string, value: UnparsedWireValue): Effect.Effect<S["Type"], CdpFailure> => {
    const result = read(value);
    return Result.isFailure(result)
      ? Effect.fail(new CdpFailure({ kind: CDP_FAILURE.MALFORMED, method }))
      : Effect.succeed(result.success);
  };
}

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

const refusedAs = (reason: string) => (failure: CdpFailure) =>
  failure.kind === CDP_FAILURE.REFUSED ? new ActionFailed({ reason }) : failure;

const refusedSaying = (reason: string) => (failure: CdpFailure) =>
  failure.kind === CDP_FAILURE.REFUSED
    ? new ActionFailed({
        reason:
          failure.detail === undefined ? reason : `${reason} (the browser said: ${failure.detail})`,
      })
    : failure;

const goneRef = (ref: string) =>
  `${ref} is not on the page any more; take a new snapshot for the refs that are`;

interface Page {
  readonly targetId: string;
  readonly sessionId: string;
  readonly send: (
    method: string,
    params?: CdpParams,
  ) => Effect.Effect<UnparsedWireValue, CdpFailure>;
}

interface Pages {
  readonly page: (targetId: string) => Effect.Effect<Page, ActionFailed | CdpFailure>;
  readonly forget: (targetId: string) => void;
  readonly watch: (page: Page) => Effect.Effect<void>;
  readonly settle: (targetId: string) => Effect.Effect<void>;
}

interface Watched {
  readonly targetId: string;
  readonly started: Deferred.Deferred<void>;
  readonly settled: Deferred.Deferred<void>;
}

const readAttached = answerOf(AttachedSchema);

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

function settleWatched(watched: Watched) {
  return Deferred.await(watched.started).pipe(
    Effect.timeoutOption(NAVIGATION_GRACE),
    Effect.flatMap((started) =>
      Option.isSome(started) ? Deferred.await(watched.settled) : Effect.void,
    ),
  );
}

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
        yield* Effect.ignore(
          cdp.send({
            method: "Emulation.setFocusEmulationEnabled",
            params: { enabled: true },
            sessionId,
          }),
        );
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
const readResolved = answerOf(ResolvedSchema);

function navigate(page: Page, url: string) {
  return Effect.gen(function* () {
    const method = "Page.navigate";
    const { errorText } = yield* readNavigated(method, yield* page.send(method, { url }));
    if (errorText !== undefined && errorText !== "") {
      return yield* failed(`the page at ${url} did not load: ${errorText}`);
    }
  });
}

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

function quadsOf(page: Page, ref: string) {
  const method = "DOM.getContentQuads";
  return page.send(method, { backendNodeId: backendNodeIdOf(ref) }).pipe(
    Effect.flatMap((answer) => readQuads(method, answer)),
    Effect.map(({ quads }) => quads.filter((quad) => quad.length === 8)),
  );
}

function pointOfRef(page: Page, ref: string) {
  return Effect.gen(function* () {
    yield* page
      .send("DOM.scrollIntoViewIfNeeded", { backendNodeId: backendNodeIdOf(ref) })
      .pipe(Effect.mapError(refusedSaying(goneRef(ref))));
    const [quad] = yield* quadsOf(page, ref).pipe(
      Effect.mapError(refusedSaying(`${ref} is not drawn on the page; it may be hidden`)),
    );
    if (quad === undefined) {
      return yield* failed(`${ref} is not drawn on the page; it may be hidden`);
    }
    const xs = [quad[0] ?? 0, quad[2] ?? 0, quad[4] ?? 0, quad[6] ?? 0];
    const ys = [quad[1] ?? 0, quad[3] ?? 0, quad[5] ?? 0, quad[7] ?? 0];
    return { x: xs.reduce((sum, x) => sum + x, 0) / 4, y: ys.reduce((sum, y) => sum + y, 0) / 4 };
  });
}

function mouseAt(page: Page, point: { readonly x: number; readonly y: number }, type: string) {
  const moved = type === "mouseMoved";
  return page.send("Input.dispatchMouseEvent", {
    type,
    x: point.x,
    y: point.y,
    button: moved ? "none" : "left",
    buttons: type === "mousePressed" ? 1 : 0,
    clickCount: moved ? 0 : 1,
  });
}

function pressAt(page: Page, point: { readonly x: number; readonly y: number }) {
  return Effect.andThen(
    mouseAt(page, point, "mousePressed"),
    mouseAt(page, point, "mouseReleased"),
  );
}

function drawsRecordingPointer(page: Page) {
  const method = "Runtime.evaluate";
  const asked = page
    .send(method, { expression: DRAWS_RECORDING_POINTER, returnByValue: true })
    .pipe(Effect.flatMap((answer) => readEvaluated(method, answer)));
  return Effect.map(Effect.timeoutOption(Effect.option(asked), CURSOR_REPORT_TIMEOUT), (answer) =>
    Option.exists(Option.flatten(answer), ({ result }) => result.value === true),
  );
}

function clickAt<R>(
  page: Page,
  cursor: BrowserCursor<R> | undefined,
  point: { readonly x: number; readonly y: number },
) {
  return Effect.gen(function* () {
    const heard =
      cursor === undefined
        ? false
        : yield* reportPoint(page, cursor, BROWSER_CURSOR_KIND.CLICK, point);
    yield* mouseAt(page, point, "mouseMoved");
    if (cursor !== undefined && (heard || (yield* drawsRecordingPointer(page)))) {
      yield* Effect.sleep(BROWSER_CURSOR_BEAT);
    }
    yield* pressAt(page, point);
  });
}

function assertUncovered(
  page: Page,
  ref: string,
  point: { readonly x: number; readonly y: number },
) {
  return Effect.gen(function* () {
    const covered = yield* Effect.option(
      Effect.gen(function* () {
        const resolve = "DOM.resolveNode";
        const resolved = yield* readResolved(
          resolve,
          yield* page.send(resolve, { backendNodeId: backendNodeIdOf(ref) }),
        );
        const call = "Runtime.callFunctionOn";
        const { result } = yield* readEvaluated(
          call,
          yield* page.send(call, {
            objectId: resolved.object.objectId,
            functionDeclaration: COVERED_BY,
            arguments: [{ value: point.x }, { value: point.y }],
            returnByValue: true,
          }),
        );
        return result.value;
      }),
    );
    const by = Option.getOrUndefined(covered);
    if (typeof by === "string" && by !== "") {
      return yield* failed(
        `${ref} is covered at its middle by a ${by}, which would take the click; close or scroll past what covers it, then take a new snapshot`,
      );
    }
  });
}

function takesText(page: Page) {
  const method = "Runtime.evaluate";
  return page.send(method, { expression: TAKES_TEXT, returnByValue: true }).pipe(
    Effect.flatMap((answer) => readEvaluated(method, answer)),
    Effect.map(({ result }) => result.value !== false),
    Effect.orElseSucceed(() => true),
  );
}

function typeText(page: Page, text: string, ref: string | undefined) {
  return Effect.gen(function* () {
    if (ref !== undefined) {
      yield* page
        .send("DOM.focus", { backendNodeId: backendNodeIdOf(ref) })
        .pipe(
          Effect.mapError(refusedSaying(`${ref} cannot take the focus; click it, or name a field`)),
        );
    }
    if (!(yield* takesText(page))) {
      return yield* failed(
        ref === undefined
          ? "nothing that takes text has the focus, so the text would go nowhere; name the field's ref, or click the field first"
          : `${ref} does not take text; name a text field's ref`,
      );
    }
    yield* page.send("Input.insertText", { text });
  });
}

function reportPoint<R>(
  page: Page,
  cursor: BrowserCursor<R>,
  kind: BrowserCursorKind,
  point: { readonly x: number; readonly y: number },
) {
  const reported = Effect.gen(function* () {
    const method = "Page.getLayoutMetrics";
    const metrics = yield* Effect.option(
      Effect.flatMap(page.send(method), (answer) => readMetrics(method, answer)),
    );
    if (Option.isNone(metrics)) return false;
    const view = metrics.value.cssVisualViewport;
    yield* cursor.report({
      tab: page.targetId,
      x: point.x,
      y: point.y,
      kind,
      viewport: { width: view.clientWidth, height: view.clientHeight },
      at: yield* Clock.currentTimeMillis,
    });
    return true;
  });
  return Effect.map(
    Effect.timeoutOption(reported, CURSOR_REPORT_TIMEOUT),
    (made) => cursor.watched && Option.getOrElse(made, () => false),
  );
}

function pointTo<R>(
  page: Page,
  cursor: BrowserCursor<R> | undefined,
  kind: BrowserCursorKind,
  point: { readonly x: number; readonly y: number },
) {
  if (cursor === undefined) return Effect.void;
  return Effect.flatMap(reportPoint(page, cursor, kind, point), (heard) =>
    heard ? Effect.sleep(BROWSER_CURSOR_BEAT) : Effect.void,
  );
}

function typingPointOf(page: Page, ref: string | undefined) {
  const method = "Runtime.evaluate";
  const found: Effect.Effect<{ readonly x: number; readonly y: number }, unknown> =
    ref !== undefined
      ? pointOfRef(page, ref)
      : page.send(method, { expression: FOCUSED_POINT, returnByValue: true }).pipe(
          Effect.flatMap((answer) => readEvaluated(method, answer)),
          Effect.flatMap(({ result }) => {
            const point = readPoint(result.value ?? null);
            return Result.isSuccess(point) ? Effect.succeed(point.success) : Effect.fail("none");
          }),
        );
  return Effect.map(
    Effect.timeoutOption(Effect.option(found), CURSOR_REPORT_TIMEOUT),
    Option.flatten,
  );
}

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

const optionWords = (text: string) => cutBrowserText(text, BROWSER_AGENT_LIMITS.OPTION_MAX_CHARS);

function choose<R>(page: Page, cursor: BrowserCursor<R> | undefined, ref: string, wanted: string) {
  return Effect.gen(function* () {
    const resolve = "DOM.resolveNode";
    const { object } = yield* page.send(resolve, { backendNodeId: backendNodeIdOf(ref) }).pipe(
      Effect.mapError(refusedAs(goneRef(ref))),
      Effect.flatMap((answer) => readResolved(resolve, answer)),
    );
    const notSelect = `${ref} is not a dropdown (a native select); click it, or take a new snapshot for the select's ref`;
    if (object.className !== SELECT_CLASS) return yield* failed(notSelect);
    if (cursor !== undefined) {
      const point = yield* typingPointOf(page, ref);
      if (Option.isSome(point))
        yield* pointTo(page, cursor, BROWSER_CURSOR_KIND.CLICK, point.value);
    }
    const call = "Runtime.callFunctionOn";
    const { result } = yield* page
      .send(call, {
        objectId: object.objectId,
        functionDeclaration: CHOOSE_OPTION,
        arguments: [{ value: wanted }],
        returnByValue: true,
      })
      .pipe(
        Effect.mapError(refusedAs(goneRef(ref))),
        Effect.flatMap((answer) => readEvaluated(call, answer)),
      );
    const read = readChoice(result.value ?? null);
    if (Result.isFailure(read))
      return yield* new CdpFailure({ kind: CDP_FAILURE.MALFORMED, method: call });
    const choice = read.success;
    switch (choice.kind) {
      case CHOICE.CHOSEN:
        return { label: optionWords(choice.label), value: optionWords(choice.value) };
      case CHOICE.UNMATCHED: {
        const labels = choice.labels
          .map((label) =>
            JSON.stringify(cutBrowserText(label, BROWSER_AGENT_LIMITS.SNAPSHOT_NAME_MAX_CHARS)),
          )
          .join(", ");
        return yield* failed(
          `${ref} has no option labeled or valued ${JSON.stringify(wanted)}; its options are ${labels === "" ? "none" : labels}`,
        );
      }
      case CHOICE.DISABLED:
        return yield* failed(`${ref} or its option ${JSON.stringify(wanted)} is disabled`);
      case CHOICE.NOT_SELECT:
        return yield* failed(notSelect);
    }
  });
}

function keyOf(key: string, shifted: boolean) {
  const named = NAMED_KEYS.get(key);
  if (named !== undefined) return { key: named.text === " " ? " " : key, ...named };
  const upper = key.toUpperCase();
  if (/^[A-Z]$/u.test(upper)) {
    const letter = shifted ? upper : key;
    return { key: letter, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: letter };
  }
  if (/^\d$/u.test(key)) return { key, code: `Digit${key}`, keyCode: key.charCodeAt(0), text: key };
  return { key, code: "", keyCode: 0, text: key };
}

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

function scroll<R>(
  page: Page,
  by: { readonly deltaX?: number; readonly deltaY?: number; readonly ref?: string },
  cursor: BrowserCursor<R> | undefined,
) {
  return Effect.gen(function* () {
    if (by.ref !== undefined) {
      yield* page
        .send("DOM.scrollIntoViewIfNeeded", { backendNodeId: backendNodeIdOf(by.ref) })
        .pipe(Effect.mapError(refusedSaying(goneRef(by.ref))));
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

function loaded(page: Page) {
  const method = "Runtime.evaluate";
  return page.send(method, { expression: "document.readyState", returnByValue: true }).pipe(
    Effect.flatMap((answer) => readEvaluated(method, answer)),
    Effect.map(({ result }) => result.value === "complete"),
  );
}

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

function bytesOf(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

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

function clipAt(
  view: {
    readonly pageX: number;
    readonly pageY: number;
    readonly clientWidth: number;
    readonly clientHeight: number;
  },
  ratio: number,
  longestSide: number,
) {
  const longest = Math.max(view.clientWidth, view.clientHeight);
  const scale = Math.min(1, longestSide / (longest * ratio));
  const side = (css: number) => Math.min(longestSide, Math.max(1, Math.round(css * scale * ratio)));
  return {
    clip: {
      x: view.pageX,
      y: view.pageY,
      width: view.clientWidth,
      height: view.clientHeight,
      scale,
    },
    width: side(view.clientWidth),
    height: side(view.clientHeight),
  };
}

type ScreenshotClip = ReturnType<typeof clipAt>;

function keptScreenshot(page: Page, clip: ScreenshotClip["clip"], width: number, height: number) {
  return Effect.gen(function* () {
    const png = yield* capture(page, { format: "png", clip, captureBeyondViewport: false });
    for (const quality of BROWSER_KEPT_SCREENSHOT.QUALITIES) {
      const jpeg = yield* capture(page, {
        format: "jpeg",
        quality,
        clip,
        captureBeyondViewport: false,
      });
      const smaller =
        bytesOf(png.data) < bytesOf(jpeg.data)
          ? { mime: BROWSER_KEPT_SCREENSHOT.PNG, data: png.data }
          : { mime: BROWSER_KEPT_SCREENSHOT.JPEG, data: jpeg.data };
      if (bytesOf(smaller.data) <= BROWSER_KEPT_SCREENSHOT.MAX_BYTES) {
        return { ...smaller, width, height };
      }
    }
    return undefined;
  }).pipe(Effect.orElseSucceed(() => undefined));
}

function screenshot(cdp: CdpSession, page: Page, keep: boolean) {
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
    if (Math.max(view.clientWidth, view.clientHeight) <= 0)
      return yield* failed("the tab shows nothing to capture; it has no visible area");
    const shown = clipAt(view, ratio, BROWSER_SCREENSHOT.LONGEST_SIDE);
    for (const quality of BROWSER_SCREENSHOT.QUALITIES) {
      const { data } = yield* capture(page, {
        format: "jpeg",
        quality,
        clip: shown.clip,
        captureBeyondViewport: false,
      });
      if (bytesOf(data) > BROWSER_SCREENSHOT.MAX_BYTES) continue;
      const image = {
        mime: BROWSER_SCREENSHOT.MIME,
        data,
        width: shown.width,
        height: shown.height,
      };
      if (!keep) return { image };
      const full = clipAt(view, ratio, BROWSER_KEPT_SCREENSHOT.LONGEST_SIDE);
      const kept = yield* keptScreenshot(page, full.clip, full.width, full.height);
      return kept === undefined ? { image } : { image, kept };
    }
    return yield* failed(
      `the screenshot stayed over ${BROWSER_SCREENSHOT.MAX_BYTES} bytes at every quality; take a snapshot instead`,
    );
  });
}

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

function wordsOfArgs(args: (typeof ConsoleCallSchema.Type)["args"]): string {
  return args
    .map((arg) => {
      if (typeof arg.value === "string") return arg.value;
      if (arg.value !== undefined) return JSON.stringify(arg.value);
      return arg.unserializableValue ?? arg.description ?? arg.type;
    })
    .join(" ");
}

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

function onPage<R>(
  cdp: CdpSession,
  pages: Pages,
  page: Page,
  action: BrowserAgentAction,
  run: BrowserRunOptions<R>,
): Effect.Effect<BrowserAgentStep, ActionFailed | CdpFailure, R> {
  const cursor = run.cursor;
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
      const ref = action.ref;
      const at =
        ref === undefined
          ? Effect.succeed({ x: action.x ?? 0, y: action.y ?? 0 })
          : Effect.tap(pointOfRef(page, ref), (point) => assertUncovered(page, ref, point));
      return Effect.as(
        Effect.flatMap(at, (point) => clickAt(page, cursor, point)),
        actedOn(action.action, tab),
      );
    }
    case BROWSER_AGENT_ACTION.TYPE:
      return Effect.as(
        typeWithCursor(page, cursor, action.text, action.ref),
        actedOn(action.action, tab),
      );
    case BROWSER_AGENT_ACTION.SELECT:
      return Effect.map(choose(page, cursor, action.ref, action.option), (chosen) => ({
        ...actedOn(BROWSER_AGENT_ACTION.SELECT, tab),
        ...chosen,
      }));
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
      return Effect.map(screenshot(cdp, page, run.keepScreenshots === true), (pictures) => ({
        ...actedOn(BROWSER_AGENT_ACTION.SCREENSHOT, tab),
        ...pictures,
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

export function isRecordingAction(action: BrowserAgentAction): action is Extract<
  BrowserAgentAction,
  {
    readonly action:
      | typeof BROWSER_AGENT_ACTION.RECORD
      | typeof BROWSER_AGENT_ACTION.STOP_RECORDING;
  }
> {
  return (
    action.action === BROWSER_AGENT_ACTION.RECORD ||
    action.action === BROWSER_AGENT_ACTION.STOP_RECORDING
  );
}

function stepOf<R>(
  cdp: CdpSession,
  pages: Pages,
  action: BrowserAgentAction,
  tab: string | undefined,
  watched: boolean,
  run: BrowserRunOptions<R>,
): Effect.Effect<BrowserAgentStep, ActionFailed | CdpFailure, R> {
  if (isRecordingAction(action)) return recordingStep(action, run.recorder);
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
      onPage(cdp, pages, page, action, run),
    ),
  );
}

function boundOf(action: BrowserAgentAction): { readonly millis: number; readonly reason: string } {
  if (action.action === BROWSER_AGENT_ACTION.STOP_RECORDING) {
    const millis = BROWSER_AGENT_LIMITS.RECORDING_STOP_TIMEOUT_MS;
    return { millis, reason: `the recording was not kept within ${millis / 1000} seconds` };
  }
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

function boundedStep<R>(
  cdp: CdpSession,
  pages: Pages,
  action: BrowserAgentAction,
  tab: string | undefined,
  watched: boolean,
  run: BrowserRunOptions<R>,
) {
  const bound = boundOf(action);
  return stepOf(cdp, pages, action, tab, watched, run).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(bound.millis),
      orElse: () => failed(bound.reason),
    }),
    Effect.mapError((failure) =>
      failure instanceof CdpFailure ? wordsOfCdp(failure) : failure.reason,
    ),
  );
}

function watchedFor(
  action: BrowserAgentAction,
  tab: string | undefined,
  next: BrowserAgentAction | undefined,
): boolean {
  if (!NAVIGATING_ACTIONS.has(action.action)) return false;
  if (action.action === BROWSER_AGENT_ACTION.KEY && action.key !== "Enter") return false;
  return next?.action === BROWSER_AGENT_ACTION.WAIT && (next.tab === undefined || next.tab === tab);
}

function tabAfter(step: BrowserAgentStep, before: string | undefined): string | undefined {
  if (step.action === BROWSER_AGENT_ACTION.CLOSE) return undefined;
  return "tab" in step ? step.tab : before;
}

export function runBrowserActions<R = never>(
  cdp: CdpSession,
  actions: readonly BrowserAgentAction[],
  options: BrowserRunOptions<R> = {},
): Effect.Effect<BrowserAgentRun, never, R> {
  return Effect.scoped(
    Effect.gen(function* () {
      const pages = yield* pagesOver(cdp);
      const steps: BrowserAgentStep[] = [];
      let tab: string | undefined;
      for (const [at, action] of actions.entries()) {
        const named =
          action.action === BROWSER_AGENT_ACTION.LIST ||
          action.action === BROWSER_AGENT_ACTION.OPEN ||
          isRecordingAction(action)
            ? undefined
            : (action.tab ?? tab);
        const watched = watchedFor(action, named, actions[at + 1]);
        const ran = yield* Effect.result(boundedStep(cdp, pages, action, named, watched, options));
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
