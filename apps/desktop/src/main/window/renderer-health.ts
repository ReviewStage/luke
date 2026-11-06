/**
 * renderer-health.ts -- how each window's renderer fares, as main hears it: a panel that stopped answering, once per episode, a window grown past its memory bound, and the CPU each kind of process spends.
 *
 * Electron tells main when a window's page stops answering and when it
 * answers again; main reads each process's working set from the operating
 * system. Neither needs the page's own help, so both are heard here even
 * when the page itself is too busy to report anything. What is heard is
 * handed to the reporter the caller names (Sentry, `telemetry-service.ts`),
 * and carries no word of the page: which document it is, how long, how much.
 */

import path from "node:path";
import { Clock, Duration, Effect, Queue, Schedule, Stream } from "effect";
import { app, BrowserWindow, type ProcessMetric } from "electron";

/** How often every window's working set is read. */
const MEMORY_SAMPLE_INTERVAL = Duration.seconds(60);

/** The working set a window may grow to before it is noted: past it, a panel is holding far more than it draws. */
const WORKING_SET_BOUND_BYTES = 1.5 * 1024 ** 3;

/** Electron's process metrics count memory in kilobytes. */
const BYTES_PER_KILOBYTE = 1024;

/** How often every process's CPU time is read. */
const CPU_SAMPLE_INTERVAL = Duration.seconds(15);

/** How long the samples gather before each kind of process's are summed up and handed on. */
const CPU_SUMMARY_SPAN = Duration.minutes(5);

/** The kinds of process whose CPU is summarized. */
export const PROCESS_KIND = {
  MAIN: "main",
  RENDERER: "renderer",
  GPU: "gpu",
  UTILITY: "utility",
} as const;
export type ProcessKind = (typeof PROCESS_KIND)[keyof typeof PROCESS_KIND];

/** Each kind by Electron's name for it; a process of any other type is left out. */
const KIND_OF_PROCESS_TYPE: Partial<Record<ProcessMetric["type"], ProcessKind>> = {
  Browser: PROCESS_KIND.MAIN,
  Tab: PROCESS_KIND.RENDERER,
  GPU: PROCESS_KIND.GPU,
  Utility: PROCESS_KIND.UTILITY,
};

/** Where the app's windows stand as a sample is read: one has the focus, one shows without it, or none shows. */
export const WINDOW_STATE = {
  FOCUSED: "focused",
  VISIBLE: "visible",
  HIDDEN: "hidden",
} as const;
export type WindowState = (typeof WINDOW_STATE)[keyof typeof WINDOW_STATE];

/** How many agents were working as a sample is read, by rung. */
export const WORKING_AGENTS = {
  NONE: "0",
  ONE: "1",
  FEW: "2-4",
  MANY: "5+",
} as const;
export type WorkingAgents = (typeof WORKING_AGENTS)[keyof typeof WORKING_AGENTS];

/** What a window says of its page's responsiveness, by Electron's event names, and its close, which ends the following. */
const WINDOW_EVENT = {
  UNRESPONSIVE: "unresponsive",
  RESPONSIVE: "responsive",
  CLOSED: "closed",
} as const;
type WindowEvent = (typeof WINDOW_EVENT)[keyof typeof WINDOW_EVENT];

/** The page behind a window, as far as this reads it. */
interface FollowedPage {
  getOSProcessId(): number;
  getURL(): string;
}

/** A window as its responsiveness is followed: Electron's own events on it, and its page. */
export interface FollowedWindow {
  on(event: WindowEvent, listener: () => void): unknown;
  removeListener(event: WindowEvent, listener: () => void): unknown;
  readonly webContents: FollowedPage;
}

/** One stretch of a window not answering, from the first `unresponsive` to the `responsive` or close that ended it. */
export interface UnresponsiveEpisode {
  /** The document the window had loaded: `index.html` for a panel. */
  readonly document: string;
  readonly unresponsiveMs: number;
  /** The page's working set as it stopped answering; none where the system listed no such process. */
  readonly workingSetBytes: number | undefined;
  /** Whether the page answered again, rather than the window closing on it. */
  readonly recovered: boolean;
}

/** A window found past the memory bound on one sample. */
export interface WorkingSetCrossing {
  readonly document: string;
  readonly workingSetBytes: number;
}

/** One kind of process's CPU over a summary's span, as a percentage of one core. */
export interface CpuSummary {
  readonly process: ProcessKind;
  /** The mean over the span's samples of every process of this kind together. */
  readonly meanPercent: number;
  /** The highest one sample read. */
  readonly maxPercent: number;
  /** Where the windows stood on most of the span's samples. */
  readonly windowState: WindowState;
  /** How many agents were working on most of the span's samples. */
  readonly workingAgents: WorkingAgents;
}

/** The document a page has loaded, by its file's name, never its whole address. */
function documentOf(page: FollowedPage): string {
  const url = page.getURL();
  return URL.canParse(url) ? path.posix.basename(new URL(url).pathname) : "unknown";
}

/** The working set of one process, in bytes, as the system last measured it. */
function workingSetOf(pid: number): number | undefined {
  const metric = app.getAppMetrics().find((each) => each.pid === pid);
  return metric === undefined ? undefined : metric.memory.workingSetSize * BYTES_PER_KILOBYTE;
}

/** Every event the window says of its responsiveness, until it closes, its listeners taken back as the stream ends. */
function windowEvents(window: FollowedWindow): Stream.Stream<WindowEvent> {
  return Stream.callback<WindowEvent>((queue) =>
    Effect.forEach(
      Object.values(WINDOW_EVENT),
      (event) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const heard = () => {
              Queue.offerUnsafe(queue, event);
            };
            window.on(event, heard);
            return heard;
          }),
          (heard) =>
            Effect.sync(() => {
              window.removeListener(event, heard);
            }),
        ),
      { discard: true },
    ),
  ).pipe(Stream.takeUntil((event) => event === WINDOW_EVENT.CLOSED));
}

/** The rung a count of working agents stands on. */
function workingAgentsRung(count: number): WorkingAgents {
  if (count >= 5) return WORKING_AGENTS.MANY;
  if (count >= 2) return WORKING_AGENTS.FEW;
  if (count === 1) return WORKING_AGENTS.ONE;
  return WORKING_AGENTS.NONE;
}

/** Where the app's windows stand now. */
function windowStateNow(): WindowState {
  const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
  if (windows.some((window) => window.isFocused())) return WINDOW_STATE.FOCUSED;
  if (windows.some((window) => window.isVisible() && !window.isMinimized())) {
    return WINDOW_STATE.VISIBLE;
  }
  return WINDOW_STATE.HIDDEN;
}

/** The value counted most often, the first counted winning a tie. */
function mostCounted<T>(counts: ReadonlyMap<T, number>): T | undefined {
  let most: T | undefined;
  let mostCount = 0;
  for (const [value, count] of counts) {
    if (count > mostCount) [most, mostCount] = [value, count];
  }
  return most;
}

/**
 * Follows one window until it closes, handing `report` each episode of its
 * page not answering, once: when it answers again, or when the window
 * closes while it still does not. Note that Electron may say `unresponsive`
 * again before it says `responsive`, which is the same episode, and that
 * the working set is read as the page stops answering, since that is the
 * page the freeze is about.
 */
export function followResponsiveness(
  window: FollowedWindow,
  report: (episode: UnresponsiveEpisode) => Effect.Effect<void>,
): Effect.Effect<void> {
  return Effect.suspend(() => {
    let since:
      | { readonly at: number; readonly document: string; readonly workingSetBytes?: number }
      | undefined;
    const ended = (recovered: boolean) =>
      Effect.gen(function* () {
        const began = since;
        if (began === undefined) return;
        since = undefined;
        const now = yield* Clock.currentTimeMillis;
        yield* report({
          document: began.document,
          unresponsiveMs: now - began.at,
          workingSetBytes: began.workingSetBytes,
          recovered,
        });
      });
    return Stream.runForEach(windowEvents(window), (event) => {
      if (event === WINDOW_EVENT.RESPONSIVE) return ended(true);
      if (event === WINDOW_EVENT.CLOSED) return ended(false);
      if (since !== undefined) return Effect.void;
      return Effect.map(Clock.currentTimeMillis, (at) => {
        const page = window.webContents;
        const workingSetBytes = workingSetOf(page.getOSProcessId());
        since = {
          at,
          document: documentOf(page),
          ...(workingSetBytes === undefined ? undefined : { workingSetBytes }),
        };
      });
    });
  });
}

/**
 * Reads every window's working set now and then, for as long as it runs,
 * handing `crossed` each window found past the bound that was not past it
 * on the sample before: one note as it crosses, not one a minute while it
 * stays there, and another only once it fell back under and crossed again.
 */
export function sampleWindowMemory(
  crossed: (crossing: WorkingSetCrossing) => void,
): Effect.Effect<void> {
  return Effect.suspend(() => {
    // The pages past the bound on the last sample, by their contents' id.
    let over = new Set<number>();
    const sample = Effect.sync(() => {
      const now = new Set<number>();
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.isDestroyed()) continue;
        const page = window.webContents;
        const workingSetBytes = workingSetOf(page.getOSProcessId());
        if (workingSetBytes === undefined || workingSetBytes <= WORKING_SET_BOUND_BYTES) continue;
        now.add(page.id);
        if (!over.has(page.id)) crossed({ document: documentOf(page), workingSetBytes });
      }
      over = now;
    });
    return Effect.asVoid(Effect.repeat(sample, Schedule.spaced(MEMORY_SAMPLE_INTERVAL)));
  });
}

/**
 * Reads every process's CPU time now and then, for as long as it runs, and
 * hands `summarized` one summary per kind of process at the end of each
 * span: its mean and its highest sample, with where the windows stood and
 * how many agents worked on most of them. A sample is each process's CPU
 * time since the one before, divided by the time between them, summed over
 * the processes of a kind. Note that it reads Electron's cumulative CPU
 * time rather than its `percentCPUUsage`, which counts from whatever last
 * asked for the metrics, and `workingSetOf` above asks too; and that a
 * process first seen on a sample counts from the next.
 */
export function sampleProcessCpu(
  workingAgents: () => number,
  summarized: (summary: CpuSummary) => void,
): Effect.Effect<void> {
  return Effect.suspend(() => {
    // Each process's cumulative CPU seconds on the last sample, by its pid, and when that was.
    let last: { readonly at: number; readonly cpuSeconds: ReadonlyMap<number, number> } | undefined;
    let spanStart: number | undefined;
    let percents = new Map<ProcessKind, number[]>();
    let windowStates = new Map<WindowState, number>();
    let agentRungs = new Map<WorkingAgents, number>();
    const count = <T>(counts: Map<T, number>, value: T) => {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    };
    const summarize = () => {
      const windowState = mostCounted(windowStates) ?? WINDOW_STATE.HIDDEN;
      const working = mostCounted(agentRungs) ?? WORKING_AGENTS.NONE;
      for (const [process, samples] of percents) {
        const total = samples.reduce((sum, each) => sum + each, 0);
        summarized({
          process,
          meanPercent: total / samples.length,
          maxPercent: Math.max(...samples),
          windowState,
          workingAgents: working,
        });
      }
      percents = new Map();
      windowStates = new Map();
      agentRungs = new Map();
    };
    const sample = Effect.flatMap(Clock.currentTimeMillis, (at) =>
      Effect.sync(() => {
        const cpuSeconds = new Map<number, number>();
        const byKind = new Map<ProcessKind, number>();
        for (const metric of app.getAppMetrics()) {
          const kind = KIND_OF_PROCESS_TYPE[metric.type];
          const seconds = metric.cpu.cumulativeCPUUsage;
          if (kind === undefined || seconds === undefined) continue;
          cpuSeconds.set(metric.pid, seconds);
          const before = last?.cpuSeconds.get(metric.pid);
          if (last === undefined || before === undefined || at <= last.at) continue;
          const percent = (100 * Math.max(0, seconds - before) * 1000) / (at - last.at);
          byKind.set(kind, (byKind.get(kind) ?? 0) + percent);
        }
        if (last !== undefined) {
          for (const [kind, percent] of byKind) {
            const samples = percents.get(kind) ?? [];
            samples.push(percent);
            percents.set(kind, samples);
          }
          count(windowStates, windowStateNow());
          count(agentRungs, workingAgentsRung(workingAgents()));
        }
        last = { at, cpuSeconds };
        spanStart ??= at;
        if (at - spanStart < Duration.toMillis(CPU_SUMMARY_SPAN)) return;
        summarize();
        spanStart = at;
      }),
    );
    return Effect.asVoid(Effect.repeat(sample, Schedule.spaced(CPU_SAMPLE_INTERVAL)));
  });
}
