/**
 * browser-tool.ts -- `browser`, an agent's one tool for a real browser: its input, the one place a call is routed to a browser, a member's takeover heeded, the tab store kept in step, and the result as the model and the stored conversation each see it.
 *
 * Luke, a coding agent, and either's workers are offered the same tool. A
 * call names one to ten actions of the shared vocabulary
 * (`@luke/features/browser-agent-actions`) and runs them in order on the
 * Chromium in the agent's own sandbox (`agent-browser.ts`,
 * `browser-actions.ts`); a worker drives its parent's, since it works in its
 * parent's sandbox. Every call is routed to its browser here alone
 * (`browserFor`): the sandbox's, or, where the call says `on: "mac"`, the
 * developer's own Mac, whose desktop runs the same actions on the Browser
 * tabs of the agent's task (`@luke/host`'s `mac-browser-tabs.ts`) as a Mac
 * command of the browser kind (`../mac-command.ts`'s `askMac`), for the
 * agent's starter, whose Mac it is, as `run_on_mac` asks. A Mac's tabs are
 * the desktop's own, so the tab store below never holds them and no
 * takeover is read for them; its answer is mapped into the result a sandbox
 * run answers, its last screenshot put back where the run took it.
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
 * A browser that cannot be reached answers `not-run` and why, never a throw.
 * A screenshot reaches the model as an image (`browserModelOutput`) and is
 * left out of the stored conversation (`storedBrowserOutput`), as
 * `look_at_picture`'s picture is (`../../tasks/picture-look.ts`). Nothing a
 * page holds is logged or traced here: a failure to keep the store is logged
 * by its kind alone.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  type AgentBrowserTabRow,
  browserTabDriver,
  closeBrowserTab,
  listAgentBrowserTabs,
  upsertBrowserTab,
} from "@luke/database/models/agent-browser-tabs";
import { AGENT_BROWSER_TAB_OPENER } from "@luke/features/agent-browser-tab-wire";
import {
  BROWSER_AGENT_ACTION,
  BROWSER_AGENT_LIMITS,
  BROWSER_SCREENSHOT,
  BROWSER_STEP_STATUS,
  type BrowserAgentAction,
  type BrowserAgentRun,
  type BrowserAgentStep,
  browserAgentActionsSchema,
  browserAgentRunSchema,
  cutBrowserText,
} from "@luke/features/browser-agent-actions";
import { runBrowserActions } from "@luke/features/browser-agent-cdp";
import type { CdpSession, PageTarget } from "@luke/features/browser-cdp";
import {
  MAC_COMMAND_BOUNDS,
  MAC_COMMAND_KIND,
  type MacBrowserParams,
  type MacCommandImage,
} from "@luke/features/mac-command-wire";
import { EXCESS_KEYS, isRecord, type UnparsedWireValue, unparsedWire } from "@luke/wire";
import { describeWire, readEither } from "@luke/wire/effect";
import { Clock, Duration, Effect, Result, Schema } from "effect";
import type { ToolModelOutput } from "eve/tools";
import { logStoreFailure } from "../../http/store-failure.js";
import { AGENT_TOOL } from "../agent-runtime/tools.js";
import { askMac, MAC_COMMAND_STATUS } from "../mac-command.js";
import type { AgentBrowser } from "./agent-browser.js";
import { BLANK_ADDRESS, connectRestoring } from "./restore-tabs.js";

/** Where a call acts: the Chromium in the agent's own sandbox, or the Browser tabs on the developer's own Mac. */
export const BROWSER_PLACE = {
  SANDBOX: "sandbox",
  MAC: "mac",
} as const;

const BROWSER_INPUT = Schema.Struct({
  actions: describeWire(
    browserAgentActionsSchema,
    `The actions to take, in order, 1 to ${BROWSER_AGENT_LIMITS.MAX_ACTIONS}; the call stops at the first that fails.`,
  ),
  on: Schema.optionalKey(
    describeWire(
      Schema.Literals(Object.values(BROWSER_PLACE)),
      `Where to act: "${BROWSER_PLACE.SANDBOX}", your own browser, where left out; or ` +
        `"${BROWSER_PLACE.MAC}", the Browser tabs of your task on the developer's own Mac, as the developer.`,
    ),
  ),
});

const readInput = readEither(BROWSER_INPUT);

/** A Mac's run as its answer carries it, read as an answer is: a key a newer desktop added is let go. */
const readMacRun = readEither(browserAgentRunSchema, { excess: EXCESS_KEYS.DROP });

/** The tool as every agent is offered it, Luke, a coding agent, and either's workers alike: its name, its words, and its input schema. */
export const BROWSER_TOOL = {
  name: AGENT_TOOL.BROWSER,
  description:
    "Drive a real browser, a Chromium in your own sandbox, whose tabs the developer can watch " +
    "and take over in the Browser tab beside the plan. Your own dev server is at localhost " +
    "there, such as http://localhost:3000/. Use it for your own dev server and for anything the " +
    'developer should watch or take over. With `on: "mac"` the same actions run instead on the ' +
    "Browser tabs of your task in Luke on the developer's own Mac, signed in as the developer: " +
    "use that only for the developer's own localhost or a site they are signed in to there, " +
    "since on the Mac you act as the developer on every site they are signed in to. Each call takes up to " +
    `${BROWSER_AGENT_LIMITS.MAX_ACTIONS} actions, run in order: list the tabs, open one at an ` +
    "address, navigate, go back or forward, click, type, press a key, scroll, wait, take a " +
    "screenshot to see the page, take a snapshot to read it as text with a ref beside each " +
    "element, read its console, or close it. Take a snapshot for the refs before you click or " +
    "type on an element. An action that leaves out its tab acts on the tab the action before " +
    "it acted on in the same call only, so open and go on in one call; a new call names its " +
    "tab. While the developer drives a tab, actions on " +
    "it are refused until they hand it back: wait, or ask them. Answers each step that ran and " +
    "the tabs it acted on as they now stand, or `not-run` and why, such as the browser not " +
    "being reachable or the Mac not listening.",
  inputSchema: BROWSER_INPUT,
} as const;

export const BROWSER_TOOL_STATUS = {
  RAN: "ran",
  NOT_RUN: "not-run",
} as const;

/** A tab as a result names it: its id, address, and title. */
type ShownTab = { readonly tab: string; readonly url: string; readonly title: string };

// A type rather than an interface, so a result is a `WireRecord` the model is handed as it stands.
export type BrowserToolResult =
  | ({ readonly status: typeof BROWSER_TOOL_STATUS.RAN } & BrowserAgentRun & {
        /** The tabs the call acted on and still open, as they stand once it ran. */
        readonly tabs: readonly ShownTab[];
      })
  | { readonly status: typeof BROWSER_TOOL_STATUS.NOT_RUN; readonly reason: string };

/** The actions that may move a tab's page, whose title is settled before the call ends. */
const MOVING_ACTIONS: ReadonlySet<string> = new Set([
  BROWSER_AGENT_ACTION.OPEN,
  BROWSER_AGENT_ACTION.NAVIGATE,
  BROWSER_AGENT_ACTION.BACK,
  BROWSER_AGENT_ACTION.FORWARD,
  BROWSER_AGENT_ACTION.CLICK,
  BROWSER_AGENT_ACTION.KEY,
]);

/** How long, in all, a call's end waits on the pages it moved to finish loading, so their titles are kept as they settled. */
const TITLE_SETTLE_MS = 5_000;

/** Why a call ran nothing, or an action was refused, in words the model can act on. */
export const BROWSER_TOOL_REFUSAL = {
  UNREACHABLE: "Not run: your browser could not be reached:",
  UNAVAILABLE: "Not run: the browser could not be reached just now. The call may be made again.",
  NO_SANDBOX: "Not run: your sandbox could not be opened. The call may be made again.",
  NO_MAC:
    "Not run: you cannot reach the developer's Mac's Browser tabs. Use your own browser, " +
    "with `on` left out.",
  TASKLESS:
    "Not run: you work on no task, and the developer's Mac drives only the Browser tabs of a " +
    "task. Use your own browser, with `on` left out.",
  MAC_UNREADABLE:
    "No answer it could read: the developer's Mac answered in a shape this service does not " +
    "read, so the actions may or may not have run. Luke on the Mac may need updating.",
  MAC_UNAVAILABLE:
    "Not run: your task could not be read just now, so nothing was sent to the developer's " +
    "Mac. The call may be made again.",
} as const;

/** What a call runs under: the session whose sandbox its browser is in, and the conversation its tabs belong to. */
export interface BrowserCall {
  /** The eve session whose sandbox the browser runs in: a root's own, a worker's root's (`browserSessionOf`). */
  readonly browserSession: string;
  /** The conversation of the agent whose browser holds the tabs: a coding agent's own, the task's for Luke, a worker's parent's. */
  readonly conversationId: string;
  /** Opens the sandbox the browser runs in, as eve opens it for any tool that needs it, a worker's its parent's; one already open is answered as it stands. */
  readonly openSandbox: () => PromiseLike<unknown>;
  /** The developer's Mac, which a call that says `on: "mac"` reaches; none where this agent reaches no Mac's Browser tabs. */
  readonly mac?: MacBrowserCall;
}

/** What a call on the developer's Mac is sent under: whose Mac, and the task whose Browser tabs it drives. */
export interface MacBrowserCall {
  /** The account whose Mac runs the actions: the agent's starter's, as `run_on_mac` asks. */
  readonly userId: string;
  /** The agent's task, read only for a call that asks for the Mac; null for an agent on no task. */
  readonly taskId: Effect.Effect<string | null, unknown, DatabaseServices>;
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

/** The Chromium in the agent's own sandbox, connected for the caller's scope, its kept tabs reopened where it started afresh (`restore-tabs.ts`). */
function sandboxBrowser(call: BrowserCall) {
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

/** Runs the actions on the browser, the store kept in step after; a failure to keep it is logged and leaves the run as it ran. */
function runOn(cdp: CdpSession, call: BrowserCall, actions: readonly BrowserAgentAction[]) {
  return Effect.gen(function* () {
    const run = yield* runBrowserActions(cdp, actions);
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
    return { run, tabs };
  });
}

/**
 * A call on the agent's own sandbox browser: the action on a tab a member
 * drives refused with nothing after it run, the rest run, and the store
 * kept in step.
 */
function onSandbox(call: BrowserCall, actions: readonly BrowserAgentAction[]) {
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
          const cdp = yield* sandboxBrowser(call);
          const rows = yield* listAgentBrowserTabs(call.conversationId);
          const now = new Date(yield* Clock.currentTimeMillis);
          const refused = firstDriven(actions, drivenTabs(rows, now));
          const runnable = refused === undefined ? actions : actions.slice(0, refused.index);
          const kept = new Set(rows.map((row) => row.targetId));
          const outcome =
            runnable.length === 0
              ? { run: { steps: [], skipped: 0 }, tabs: [] }
              : yield* runOn(withoutStartPage(cdp, kept), call, runnable);
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
    const steps: readonly BrowserAgentStep[] =
      refused === undefined || !reachedRefused
        ? run.steps
        : [
            ...run.steps,
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

/**
 * A Mac's run with its one image put back where it was taken: the last
 * screenshot that was done, whose picture the Mac sent as the result's
 * image and left empty in the run (`mac-browser-tabs.ts`). Every earlier
 * screenshot stays without its picture, and an image of a type a
 * screenshot is not is left out.
 */
function withMacImage(run: BrowserAgentRun, image: MacCommandImage | undefined): BrowserAgentRun {
  if (image === undefined || image.mediaType !== BROWSER_SCREENSHOT.MIME) return run;
  const at = run.steps.findLastIndex(
    (step) =>
      step.action === BROWSER_AGENT_ACTION.SCREENSHOT && step.status === BROWSER_STEP_STATUS.DONE,
  );
  const steps = run.steps.map((step, index) =>
    index === at && step.action === BROWSER_AGENT_ACTION.SCREENSHOT && "image" in step
      ? { ...step, image: { ...step.image, data: image.data } }
      : step,
  );
  return { ...run, steps };
}

/**
 * The tabs a Mac's run acted on, each with the address and title the run
 * read of it, a list's or a snapshot's, where that read was the last step on
 * the tab; any other tab is left out, since the Mac answers no page beside
 * its steps and a page may move under any other step, a redirect while it
 * waits among them.
 */
function macTabs(steps: readonly BrowserAgentStep[]): readonly ShownTab[] {
  const seen = new Map<string, PageTarget>();
  for (const step of steps) {
    if (step.status !== BROWSER_STEP_STATUS.DONE) continue;
    if (step.action === BROWSER_AGENT_ACTION.LIST) {
      for (const tab of step.tabs) seen.set(tab.tab, { targetId: tab.tab, ...tab });
    } else if (step.action === BROWSER_AGENT_ACTION.SNAPSHOT) {
      seen.set(step.tab, { targetId: step.tab, url: step.url, title: step.title });
    } else {
      seen.delete(step.tab);
    }
  }
  return tabsActedOn(steps).flatMap((tab) => {
    const page = seen.get(tab);
    return page === undefined ? [] : [shownTab(page)];
  });
}

/** How long past its actions' own bounds a Mac's run may take: attaching to its tabs, and its screenshots' encoding. */
const MAC_RUN_OVERHEAD_MS = 15_000;

/**
 * How long the Mac may take over the actions, in whole seconds: each
 * action's own bound, a `wait` its longest, and room beside them, within
 * the most a Mac command may run. Note that the Mac holds the whole run
 * to this and answers only a refusal past it, so a shorter one would cut a
 * valid run short and lose the steps it took.
 */
function macTimeoutSeconds(actions: readonly BrowserAgentAction[]): number {
  const bounds = actions.reduce(
    (total, action) =>
      total +
      (action.action === BROWSER_AGENT_ACTION.WAIT
        ? BROWSER_AGENT_LIMITS.WAIT_MAX_MS
        : BROWSER_AGENT_LIMITS.ACTION_TIMEOUT_MS),
    MAC_RUN_OVERHEAD_MS,
  );
  return Math.min(Math.ceil(bounds / 1_000), MAC_COMMAND_BOUNDS.MAX_TIMEOUT_SECONDS);
}

/**
 * A call on the Browser tabs of the agent's task on the developer's own
 * Mac, sent to the starter's Mac as a browser command: refused in words
 * where the agent reaches no Mac or works on no task, the Mac's `not-run`
 * told in its own words, and its run answered as a sandbox run is.
 */
function onMac(mac: MacBrowserCall | undefined, actions: readonly BrowserAgentAction[]) {
  return Effect.gen(function* () {
    if (mac === undefined) return browserNotRun(BROWSER_TOOL_REFUSAL.NO_MAC);
    const taskId = yield* Effect.result(mac.taskId);
    if (Result.isFailure(taskId)) return browserNotRun(BROWSER_TOOL_REFUSAL.MAC_UNAVAILABLE);
    if (taskId.success === null) return browserNotRun(BROWSER_TOOL_REFUSAL.TASKLESS);
    const params: MacBrowserParams = { taskId: taskId.success, actions };
    const answer = yield* askMac(mac.userId, {
      kind: MAC_COMMAND_KIND.BROWSER,
      params,
      timeoutSeconds: macTimeoutSeconds(actions),
    });
    if (answer.status === MAC_COMMAND_STATUS.NOT_RUN) return browserNotRun(answer.reason);
    if (!("output" in answer)) return browserNotRun(BROWSER_TOOL_REFUSAL.MAC_UNREADABLE);
    const read = readMacRun(unparsedWire(answer.output));
    if (Result.isFailure(read)) return browserNotRun(BROWSER_TOOL_REFUSAL.MAC_UNREADABLE);
    const run = withMacImage(read.success, answer.image);
    return {
      status: BROWSER_TOOL_STATUS.RAN,
      ...run,
      tabs: macTabs(run.steps),
    } satisfies BrowserToolResult;
  });
}

/**
 * The browser a call is routed to, the one place every call is: the
 * developer's Mac where it says `on: "mac"`, the agent's own sandbox
 * otherwise.
 */
function browserFor(call: BrowserCall, input: typeof BROWSER_INPUT.Type) {
  return input.on === BROWSER_PLACE.MAC
    ? onMac(call.mac, input.actions)
    : onSandbox(call, input.actions);
}

/**
 * One `browser` call made for an agent, whichever agent made it: its input
 * read against the tool's schema and the call routed to its browser
 * (`browserFor`). It never fails: a browser that cannot be reached, a Mac
 * that ran nothing, or a store that cannot be read, answers `not-run` and
 * why.
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
  return browserFor(call, read.success);
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

/** A result with every screenshot's picture taken out, its size and kind left; any other result as it is. */
function withoutPictures(output: UnparsedWireValue): UnparsedWireValue {
  if (!isRecord(output) || !isRan(output) || !Array.isArray(output.steps)) return output;
  const steps: readonly UnparsedWireValue[] = output.steps;
  return unparsedWire({
    ...output,
    steps: steps.map((step) => {
      if (!isRecord(step) || !isScreenshotted(step) || !isRecord(step.image)) return step;
      const { data: _data, ...image } = step.image;
      return { ...step, image };
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
  // Note that a picture left empty is none: a Mac sends only its run's last.
  const pictures = steps.flatMap((step) =>
    isScreenshotted(step) && step.image.data !== ""
      ? [{ tab: step.tab, mime: step.image.mime, data: step.image.data }]
      : [],
  );
  if (pictures.length === 0) return { type: "json", value: output };
  return {
    type: "content",
    value: [
      { type: "text", text: JSON.stringify(withoutPictures(output)) },
      ...pictures.flatMap(({ tab, mime, data }) => [
        { type: "text" as const, text: `The screenshot of tab ${tab}:` },
        { type: "file" as const, data: { type: "data" as const, data }, mediaType: mime },
      ]),
    ],
  };
}

/** A call's result as the conversation keeps it: every screenshot without its picture. */
export function storedBrowserOutput(output: UnparsedWireValue): UnparsedWireValue {
  return withoutPictures(output);
}
