/**
 * browser-tool.ts -- `browser`, an agent's one tool for a real browser: its input, the one place a call is routed to a browser, a member's takeover heeded, the tab store kept in step, and the result as the model and the stored conversation each see it.
 *
 * Luke, a coding agent, and either's workers are offered the same tool. A
 * call names one to ten actions of the shared vocabulary
 * (`@luke/features/browser-agent-actions`) and runs them in order on the
 * Chromium in the agent's own sandbox (`agent-browser.ts`,
 * `browser-actions.ts`); a worker drives its parent's, since it works in its
 * parent's sandbox. Every call is routed to its browser here alone
 * (`browserFor`).
 *
 * The agent's tabs are kept in the service under the conversation whose
 * agent's browser holds them (`@luke/database/models/agent-browser-tabs`):
 * a coding agent's own, the task's for Luke, a worker's parent's. Before a
 * call runs, the action on a tab a member drives is refused, with words that
 * say so, and nothing after it runs, so the agent waits for the tab to be
 * handed back or asks; what ran before it stands. After it runs, the store
 * follows what the browser now holds: a tab opened or acted on is written
 * with its address and title, a `list` writes every page the browser
 * holds, and only a tab the agent closed is dropped.
 *
 * While it runs, the agent's pointer is written to the tab it points at
 * (`pointBrowserTab`), one write just before each click, type, or wheel
 * turn reaches the page, so a member's window draws it gliding there
 * (`@luke/features/browser-agent-cdp`'s `BrowserCursor`). Where someone is
 * watching, each such input then waits the cursor's beat, so the glide lands
 * with the action. Someone is watching while the agent's sandbox lease
 * stands (`sandbox-terminal-lease.ts`), which the live view moves on while a
 * panel has one of its tabs open; a Terminal tab in use holds it too, and
 * counts as watching. An agent no one watches is never slowed. The point
 * and its kind are no page content and are never logged.
 *
 * A browser that cannot be reached answers `not-run` and why, never a throw.
 * A screenshot is taken twice over: the model's copy, small
 * (`BROWSER_SCREENSHOT`), reaches the model as an image
 * (`browserModelOutput`) and its base64 is left out of the stored
 * conversation (`storedBrowserOutput`); the transcript's copy, the page at
 * its own size and good quality (`BROWSER_KEPT_SCREENSHOT`), is kept beside
 * the transcript the call is written to as `show_image`'s pictures are
 * (`@luke/database/models/conversation-pictures`), deleted with that
 * conversation, and the step names it by id (`picture`), or says why it was
 * not kept (`omitted`). Nothing a page holds is logged or traced here: a
 * failure to keep the store is logged by its kind alone.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  type AgentBrowserTabRow,
  browserTabDriver,
  closeBrowserTab,
  listAgentBrowserTabs,
  pointBrowserTab,
  upsertBrowserTab,
} from "@luke/database/models/agent-browser-tabs";
import { keepConversationPicture } from "@luke/database/models/conversation-pictures";
import { childConversationId } from "@luke/database/models/ids";
import { sandboxHeld } from "@luke/database/models/sandbox-terminal-lease";
import type { TaskStoreFailure } from "@luke/database/models/task-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import { AGENT_BROWSER_TAB_OPENER } from "@luke/features/agent-browser-tab-wire";
import {
  BROWSER_AGENT_ACTION,
  BROWSER_AGENT_LIMITS,
  BROWSER_STEP_STATUS,
  type BrowserAgentAction,
  type BrowserAgentStep,
  type BrowserKeptScreenshot,
  browserAgentActionsSchema,
  cutBrowserText,
} from "@luke/features/browser-agent-actions";
import { type BrowserCursor, runBrowserActions } from "@luke/features/browser-agent-cdp";
import type { CdpSession, PageTarget } from "@luke/features/browser-cdp";
import {
  type KeptPicture,
  PICTURE_OMISSION,
  type PictureOmission,
} from "@luke/features/conversation-picture-wire";
import { imageDimensions, sniffImageType } from "@luke/features/image-signature";
import { isRecord, type UnparsedWireValue, unparsedWire } from "@luke/wire";
import { describeWire, readEither } from "@luke/wire/effect";
import { Clock, Duration, Effect, Option, Result, Schema } from "effect";
import type { ToolModelOutput } from "eve/tools";
import { logStoreFailure } from "../../http/store-failure.js";
import { AGENT_TOOL } from "../agent-runtime/tools.js";
import type { AgentBrowser } from "./agent-browser.js";
import { connectRestoring } from "./restore-tabs.js";

const BROWSER_INPUT = Schema.Struct({
  actions: describeWire(
    browserAgentActionsSchema,
    `The actions to take, in order, 1 to ${BROWSER_AGENT_LIMITS.MAX_ACTIONS}; the call stops at the first that fails.`,
  ),
});

const readInput = readEither(BROWSER_INPUT);

/** The tool as every agent is offered it, Luke, a coding agent, and either's workers alike: its name, its words, and its input schema. */
export const BROWSER_TOOL = {
  name: AGENT_TOOL.BROWSER,
  description:
    "Drive a real browser, a Chromium in your own sandbox, whose tabs the developer can watch " +
    "and take over in the Browser tab beside the plan. Your own dev server is at localhost " +
    "there, such as http://localhost:3000/. Each call takes up to " +
    `${BROWSER_AGENT_LIMITS.MAX_ACTIONS} actions, run in order: list the tabs, open one at an ` +
    "address, navigate, go back or forward, click, type, choose an option in a dropdown, press " +
    "a key, scroll, wait, take a screenshot to see the page, take a snapshot to read it as " +
    "text with a ref beside each element, read its console, or close it. Take a snapshot for " +
    "the refs before you click or type on an element. Choose in a native dropdown, a select " +
    "the snapshot shows as a combobox or listbox, with select on its ref and the option's " +
    "label, rather than clicking it or its options, whose popup no click reaches. An action that leaves out its tab acts on the tab the action before " +
    "it acted on in the same call only, so open and go on in one call; a new call names its " +
    "tab. While the developer drives a tab, actions on " +
    "it are refused until they hand it back: wait, or ask them. Answers each step that ran and " +
    "the tabs it acted on as they now stand, or `not-run` and why, such as the browser not " +
    "being reachable.",
  inputSchema: BROWSER_INPUT,
} as const;

export const BROWSER_TOOL_STATUS = {
  RAN: "ran",
  NOT_RUN: "not-run",
} as const;

/** A tab as a result names it: its id, address, and title. */
type ShownTab = { readonly tab: string; readonly url: string; readonly title: string };

/** A screenshot step as the runner answers it, the transcript's copy beside the model's where it fit. */
type ScreenshotStep = Extract<
  BrowserAgentStep,
  { readonly action: typeof BROWSER_AGENT_ACTION.SCREENSHOT; readonly status: "done" }
>;

/** What the transcript kept of a screenshot: the picture by id, or why it was not kept and its size. */
type KeptNote =
  | { readonly picture: { readonly [Key in keyof KeptPicture]: KeptPicture[Key] } }
  | { readonly omitted: PictureOmission; readonly byteCount: number };

/** A step as the tool answers it: a screenshot's transcript copy replaced by what was kept of it, every other step as it ran. */
export type BrowserToolStep =
  | Exclude<BrowserAgentStep, ScreenshotStep>
  | (Omit<ScreenshotStep, "kept"> & (KeptNote | Record<never, never>));

// A type rather than an interface, so a result is a `WireRecord` the model is handed as it stands.
export type BrowserToolResult =
  | {
      readonly status: typeof BROWSER_TOOL_STATUS.RAN;
      readonly steps: readonly BrowserToolStep[];
      readonly skipped: number;
      /** The tabs the call acted on and still open, as they stand once it ran. */
      readonly tabs: readonly ShownTab[];
    }
  | { readonly status: typeof BROWSER_TOOL_STATUS.NOT_RUN; readonly reason: string };

/** The address of a page that holds nothing: Chromium's own first page, which a call never sees. */
const BLANK_ADDRESS = "about:blank";

/** The actions that may move a tab's page, whose title is settled before the call ends. */
const MOVING_ACTIONS: ReadonlySet<string> = new Set([
  BROWSER_AGENT_ACTION.OPEN,
  BROWSER_AGENT_ACTION.NAVIGATE,
  BROWSER_AGENT_ACTION.BACK,
  BROWSER_AGENT_ACTION.FORWARD,
  BROWSER_AGENT_ACTION.CLICK,
  BROWSER_AGENT_ACTION.SELECT,
  BROWSER_AGENT_ACTION.KEY,
]);

/** How long, in all, a call's end waits on the pages it moved to finish loading, so their titles are kept as they settled. */
const TITLE_SETTLE_MS = 5_000;

/** Why a call ran nothing, or an action was refused, in words the model can act on. */
export const BROWSER_TOOL_REFUSAL = {
  UNREACHABLE: "Not run: your browser could not be reached:",
  UNAVAILABLE: "Not run: the browser could not be reached just now. The call may be made again.",
  NO_SANDBOX: "Not run: your sandbox could not be opened. The call may be made again.",
} as const;

/** What a call runs under: the session whose sandbox its browser is in, the conversation its tabs belong to, and the transcript its screenshots are kept beside. */
export interface BrowserCall {
  /** The eve session whose sandbox the browser runs in: a root's own, a worker's root's (`browserSessionOf`). */
  readonly browserSession: string;
  /** The conversation of the agent whose browser holds the tabs: a coding agent's own, the task's for Luke, a worker's parent's. */
  readonly conversationId: string;
  /** The transcript the call is written to, which keeps its screenshots: an agent's own, a worker's own child (`browserTranscriptOf`). */
  readonly transcript: ConversationTarget;
  /** Opens the sandbox the browser runs in, as eve opens it for any tool that needs it, a worker's its parent's; one already open is answered as it stands. */
  readonly openSandbox: () => PromiseLike<unknown>;
}

/**
 * The transcript a call is written to, from the conversation its session
 * was admitted to: that one for an agent's own call, and for a worker's,
 * the child its turns are recorded under, which the delegation call names,
 * so its screenshots are read where its transcript is.
 */
export function browserTranscriptOf(
  admitted: ConversationTarget,
  parentCallId: string | undefined,
): ConversationTarget {
  if (parentCallId === undefined) return admitted;
  return {
    userId: admitted.userId,
    conversationId: childConversationId(admitted.conversationId, parentCallId),
  };
}

/** A call that ran nothing, and why. */
export function browserNotRun(reason: string): BrowserToolResult {
  return { status: BROWSER_TOOL_STATUS.NOT_RUN, reason };
}

/** The words a refused action answers: a member drives its tab. */
function drivenWords(tab: string): string {
  return (
    `Not done: a member is driving tab ${tab} in the Browser tab beside the plan. ` +
    "Wait until they hand it back, then call again, or ask them what they need."
  );
}

/**
 * The first action that acts on a tab a member drives, and that tab, read
 * ahead of the run as the run itself names tabs: a tab left out is the one
 * the action before acted on, a tab just opened is driven by no one, and a
 * closed one leaves the next to name its own.
 */
function firstDriven(
  actions: readonly BrowserAgentAction[],
  driven: ReadonlySet<string>,
): { readonly index: number; readonly tab: string } | undefined {
  // Note that `null` is a tab this call opened, whose id is not known until it runs.
  let tab: string | null | undefined;
  for (const [index, action] of actions.entries()) {
    if (action.action === BROWSER_AGENT_ACTION.LIST) continue;
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

/** The tabs a member drives now, by the browser's own id for each. */
function drivenTabs(rows: readonly AgentBrowserTabRow[], now: Date): ReadonlySet<string> {
  return new Set(
    rows.filter((row) => browserTabDriver(row, now) !== null).map((row) => row.targetId),
  );
}

/** A tab as a result shows it, its address and title cut to the shown cap. */
function shownTab(page: PageTarget): ShownTab {
  return {
    tab: page.targetId,
    url: cutBrowserText(page.url, BROWSER_AGENT_LIMITS.SHOWN_MAX_CHARS),
    title: cutBrowserText(page.title, BROWSER_AGENT_LIMITS.SHOWN_MAX_CHARS),
  };
}

/** The tabs the steps acted on, every tab a list named among them, in the order first acted on, a closed one left out. */
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

/**
 * The tabs whose page the steps may have moved, an open's, a navigation's, a
 * click's, or a key's, and that still stand: the ones whose title may not
 * have settled yet as the call ends.
 */
function tabsMoved(steps: readonly BrowserAgentStep[]): readonly string[] {
  const moved = new Set<string>();
  for (const step of steps) {
    if (step.status !== BROWSER_STEP_STATUS.DONE || !("tab" in step)) continue;
    if (step.action === BROWSER_AGENT_ACTION.CLOSE) moved.delete(step.tab);
    else if (MOVING_ACTIONS.has(step.action)) moved.add(step.tab);
  }
  return [...moved];
}

/**
 * Keeps the store in step with what the browser now holds once a call ran:
 * every tab acted on written with its page as it stands, and after a
 * `list`, every page the browser holds; a tab the agent closed is dropped.
 * Note that a kept tab the browser does not hold is never dropped here,
 * because it is one the connection could not reopen just now
 * (`restore-tabs.ts`), which the next connection tries again; only the
 * agent's own `close` ends a tab.
 */
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

/**
 * The browser a call is routed to: the Chromium in the agent's own sandbox,
 * connected for the caller's scope, its kept tabs reopened where it started
 * afresh (`restore-tabs.ts`).
 */
function browserFor(call: BrowserCall) {
  return connectRestoring(call.browserSession, call.conversationId);
}

/**
 * The browser as a call sees it: without the blank page Chromium starts
 * with, so that page is never listed, kept, or reopened. Note that it is
 * told apart as a blank page the store does not keep and this call did not
 * open, since the browser marks no page as its first, and that a tab this
 * call opened may still read as blank before its address commits.
 */
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

/**
 * Waits, within `TITLE_SETTLE_MS` in all, for each page the steps moved to
 * finish loading, so the title kept for it is its page's own rather than the
 * address Chromium shows while it loads; a page that does not is kept as it
 * then stands.
 */
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

/**
 * The steps with each tab a `list` named titled as its page settled
 * (`settleTitles`), where the call moved it before that list and never
 * after, and it still stands at the address listed: so a step never names a
 * tab by the title it showed while loading where the result's `tabs` names
 * it by its own, and a list before a later move keeps what it saw.
 */
function withSettledTitles(
  steps: readonly BrowserAgentStep[],
  byId: ReadonlyMap<string, PageTarget>,
): readonly BrowserAgentStep[] {
  // Each tab still standing that the call moved, by the step that last moved it.
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

/**
 * The agent's pointer as the tab store keeps it: each move written to its
 * tab's row, and held for the beat while the sandbox's lease says someone
 * watches. Note that a write the store refuses is logged by its kind alone
 * and lets the action go on, since a pointer not drawn breaks nothing.
 */
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

/** Runs the actions on the browser, the store kept in step after; a failure to keep it is logged and leaves the run as it ran. */
function runOn(
  cdp: CdpSession,
  call: BrowserCall,
  actions: readonly BrowserAgentAction[],
  now: Date,
) {
  return Effect.gen(function* () {
    const cursor = yield* storedCursor(call.conversationId, now);
    const run = yield* runBrowserActions(cdp, actions, { cursor, keepScreenshots: true });
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

/**
 * What the transcript keeps of one screenshot's copy: the picture, sniffed
 * and measured from its own bytes, kept beside the transcript; why not
 * where its bytes are no picture or the transcript has no room left.
 */
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

/**
 * The steps with each screenshot's transcript copy kept and named by what
 * was kept of it, never carried on. Note that a copy the store could not
 * keep is logged by its kind alone and named by nothing, since the model
 * saw its own copy all the same and the call stands.
 */
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

/**
 * One `browser` call made for an agent, whichever agent made it: its input
 * read against the tool's schema, the action on a tab a member drives
 * refused with nothing after it run, the rest run on the agent's browser,
 * and the store kept in step. It never fails: a browser that cannot be
 * reached, or a store that cannot be read, answers `not-run` and why.
 */
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
    // Note that the sandbox is opened first, as eve opens it for a shell call, because the browser
    // is found by the sandbox its session is tagged with, and an agent's first call may be this one.
    const opened = yield* Effect.result(
      Effect.tryPromise({ try: async () => call.openSandbox(), catch: () => "not opened" }),
    );
    if (Result.isFailure(opened)) return browserNotRun(BROWSER_TOOL_REFUSAL.NO_SANDBOX);
    // Note that the browser is reached before the takeovers are read, because a browser that
    // started afresh reopens the kept tabs on new targets, which the takeovers then name.
    const ran = yield* Effect.result(
      Effect.scoped(
        Effect.gen(function* () {
          const cdp = yield* browserFor(call);
          const rows = yield* listAgentBrowserTabs(call.conversationId);
          const now = new Date(yield* Clock.currentTimeMillis);
          const refused = firstDriven(actions, drivenTabs(rows, now));
          const runnable = refused === undefined ? actions : actions.slice(0, refused.index);
          const kept = new Set(rows.map((row) => row.targetId));
          const outcome =
            runnable.length === 0
              ? { run: { steps: [], skipped: 0 }, tabs: [] }
              : yield* runOn(withoutStartPage(cdp, kept), call, runnable, now);
          return { ...outcome, refused, runnable };
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

/** A screenshot as a stored or shown result carries it, read leniently: only its picture is wanted. */
const isScreenshotted = Schema.is(
  Schema.Struct({
    action: Schema.Literal(BROWSER_AGENT_ACTION.SCREENSHOT),
    tab: Schema.String,
    image: Schema.Struct({ mime: Schema.String, data: Schema.String }),
  }),
);

/** Whether a result is a call that ran, as either view reads it. */
const isRan = Schema.is(
  Schema.Struct({
    status: Schema.Literal(BROWSER_TOOL_STATUS.RAN),
    steps: Schema.Array(Schema.Unknown),
  }),
);

/** What the transcript's view of a step names of what was kept, which the model's view leaves out. */
const KEPT_NOTE_KEYS: readonly string[] = ["picture", "omitted", "byteCount"];

/**
 * A result with every screenshot's picture taken out, its size and kind
 * left; where `forModel`, without what the transcript kept of it too, which
 * is no business of the model's; any other result as it is.
 */
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

/**
 * What the model is shown of a call's result: the result as JSON with each
 * screenshot's picture beside it as an image, never its base64 spelled out
 * as text; anything else as the JSON it is. Note that the output is eve's
 * literal shape, spelled here rather than built with eve's helpers, as
 * `pictureLookModelOutput` spells it.
 */
export function browserModelOutput(output: UnparsedWireValue): ToolModelOutput {
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

/** A call's result as the conversation keeps it: every screenshot without the model's copy, naming the transcript's copy kept beside it by id. */
export function storedBrowserOutput(output: UnparsedWireValue): UnparsedWireValue {
  return withoutPictures(output, false);
}
