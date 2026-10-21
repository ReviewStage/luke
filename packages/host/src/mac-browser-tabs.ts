import {
  BROWSER_AGENT_ACTION,
  BROWSER_STEP_STATUS,
  type BrowserAgentRun,
  type BrowserAgentStep,
  cutBrowserText,
} from "@luke/features/browser-agent-actions";
import { runBrowserActions } from "@luke/features/browser-agent-cdp";
import {
  CDP_FAILURE,
  type CdpCommand,
  type CdpEvent,
  CdpFailure,
  type CdpParams,
  type CdpSession,
  type PageTarget,
} from "@luke/features/browser-cdp";
import {
  MAC_COMMAND_BOUNDS,
  MAC_COMMAND_IMAGE_TYPE,
  type MacBrowserParams,
  type MacCommandImage,
  type MacCommandRefusal,
  type MacCommandResult,
  macCommandResultSchema,
} from "@luke/features/mac-command-wire";
import { NODE_CAPABILITY_STATUS, type NodeCapabilityResult } from "@luke/gateway";
import { type UnparsedWireValue, type WireRecord, WireValueSchema } from "@luke/wire";
import { Effect, PubSub, Result, Schema, type Scope, Stream } from "effect";

/**
 * mac-browser-tabs.ts -- an agent's browser actions on this Mac's Browser tabs: one task's tabs spoken to as a DevTools protocol session, each tab through its own view's debugger, and a browser command run over them into what it answers.
 *
 * The desktop owns the views (`apps/desktop/src/main/window/browser-views.ts`)
 * and hands this module a task's tabs, each with its debugger; this module
 * owns everything else, so the actions an agent takes here are the very ones
 * it takes in its own sandbox's browser (`@luke/features/browser-agent-cdp`),
 * with the same words and the same results. The one difference is that a
 * view's debugger speaks to its page alone, never to a browser, so the few
 * browser-level commands the actions send (attach, detach, bring to the
 * front, close) are answered here over the task's tabs: a tab is attached as
 * an action first reaches it and detached as the command ends, and a tab is
 * named by the id its panel made for it.
 *
 * A tab the developer stopped with its bar's Stop refuses every command, in
 * words an agent can act on, until the developer clicks into it again; a
 * command already in flight as Stop is pressed is refused the same way. A
 * screenshot is the actions' own, sized to `BROWSER_SCREENSHOT`, so a Mac
 * screenshot is the same size as a cloud one; it leaves the run's text and
 * goes as the result's one image, the last taken. Nothing a page holds is
 * kept, logged, or counted here; it reaches only the command's result.
 */

/** The most events a subscriber that falls behind is owed; past it the oldest give way. */
const EVENT_BACKLOG = 4096;

/** The protocol version a view's debugger is attached at. */
export const MAC_DEBUGGER_VERSION = "1.3";

/** Why an agent cannot reach a task's Browser tabs on this Mac now. */
const MAC_BROWSER_NOT_RUN = {
  /** The account has the Browser tab experiment off. */
  EXPERIMENT_OFF: "experiment-off",
  /** Luke's window is closed, so no tab could be seen. */
  WINDOW_CLOSED: "window-closed",
  /** The window neither shows the task nor holds a Browser tab on it. */
  TASK_NOT_SHOWN: "task-not-shown",
} as const;

type MacBrowserNotRun = (typeof MAC_BROWSER_NOT_RUN)[keyof typeof MAC_BROWSER_NOT_RUN];

const NOT_RUN_WORDS = {
  [MAC_BROWSER_NOT_RUN.EXPERIMENT_OFF]:
    "Not run: the Browser tab experiment is off in Luke on the developer's Mac " +
    "(Settings › Experimental › Browser tab).",
  [MAC_BROWSER_NOT_RUN.WINDOW_CLOSED]:
    "Not run: Luke's window is closed on the developer's Mac, so no Browser tab can be shown; " +
    "ask the developer to open it.",
  [MAC_BROWSER_NOT_RUN.TASK_NOT_SHOWN]:
    "Not run: Luke on the developer's Mac does not show this task and holds no Browser tab on " +
    "it; ask the developer to open the task.",
} as const satisfies Record<MacBrowserNotRun, string>;

/** What a tab the developer stopped answers every command. */
const STOPPED_WORDS =
  "the developer pressed Stop on this Browser tab, so no agent may act on it until they click " +
  "into it again; ask them before you go on";

/** What a tab whose debugger something else holds answers its attach. */
const HELD_WORDS =
  "this Browser tab's debugger is held by something else, such as its developer tools; " +
  "ask the developer to close them";

/** The protocol's capture, which a tab answers itself. */
const CAPTURE_METHOD = "Page.captureScreenshot";

/** The JPEG quality a screenshot is caught at where the command names none. */
const DEFAULT_QUALITY = 70;

/** What a capture of a tab that draws nothing answers. */
const NOTHING_DRAWN_WORDS = "the tab draws nothing to capture yet";

/** The longest address or title a list carries where the run would be too long with them whole. */
const LIST_CUT_CHARS = 200;

/** What a run answers whose text stays over the output a result carries, even with its page texts let go. */
const TOO_LONG: MacCommandRefusal = {
  refused:
    "The browser actions ran, but what they answered was too long to send back; " +
    "take fewer actions in one call.",
};

/** What an open the window could not draw answers. */
const NOT_OPENED_WORDS = "the Browser tab could not be opened in Luke's window on the Mac";

/** One Browser tab's debugger, as the desktop hands it over: attached for a command, detached after. */
export interface MacTabDebugger {
  /** Takes the debugger for an agent; throws where it cannot be taken, such as while its developer tools hold it. */
  readonly attach: () => void;
  /** Gives the debugger back; nothing where it was not taken. */
  readonly detach: () => void;
  /** Sends one command to the tab's page and answers its result, or rejects with the page's refusal. */
  readonly send: (method: string, params: CdpCommand["params"]) => Promise<unknown>;
  /** Hears every event the page sends while attached; answers the way to stop hearing. */
  readonly onEvent: (listener: (method: string, params: unknown) => void) => () => void;
}

/** How a screenshot is asked of a tab: the JPEG quality, and the scale its pixels are taken at. */
export interface MacTabShot {
  readonly quality: number;
  readonly scale: number;
}

/** One Browser tab on a task: the id its panel made, where its page stands, whether it is stopped, and its debugger. */
export interface MacBrowserTab {
  readonly id: string;
  /** Where the tab's page stands now: its address and title. */
  readonly page: () => { readonly url: string; readonly title: string };
  /**
   * The tab's visible page as a JPEG in base64, at the quality and scale
   * asked, drawn even while the tab is out of sight; none where it draws
   * nothing. The protocol's own capture waits on a frame a hidden view never
   * draws, so a screenshot is caught here instead.
   */
  readonly capture: (shot: MacTabShot) => Promise<string | undefined>;
  /** Whether the developer stopped agents on it with its bar's Stop, which their click into it lifts. */
  readonly stopped: () => boolean;
  readonly debugger: MacTabDebugger;
}

/** One task's Browser tabs, as an agent on the task reaches them. */
export interface MacTaskTabs {
  /** The tabs open on the task, in the order opened. */
  readonly list: () => readonly MacBrowserTab[];
  /** Opens a tab on the task at the address, which the panel draws without taking the keyboard; none where it could not. */
  readonly open: (url: string) => MacBrowserTab | undefined;
  /** Closes a tab of the task, which the panel lets go; false where the task holds no such tab. */
  readonly close: (id: string) => boolean;
}

/** This Mac's Browser tabs by task, as the desktop holds them. */
export interface MacBrowserTabs {
  /** The task's tabs, or why an agent cannot reach them now. */
  readonly tabsOf: (
    taskId: string,
  ) => { readonly tabs: MacTaskTabs } | { readonly notRun: MacBrowserNotRun };
}

const isWire = Schema.is(WireValueSchema);

/** What the page answered, as a wire value; none where it answered nothing JSON carries. */
function wireOf(value: unknown): UnparsedWireValue {
  return isWire(value) ? value : undefined;
}

/** A command's params as a record, where it carries one. */
function stringParam(command: CdpCommand, key: string): string | undefined {
  const value = command.params?.[key];
  return typeof value === "string" ? value : undefined;
}

/** A number a protocol value carries, where it is one. */
function numberOf(value: CdpParams[string] | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** The quality and scale a protocol capture asks for: its quality, and its clip's scale. */
function shotOf(command: CdpCommand): MacTabShot {
  const clip = command.params?.clip;
  const record = typeof clip === "object" && clip !== null && !Array.isArray(clip) ? clip : {};
  return {
    quality: numberOf(command.params?.quality) ?? DEFAULT_QUALITY,
    scale: numberOf("scale" in record ? record.scale : undefined) ?? 1,
  };
}

const denied = (method: string, detail: string) =>
  new CdpFailure({ kind: CDP_FAILURE.DENIED, method, detail });

const refused = (method: string, detail: string) =>
  new CdpFailure({ kind: CDP_FAILURE.REFUSED, method, detail });

/** A tab's page target, as the actions list one. */
function targetOf(tab: MacBrowserTab): PageTarget {
  const { url, title } = tab.page();
  return { targetId: tab.id, url, title };
}

/**
 * One task's tabs as a DevTools protocol session for the scope it is made
 * in. A command for a tab goes to that tab's debugger; the browser-level
 * commands the actions send are answered over the tabs. Every tab attached
 * is detached as the scope ends, whichever way it ends.
 */
function macBrowserSession(tabs: MacTaskTabs): Effect.Effect<CdpSession, never, Scope.Scope> {
  return Effect.gen(function* () {
    const events = yield* PubSub.sliding<CdpEvent>(EVENT_BACKLOG);
    const attached = new Map<
      string,
      { readonly tab: MacBrowserTab; readonly unhear: () => void }
    >();

    const release = (id: string) => {
      const held = attached.get(id);
      if (held === undefined) return;
      attached.delete(id);
      held.unhear();
      held.tab.debugger.detach();
    };
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const id of [...attached.keys()]) release(id);
      }),
    );

    const tabNamed = (id: string | undefined) => tabs.list().find((tab) => tab.id === id);

    const attach = (command: CdpCommand) =>
      Effect.suspend(() => {
        const tab = tabNamed(stringParam(command, "targetId"));
        if (tab === undefined)
          return Effect.fail(refused(command.method, "No target with given id found"));
        if (tab.stopped()) return Effect.fail(denied(command.method, STOPPED_WORDS));
        if (!attached.has(tab.id)) {
          try {
            tab.debugger.attach();
          } catch {
            return Effect.fail(denied(command.method, HELD_WORDS));
          }
          const sessionId = tab.id;
          const unhear = tab.debugger.onEvent((method, params) => {
            PubSub.publishUnsafe(events, { method, params: wireOf(params), sessionId });
          });
          attached.set(tab.id, { tab, unhear });
        }
        return Effect.succeed<UnparsedWireValue>({ sessionId: tab.id });
      });

    const close = (command: CdpCommand) =>
      Effect.suspend(() => {
        const tab = tabNamed(stringParam(command, "targetId"));
        if (tab === undefined) return Effect.succeed<UnparsedWireValue>({ success: false });
        if (tab.stopped()) return Effect.fail(denied(command.method, STOPPED_WORDS));
        release(tab.id);
        return Effect.succeed<UnparsedWireValue>({ success: tabs.close(tab.id) });
      });

    /** A browser-level command, answered over the task's tabs. */
    const browserLevel = (command: CdpCommand): Effect.Effect<UnparsedWireValue, CdpFailure> => {
      switch (command.method) {
        case "Target.attachToTarget":
          return attach(command);
        case "Target.detachFromTarget":
          return Effect.sync(() => {
            release(stringParam(command, "sessionId") ?? "");
            return {};
          });
        // Note that a tab behind another is captured as it stands, since its view keeps drawing while an agent holds its debugger.
        case "Target.activateTarget":
          return Effect.succeed({});
        case "Target.closeTarget":
          return close(command);
        default:
          return Effect.fail(refused(command.method, `'${command.method}' wasn't found`));
      }
    };

    /** A command for one attached tab, sent to its debugger, a screenshot caught by the tab itself; a stopped tab refuses it, before it is sent and as it answers. */
    const onTab = (sessionId: string, command: CdpCommand) =>
      Effect.suspend(() => {
        const held = attached.get(sessionId);
        if (held === undefined) {
          return Effect.fail(new CdpFailure({ kind: CDP_FAILURE.CLOSED, method: command.method }));
        }
        const { tab } = held;
        if (tab.stopped()) return Effect.fail(denied(command.method, STOPPED_WORDS));
        if (command.method === CAPTURE_METHOD) return captured(tab, command);
        return Effect.tryPromise({
          try: () => tab.debugger.send(command.method, command.params),
          catch: (cause) =>
            tab.stopped()
              ? denied(command.method, STOPPED_WORDS)
              : refused(command.method, cause instanceof Error ? cause.message : String(cause)),
        }).pipe(Effect.map(wireOf));
      });

    /** A screenshot the protocol asked for, caught by the tab at the quality and the clip's scale asked. */
    const captured = (tab: MacBrowserTab, command: CdpCommand) =>
      Effect.tryPromise({
        try: () => tab.capture(shotOf(command)),
        catch: () => refused(command.method, NOTHING_DRAWN_WORDS),
      }).pipe(
        Effect.flatMap((data) =>
          data === undefined
            ? Effect.fail(refused(command.method, NOTHING_DRAWN_WORDS))
            : Effect.succeed<UnparsedWireValue>({ data }),
        ),
      );

    return {
      send: (command) =>
        command.sessionId === undefined ? browserLevel(command) : onTab(command.sessionId, command),
      events: Stream.fromPubSub(events),
      pages: Effect.sync(() => tabs.list().map(targetOf)),
      openPage: (url) =>
        Effect.suspend(() => {
          const opened = tabs.open(url);
          return opened === undefined
            ? Effect.fail(denied("Target.createTarget", NOT_OPENED_WORDS))
            : Effect.succeed(opened.id);
        }),
      closePage: (targetId) =>
        Effect.asVoid(close({ method: "Target.closeTarget", params: { targetId } })),
    } satisfies CdpSession;
  });
}

/** What the desktop says of its window and its Browser tabs, which an agent's reach is decided from. */
export interface MacBrowserDesk<Panel> {
  /** Whether the account has the Browser tab experiment on now. */
  readonly experimentOn: () => boolean;
  /** The panel while Luke's window is open on screen; none while it is closed. */
  readonly panel: () => Panel | undefined;
  /** The task the window shows now, by its id; none where it shows none. */
  readonly shownTask: () => string | undefined;
  /** The panel's Browser tabs on the task. */
  readonly tabsOn: (panel: Panel, taskId: string) => MacTaskTabs;
}

/**
 * This Mac's Browser tabs by task, as an agent reaches them: refused while
 * the experiment is off, while the window is closed, and where the window
 * neither shows the task nor holds a Browser tab on it; otherwise every
 * tab on the task, whichever task the window shows now.
 */
export function macBrowserTabsOver<Panel>(desk: MacBrowserDesk<Panel>): MacBrowserTabs {
  return {
    tabsOf: (taskId) => {
      if (!desk.experimentOn()) return { notRun: MAC_BROWSER_NOT_RUN.EXPERIMENT_OFF };
      const panel = desk.panel();
      if (panel === undefined) return { notRun: MAC_BROWSER_NOT_RUN.WINDOW_CLOSED };
      const tabs = desk.tabsOn(panel, taskId);
      if (tabs.list().length === 0 && desk.shownTask() !== taskId) {
        return { notRun: MAC_BROWSER_NOT_RUN.TASK_NOT_SHOWN };
      }
      return { tabs };
    },
  };
}

/** A step as the run's text carries it: a screenshot's picture left out, since it goes as the result's image. */
function textStep(step: BrowserAgentStep): BrowserAgentStep {
  return step.action === BROWSER_AGENT_ACTION.SCREENSHOT &&
    step.status !== BROWSER_STEP_STATUS.FAILED
    ? { ...step, image: { ...step.image, data: "" } }
    : step;
}

/** How long a run's text is, as the result's output carries it. */
function textLength(run: BrowserAgentRun): number {
  return JSON.stringify(run).length;
}

/** A step with its page text let go: a snapshot's tree, or a console's messages, each marked cut. */
function emptied(step: BrowserAgentStep): BrowserAgentStep {
  if (step.status === BROWSER_STEP_STATUS.FAILED) return step;
  if (step.action === BROWSER_AGENT_ACTION.SNAPSHOT) return { ...step, text: "", truncated: true };
  if (step.action === BROWSER_AGENT_ACTION.CONSOLE)
    return { ...step, messages: [], truncated: true };
  return step;
}

/**
 * A run's text held to the output a result may carry
 * (`MAC_COMMAND_BOUNDS.MAX_BROWSER_OUTPUT_CHARS`): the page texts of the
 * earliest steps let go first, so the latest snapshot an agent took is the
 * one it reads.
 * Note that the service refuses a result over the bound whole, so a run of
 * several snapshots would otherwise answer nothing at all.
 */
function heldToOutput(run: BrowserAgentRun): BrowserAgentRun | undefined {
  const max = MAC_COMMAND_BOUNDS.MAX_BROWSER_OUTPUT_CHARS;
  let held = run;
  for (let at = 0; at < held.steps.length && textLength(held) > max; at += 1) {
    const steps = held.steps.map((step, index) => (index === at ? emptied(step) : step));
    held = { ...held, steps };
  }
  if (textLength(held) > max) held = { ...held, steps: held.steps.map(listCut) };
  return textLength(held) > max ? undefined : held;
}

/** A list's tabs with each address and title cut to the length a list is held to where it is too long whole. */
function listCut(step: BrowserAgentStep): BrowserAgentStep {
  if (step.action !== BROWSER_AGENT_ACTION.LIST || step.status === BROWSER_STEP_STATUS.FAILED) {
    return step;
  }
  const tabs = step.tabs.map((tab) => ({
    tab: tab.tab,
    url: cutBrowserText(tab.url, LIST_CUT_CHARS),
    title: cutBrowserText(tab.title, LIST_CUT_CHARS),
  }));
  return { ...step, tabs };
}

/** The last screenshot a run took, as a command's result carries an image. */
function lastScreenshot(run: BrowserAgentRun): MacCommandImage | undefined {
  const shot = run.steps.findLast(
    (step) => step.action === BROWSER_AGENT_ACTION.SCREENSHOT && "image" in step,
  );
  if (shot === undefined || !("image" in shot)) return undefined;
  return { mediaType: MAC_COMMAND_IMAGE_TYPE.JPEG, data: shot.image.data };
}

/**
 * A browser command run on the task's tabs: the run as the result's output,
 * every screenshot's picture taken out of it, and the last one as its image;
 * or, where the tabs cannot be reached, why not in words an agent can act on.
 */
export function runMacBrowserCommand(
  tabs: MacBrowserTabs,
  params: MacBrowserParams,
): Effect.Effect<MacCommandResult> {
  return Effect.suspend(() => {
    const reached = tabs.tabsOf(params.taskId);
    if ("notRun" in reached) {
      return Effect.succeed<MacCommandRefusal>({ refused: NOT_RUN_WORDS[reached.notRun] });
    }
    return Effect.scoped(
      Effect.flatMap(macBrowserSession(reached.tabs), (cdp) =>
        runBrowserActions(cdp, params.actions),
      ),
    ).pipe(
      Effect.map((run): MacCommandResult => {
        const output = heldToOutput({ steps: run.steps.map(textStep), skipped: run.skipped });
        if (output === undefined) return TOO_LONG;
        const image = lastScreenshot(run);
        return image === undefined ? { output } : { output, image };
      }),
    );
  });
}

const decodeResult = Schema.decodeUnknownResult(macCommandResultSchema);

/** What a browser command answers where this Mac's node gave back nothing it could read. */
const UNREAD_ANSWER: MacCommandRefusal = {
  refused:
    "Not run: Luke on the developer's Mac answered the browser actions with something it could not read.",
};

/** A browser command's params as this Mac's node is asked them. */
export function macBrowserParamsWire(params: MacBrowserParams): WireRecord {
  return { taskId: params.taskId, actions: params.actions };
}

/** What this Mac's node answered a browser command, as the command's result: its run, or why it ran nothing. */
export function macBrowserResultOf(answer: NodeCapabilityResult): MacCommandResult {
  if (answer.status !== NODE_CAPABILITY_STATUS.OK) {
    return { refused: `Not run: ${answer.reason}.` };
  }
  const result = decodeResult(answer.value);
  return Result.isFailure(result) ? UNREAD_ANSWER : result.success;
}
