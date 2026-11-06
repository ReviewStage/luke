import type { DatabaseServices } from "@repo/database/core/query";
import {
  type AgentBrowserTabRow,
  browserTabDriver,
  closeBrowserTab,
  listAgentBrowserTabs,
  pointBrowserTab,
  upsertBrowserTab,
} from "@repo/database/models/agent-browser-tabs";
import { keepConversationPicture } from "@repo/database/models/conversation-pictures";
import { sandboxHeld } from "@repo/database/models/sandbox-terminal-lease";
import type { TaskStoreFailure } from "@repo/database/models/task-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { AGENT_BROWSER_TAB_OPENER } from "@repo/features/agent-browser-tab-wire";
import {
  BROWSER_AGENT_ACTION,
  BROWSER_AGENT_LIMITS,
  BROWSER_STEP_STATUS,
  type BrowserAgentAction,
  type BrowserAgentStep,
  type BrowserKeptScreenshot,
  browserAgentActionsSchema,
  cutBrowserText,
} from "@repo/features/browser-agent-actions";
import {
  type BrowserCursor,
  type BrowserRecorder,
  isRecordingAction,
  runBrowserActions,
} from "@repo/features/browser-agent-cdp";
import type { CdpSession, PageTarget } from "@repo/features/browser-cdp";
import {
  CONVERSATION_MEDIA_TYPE,
  CONVERSATION_PICTURE_BOUNDS,
  type KeptPicture,
  PICTURE_OMISSION,
  type PictureOmission,
} from "@repo/features/conversation-picture-wire";
import { imageDimensions, sniffImageType } from "@repo/features/image-signature";
import { webmDimensions } from "@repo/features/video-signature";
import { isRecord, type UnparsedWireValue, unparsedWire } from "@repo/wire";
import { describeWire, readEither } from "@repo/wire/effect";
import { DateTime, Duration, Effect, Option, Result, Schema } from "effect";
import { logStoreFailure } from "../../http/store-failure.js";
import { AGENT_TOOL } from "../agent-runtime/tools.js";
import { AgentBrowser, type BrowserUnreachable } from "./agent-browser.js";
import { connectRestoring } from "./restore-tabs.js";
import { RECORDING_FAILURE, RECORDING_START_EXIT } from "./sandbox-recorder.js";

const BROWSER_INPUT = Schema.Struct({
  actions: describeWire(
    browserAgentActionsSchema,
    `The actions to take, in order, 1 to ${BROWSER_AGENT_LIMITS.MAX_ACTIONS}; the call stops at the first that fails.`,
  ),
});

const readInput = readEither(BROWSER_INPUT);

export const BROWSER_TOOL = {
  name: AGENT_TOOL.BROWSER,
  description:
    "Drive a real browser, a Chromium in your own sandbox, whose tabs the developer can watch " +
    "and take over in the Browser tab beside the description. Your own dev server is at localhost " +
    "there, such as http://localhost:3000/. Each call takes up to " +
    `${BROWSER_AGENT_LIMITS.MAX_ACTIONS} actions, run in order: list the tabs, open one at an ` +
    "address, navigate, go back or forward, click, type, choose an option in a dropdown, press " +
    "a key, scroll, wait, take a screenshot to see the page, take a snapshot to read it as " +
    "text with a ref beside each element, read its console, or close it. To show the developer " +
    "a flow you built or tested, record it: record starts a video of whatever the browser shows, " +
    "your pointer drawn on the page while it records, " +
    `up to ${BROWSER_AGENT_LIMITS.RECORDING_MAX_SECONDS} seconds and across calls, and ` +
    "stop_recording, with a caption, stops it and keeps it in your transcript, where it plays; " +
    "stop it before your turn ends, or it is lost. Its answer names the path the video stays at in " +
    "your sandbox until your next recording, by which you can post it to a thread. Take a snapshot for " +
    "the refs before you click or type on an element. Choose in a native dropdown, a select " +
    "the snapshot shows as a combobox or listbox, with select on its ref and the option's " +
    "label, rather than clicking it or its options, whose popup no click reaches. An action that leaves out its tab acts on the tab the action before " +
    "it acted on in the same call only, so open and go on in one call; a new call names its " +
    "tab. While the developer drives a tab, actions on " +
    "it are refused until they hand it back: wait, or ask them. You may find a tab the " +
    "developer opened in your browser, such as one they signed in on for you, which the tabs " +
    "answered say they opened: use it once they hand it back. Answers each step that ran and " +
    "the tabs it acted on as they now stand, or `not-run` and why, such as the browser not " +
    "being reachable.",
  inputSchema: BROWSER_INPUT,
} as const;

export const BROWSER_TOOL_STATUS = {
  RAN: "ran",
  NOT_RUN: "not-run",
} as const;

type ShownTab = {
  readonly tab: string;
  readonly url: string;
  readonly title: string;
  readonly openedBy?: typeof AGENT_BROWSER_TAB_OPENER.MEMBER;
};

type ScreenshotStep = Extract<
  BrowserAgentStep,
  { readonly action: typeof BROWSER_AGENT_ACTION.SCREENSHOT; readonly status: "done" }
>;

type KeptNote =
  | { readonly picture: { readonly [Key in keyof KeptPicture]: KeptPicture[Key] } }
  | { readonly omitted: PictureOmission; readonly byteCount: number };

type BrowserToolStep =
  | Exclude<BrowserAgentStep, ScreenshotStep>
  | (Omit<ScreenshotStep, "kept"> & (KeptNote | Record<never, never>));

export type BrowserToolResult =
  | {
      readonly status: typeof BROWSER_TOOL_STATUS.RAN;
      readonly steps: readonly BrowserToolStep[];
      readonly skipped: number;
      readonly tabs: readonly ShownTab[];
    }
  | { readonly status: typeof BROWSER_TOOL_STATUS.NOT_RUN; readonly reason: string };

const BLANK_ADDRESS = "about:blank";

const MOVING_ACTIONS: ReadonlySet<string> = new Set([
  BROWSER_AGENT_ACTION.OPEN,
  BROWSER_AGENT_ACTION.NAVIGATE,
  BROWSER_AGENT_ACTION.BACK,
  BROWSER_AGENT_ACTION.FORWARD,
  BROWSER_AGENT_ACTION.CLICK,
  BROWSER_AGENT_ACTION.SELECT,
  BROWSER_AGENT_ACTION.KEY,
]);

const TITLE_SETTLE_MS = 5_000;

export const BROWSER_TOOL_REFUSAL = {
  UNREACHABLE: "Not run: your browser could not be reached:",
  UNAVAILABLE: "Not run: the browser could not be reached just now. The call may be made again.",
  NO_SANDBOX: "Not run: your sandbox could not be opened. The call may be made again.",
} as const;

export interface BrowserCall {
  readonly browserSession: string;
  readonly conversationId: string;
  readonly transcript: ConversationTarget;
  readonly openSandbox: () => PromiseLike<unknown>;
}

export function browserNotRun(reason: string): BrowserToolResult {
  return { status: BROWSER_TOOL_STATUS.NOT_RUN, reason };
}

function drivenWords(tab: string): string {
  return (
    `Not done: a member is driving tab ${tab} in the Browser tab beside the description. ` +
    "Wait until they hand it back, then call again, or ask them what they need."
  );
}

function firstDriven(
  actions: readonly BrowserAgentAction[],
  driven: ReadonlySet<string>,
): { readonly index: number; readonly tab: string } | undefined {
  let tab: string | null | undefined;
  for (const [index, action] of actions.entries()) {
    if (action.action === BROWSER_AGENT_ACTION.LIST || isRecordingAction(action)) continue;
    if (action.action === BROWSER_AGENT_ACTION.OPEN) {
      tab = null;
      continue;
    }
    const named = action.tab ?? tab;
    if (typeof named === "string" && driven.has(named)) return { index, tab: named };
    tab = action.action === BROWSER_AGENT_ACTION.CLOSE ? undefined : named;
  }
  return undefined;
}

function drivenTabs(rows: readonly AgentBrowserTabRow[], now: Date): ReadonlySet<string> {
  return new Set(
    rows.filter((row) => browserTabDriver(row, now) !== null).map((row) => row.targetId),
  );
}

function shownTab(page: PageTarget): ShownTab {
  return {
    tab: page.targetId,
    url: cutBrowserText(page.url, BROWSER_AGENT_LIMITS.SHOWN_MAX_CHARS),
    title: cutBrowserText(page.title, BROWSER_AGENT_LIMITS.SHOWN_MAX_CHARS),
  };
}

function withOpeners(
  tabs: readonly ShownTab[],
  rows: readonly AgentBrowserTabRow[],
): readonly ShownTab[] {
  const memberOpened = new Set(
    rows
      .filter((row) => row.openedBy === AGENT_BROWSER_TAB_OPENER.MEMBER)
      .map((row) => row.targetId),
  );
  return tabs.map((tab) =>
    memberOpened.has(tab.tab) ? { ...tab, openedBy: AGENT_BROWSER_TAB_OPENER.MEMBER } : tab,
  );
}

function tabsActedOn(steps: readonly BrowserAgentStep[]): readonly string[] {
  const acted: string[] = [];
  for (const step of steps) {
    if (step.status !== BROWSER_STEP_STATUS.DONE) continue;
    if (step.action === BROWSER_AGENT_ACTION.LIST) {
      for (const { tab } of step.tabs) if (!acted.includes(tab)) acted.push(tab);
      continue;
    }
    if (!("tab" in step)) continue;
    const at = acted.indexOf(step.tab);
    if (step.action === BROWSER_AGENT_ACTION.CLOSE) {
      if (at >= 0) acted.splice(at, 1);
      continue;
    }
    if (at < 0) acted.push(step.tab);
  }
  return acted;
}

function tabsMoved(steps: readonly BrowserAgentStep[]): readonly string[] {
  const moved = new Set<string>();
  for (const step of steps) {
    if (step.status !== BROWSER_STEP_STATUS.DONE || !("tab" in step)) continue;
    if (step.action === BROWSER_AGENT_ACTION.CLOSE) moved.delete(step.tab);
    else if (MOVING_ACTIONS.has(step.action)) moved.add(step.tab);
  }
  return [...moved];
}

function keepTabs(
  conversationId: string,
  steps: readonly BrowserAgentStep[],
  pages: readonly PageTarget[],
) {
  return Effect.gen(function* () {
    const done = steps.filter((step) => step.status === BROWSER_STEP_STATUS.DONE);
    const listed = done.some((step) => step.action === BROWSER_AGENT_ACTION.LIST);
    const closed = new Set(
      done.flatMap((step) =>
        step.action === BROWSER_AGENT_ACTION.CLOSE && "tab" in step ? [step.tab] : [],
      ),
    );
    const held = new Map(pages.map((page) => [page.targetId, page]));
    const written = listed ? [...held.keys()] : tabsActedOn(done);
    for (const targetId of written) {
      const page = held.get(targetId);
      if (page === undefined) continue;
      yield* upsertBrowserTab({
        conversationId,
        targetId,
        address: page.url,
        title: page.title,
        openedBy: { kind: AGENT_BROWSER_TAB_OPENER.AGENT },
      });
    }
    const rows = yield* listAgentBrowserTabs(conversationId);
    const gone = rows.filter((row) => closed.has(row.targetId) && !held.has(row.targetId));
    for (const row of gone) yield* closeBrowserTab(conversationId, row.id);
  });
}

function browserFor(call: BrowserCall) {
  return connectRestoring(call.browserSession, call.conversationId);
}

function withoutStartPage(cdp: CdpSession, kept: ReadonlySet<string>): CdpSession {
  const opened = new Set<string>();
  return {
    ...cdp,
    pages: Effect.map(cdp.pages, (pages) =>
      pages.filter(
        (page) =>
          page.url !== BLANK_ADDRESS || kept.has(page.targetId) || opened.has(page.targetId),
      ),
    ),
    openPage: (url) =>
      Effect.tap(cdp.openPage(url), (targetId) => Effect.sync(() => opened.add(targetId))),
  };
}

function settleTitles(cdp: CdpSession, steps: readonly BrowserAgentStep[]) {
  const moved = tabsMoved(steps);
  const waits = moved.map((tab) =>
    runBrowserActions(cdp, [
      { action: BROWSER_AGENT_ACTION.WAIT, tab, timeoutMs: TITLE_SETTLE_MS },
    ]),
  );
  return Effect.all(waits, { concurrency: "unbounded", discard: true }).pipe(
    Effect.timeout(Duration.millis(TITLE_SETTLE_MS)),
    Effect.ignore,
  );
}

function withSettledTitles(
  steps: readonly BrowserAgentStep[],
  byId: ReadonlyMap<string, PageTarget>,
): readonly BrowserAgentStep[] {
  const lastMoved = new Map<string, number>();
  for (const tab of tabsMoved(steps)) {
    lastMoved.set(
      tab,
      steps.findLastIndex(
        (step) =>
          step.status === BROWSER_STEP_STATUS.DONE &&
          "tab" in step &&
          step.tab === tab &&
          MOVING_ACTIONS.has(step.action),
      ),
    );
  }
  return steps.map((step, at) => {
    if (step.action !== BROWSER_AGENT_ACTION.LIST || step.status !== BROWSER_STEP_STATUS.DONE) {
      return step;
    }
    const tabs = step.tabs.map((listed) => {
      const page = byId.get(listed.tab);
      const moved = lastMoved.get(listed.tab);
      if (moved === undefined || moved > at || page === undefined) return listed;
      const settled = shownTab(page);
      return settled.url === listed.url ? { ...listed, title: settled.title } : listed;
    });
    return { ...step, tabs };
  });
}

function storedCursor(conversationId: string, now: Date) {
  return Effect.gen(function* () {
    const watched = yield* sandboxHeld(conversationId, now).pipe(
      Effect.tapError(logStoreFailure),
      Effect.orElseSucceed(() => false),
    );
    return {
      watched,
      report: (move) =>
        pointBrowserTab(conversationId, move).pipe(Effect.tapError(logStoreFailure), Effect.ignore),
    } satisfies BrowserCursor<DatabaseServices>;
  });
}

const RECORDING_REFUSAL = {
  RUNNING: "a recording already runs: stop it with stop_recording first",
  NO_ENCODER: "your sandbox carries no video encoder, so the browser cannot be recorded",
  NOT_STARTED: "the recorder could not reach the browser; try record again",
  [RECORDING_FAILURE.NONE]: "no recording runs: start one with record",
  [RECORDING_FAILURE.EMPTY]: "the browser drew nothing while it was recorded",
  [RECORDING_FAILURE.ENCODER]: "the recording could not be encoded",
  [RECORDING_FAILURE.UNREACHABLE]: "the recorder could not reach the browser",
  [RECORDING_FAILURE.TOO_LARGE]: `the recording would not fit in ${CONVERSATION_PICTURE_BOUNDS.MAX_BYTES / 1_000_000} MB even made small; record a shorter flow`,
  [RECORDING_FAILURE.SLOW]: "the recording is still being encoded; call stop_recording again",
  UNKEPT: "the recording could not be kept just now; call stop_recording again",
} as const;

function sandboxRecorder(call: BrowserCall): BrowserRecorder<AgentBrowser | DatabaseServices> {
  const unreachable = (failure: BrowserUnreachable) => failure.message;
  return {
    start: Effect.gen(function* () {
      const browser = yield* AgentBrowser;
      const started = yield* browser
        .startRecording(
          call.browserSession,
          BROWSER_AGENT_LIMITS.RECORDING_MAX_SECONDS,
          CONVERSATION_PICTURE_BOUNDS.MAX_BYTES,
        )
        .pipe(Effect.mapError(unreachable));
      if (!started.ok) {
        return yield* Effect.fail(
          started.exitCode === RECORDING_START_EXIT.NO_ENCODER
            ? RECORDING_REFUSAL.NO_ENCODER
            : RECORDING_REFUSAL.NOT_STARTED,
        );
      }
      if (started.running) return yield* Effect.fail(RECORDING_REFUSAL.RUNNING);
      return BROWSER_AGENT_LIMITS.RECORDING_MAX_SECONDS;
    }),
    stop: (caption) =>
      Effect.gen(function* () {
        const browser = yield* AgentBrowser;
        const read = yield* browser
          .stopRecording(call.browserSession, CONVERSATION_PICTURE_BOUNDS.MAX_BYTES)
          .pipe(Effect.mapError(unreachable));
        if (!read.ok) return yield* Effect.fail(RECORDING_REFUSAL[read.reason]);
        const captioned = caption === undefined ? {} : { caption };
        const dimensions = webmDimensions(read.bytes);
        if (dimensions === undefined)
          return yield* Effect.fail(RECORDING_REFUSAL[RECORDING_FAILURE.ENCODER]);
        const kept = yield* keepConversationPicture(call.transcript, {
          bytes: read.bytes,
          contentType: CONVERSATION_MEDIA_TYPE.WEBM,
          ...dimensions,
        }).pipe(
          Effect.tapError(logStoreFailure),
          Effect.mapError(() => RECORDING_REFUSAL.UNKEPT),
        );
        if (Option.isNone(kept)) {
          return {
            seconds: read.seconds,
            ...captioned,
            path: read.path,
            omitted: PICTURE_OMISSION.LIMIT,
            byteCount: read.bytes.byteLength,
          };
        }
        return {
          seconds: read.seconds,
          ...captioned,
          path: read.path,
          picture: { ...kept.value, mediaType: CONVERSATION_MEDIA_TYPE.WEBM },
        };
      }),
  };
}

function runOn(
  cdp: CdpSession,
  call: BrowserCall,
  actions: readonly BrowserAgentAction[],
  now: Date,
) {
  return Effect.gen(function* () {
    const cursor = yield* storedCursor(call.conversationId, now);
    const recorder = sandboxRecorder(call);
    const run = yield* runBrowserActions(cdp, actions, { cursor, keepScreenshots: true, recorder });
    yield* settleTitles(cdp, run.steps);
    const pages = yield* Effect.result(cdp.pages);
    const held = Result.isSuccess(pages) ? pages.success : [];
    if (Result.isSuccess(pages)) {
      yield* keepTabs(call.conversationId, run.steps, held).pipe(
        Effect.tapError(logStoreFailure),
        Effect.ignore,
      );
    }
    const byId = new Map(held.map((page) => [page.targetId, page]));
    const tabs = tabsActedOn(run.steps).flatMap((tab) => {
      const page = byId.get(tab);
      return page === undefined ? [] : [shownTab(page)];
    });
    return { run: { ...run, steps: withSettledTitles(run.steps, byId) }, tabs };
  });
}

function keepScreenshot(
  transcript: ConversationTarget,
  kept: BrowserKeptScreenshot,
): Effect.Effect<KeptNote, TaskStoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const bytes = new Uint8Array(Buffer.from(kept.data, "base64"));
    const contentType = sniffImageType(bytes);
    const dimensions = contentType === undefined ? undefined : imageDimensions(bytes, contentType);
    if (contentType === undefined || dimensions === undefined) {
      return { omitted: PICTURE_OMISSION.UNSUPPORTED, byteCount: bytes.byteLength };
    }
    const picture = yield* keepConversationPicture(transcript, {
      bytes,
      contentType,
      ...dimensions,
    });
    if (Option.isNone(picture))
      return { omitted: PICTURE_OMISSION.LIMIT, byteCount: bytes.byteLength };
    return { picture: { ...picture.value } };
  });
}

function keptSteps(
  transcript: ConversationTarget,
  steps: readonly BrowserAgentStep[],
): Effect.Effect<readonly BrowserToolStep[], never, DatabaseServices> {
  return Effect.forEach(steps, (step): Effect.Effect<BrowserToolStep, never, DatabaseServices> => {
    if (step.action !== BROWSER_AGENT_ACTION.SCREENSHOT || step.status !== BROWSER_STEP_STATUS.DONE)
      return Effect.succeed(step);
    const { kept, ...shown } = step;
    if (kept === undefined) return Effect.succeed(shown);
    return keepScreenshot(transcript, kept).pipe(
      Effect.map((note) => ({ ...shown, ...note })),
      Effect.tapError(logStoreFailure),
      Effect.orElseSucceed(() => shown),
    );
  });
}

export function runBrowserTool(
  call: BrowserCall,
  input: UnparsedWireValue,
): Effect.Effect<BrowserToolResult, never, AgentBrowser | DatabaseServices> {
  const read = readInput(input);
  if (Result.isFailure(read)) {
    const at = read.failure.path.join(".");
    return Effect.succeed(
      browserNotRun(
        `Not run: the input did not read${at === "" ? "" : ` at ${at}`}. Name 1 to ` +
          `${BROWSER_AGENT_LIMITS.MAX_ACTIONS} actions, each as the tool's input says.`,
      ),
    );
  }
  const { actions } = read.success;
  return Effect.gen(function* () {
    const opened = yield* Effect.result(
      Effect.tryPromise({ try: async () => call.openSandbox(), catch: () => "not opened" }),
    );
    if (Result.isFailure(opened)) return browserNotRun(BROWSER_TOOL_REFUSAL.NO_SANDBOX);
    const ran = yield* Effect.result(
      Effect.scoped(
        Effect.gen(function* () {
          const cdp = yield* browserFor(call);
          const rows = yield* listAgentBrowserTabs(call.conversationId);
          const now = yield* DateTime.nowAsDate;
          const refused = firstDriven(actions, drivenTabs(rows, now));
          const runnable = refused === undefined ? actions : actions.slice(0, refused.index);
          const kept = new Set(rows.map((row) => row.targetId));
          const outcome =
            runnable.length === 0
              ? { run: { steps: [], skipped: 0 }, tabs: [] }
              : yield* runOn(withoutStartPage(cdp, kept), call, runnable, now);
          return { ...outcome, tabs: withOpeners(outcome.tabs, rows), refused, runnable };
        }),
      ),
    );
    if (Result.isFailure(ran)) {
      if (ran.failure._tag !== "BrowserUnreachable") return yield* Effect.fail(ran.failure);
      return browserNotRun(`${BROWSER_TOOL_REFUSAL.UNREACHABLE} ${ran.failure.message}.`);
    }
    const { run, tabs, refused, runnable } = ran.success;
    const reachedRefused =
      refused !== undefined &&
      run.steps.length === runnable.length &&
      run.steps.every((step) => step.status === BROWSER_STEP_STATUS.DONE);
    const ranSteps = yield* keptSteps(call.transcript, run.steps);
    const steps: readonly BrowserToolStep[] =
      refused === undefined || !reachedRefused
        ? ranSteps
        : [
            ...ranSteps,
            {
              action: actions[refused.index]?.action ?? BROWSER_AGENT_ACTION.LIST,
              status: BROWSER_STEP_STATUS.FAILED,
              tab: refused.tab,
              error: cutBrowserText(drivenWords(refused.tab), BROWSER_AGENT_LIMITS.ERROR_MAX_CHARS),
            },
          ];
    return {
      status: BROWSER_TOOL_STATUS.RAN,
      steps,
      skipped: actions.length - steps.length,
      tabs,
    } satisfies BrowserToolResult;
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(browserNotRun(BROWSER_TOOL_REFUSAL.UNAVAILABLE))),
  );
}

const isScreenshotted = Schema.is(
  Schema.Struct({
    action: Schema.Literal(BROWSER_AGENT_ACTION.SCREENSHOT),
    tab: Schema.String,
    image: Schema.Struct({ mime: Schema.String, data: Schema.String }),
  }),
);

const isRan = Schema.is(
  Schema.Struct({
    status: Schema.Literal(BROWSER_TOOL_STATUS.RAN),
    steps: Schema.Array(Schema.Unknown),
  }),
);

const KEPT_NOTE_KEYS: readonly string[] = ["picture", "omitted", "byteCount"];

function withoutPictures(output: UnparsedWireValue, forModel: boolean): UnparsedWireValue {
  if (!isRecord(output) || !isRan(output) || !Array.isArray(output.steps)) return output;
  const steps: readonly UnparsedWireValue[] = output.steps;
  return unparsedWire({
    ...output,
    steps: steps.map((step) => {
      if (!isRecord(step) || !isScreenshotted(step) || !isRecord(step.image)) return step;
      const { data: _data, ...image } = step.image;
      const kept = forModel
        ? Object.fromEntries(Object.entries(step).filter(([key]) => !KEPT_NOTE_KEYS.includes(key)))
        : step;
      return { ...kept, image };
    }),
  });
}

type BrowserModelPart =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "file";
      readonly data: { readonly type: "data"; readonly data: string };
      readonly mediaType: string;
    };

type BrowserModelOutput =
  | { readonly type: "json"; readonly value: UnparsedWireValue }
  | { readonly type: "content"; readonly value: readonly BrowserModelPart[] };

export function browserModelOutput(output: UnparsedWireValue): BrowserModelOutput {
  if (!isRecord(output) || !isRan(output) || !Array.isArray(output.steps)) {
    return { type: "json", value: output };
  }
  const steps: readonly UnparsedWireValue[] = output.steps;
  const pictures = steps.flatMap((step) =>
    isScreenshotted(step) ? [{ tab: step.tab, mime: step.image.mime, data: step.image.data }] : [],
  );
  if (pictures.length === 0) return { type: "json", value: output };
  return {
    type: "content",
    value: [
      { type: "text", text: JSON.stringify(withoutPictures(output, true)) },
      ...pictures.flatMap(({ tab, mime, data }) => [
        { type: "text" as const, text: `The screenshot of tab ${tab}:` },
        { type: "file" as const, data: { type: "data" as const, data }, mediaType: mime },
      ]),
    ],
  };
}

export function storedBrowserOutput(output: UnparsedWireValue): UnparsedWireValue {
  return withoutPictures(output, false);
}
