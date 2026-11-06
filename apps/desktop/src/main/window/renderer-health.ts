import path from "node:path";
import { Clock, Duration, Effect, Queue, Schedule, Stream } from "effect";
import { app, BrowserWindow, type ProcessMetric } from "electron";

const MEMORY_SAMPLE_INTERVAL = Duration.seconds(60);

const WORKING_SET_BOUND_BYTES = 1.5 * 1024 ** 3;

const BYTES_PER_KILOBYTE = 1024;

const CPU_SAMPLE_INTERVAL = Duration.seconds(15);

const CPU_SUMMARY_SPAN = Duration.minutes(5);

export const PROCESS_KIND = {
  MAIN: "main",
  RENDERER: "renderer",
  GPU: "gpu",
  UTILITY: "utility",
} as const;
export type ProcessKind = (typeof PROCESS_KIND)[keyof typeof PROCESS_KIND];

const KIND_OF_PROCESS_TYPE: Partial<Record<ProcessMetric["type"], ProcessKind>> = {
  Browser: PROCESS_KIND.MAIN,
  Tab: PROCESS_KIND.RENDERER,
  GPU: PROCESS_KIND.GPU,
  Utility: PROCESS_KIND.UTILITY,
};

export const WINDOW_STATE = {
  FOCUSED: "focused",
  VISIBLE: "visible",
  HIDDEN: "hidden",
} as const;
export type WindowState = (typeof WINDOW_STATE)[keyof typeof WINDOW_STATE];

export const WORKING_AGENTS = {
  NONE: "0",
  ONE: "1",
  FEW: "2-4",
  MANY: "5+",
} as const;
export type WorkingAgents = (typeof WORKING_AGENTS)[keyof typeof WORKING_AGENTS];

const WINDOW_EVENT = {
  UNRESPONSIVE: "unresponsive",
  RESPONSIVE: "responsive",
  CLOSED: "closed",
} as const;
type WindowEvent = (typeof WINDOW_EVENT)[keyof typeof WINDOW_EVENT];

interface FollowedPage {
  getOSProcessId(): number;
  getURL(): string;
}

export interface FollowedWindow {
  on(event: WindowEvent, listener: () => void): unknown;
  removeListener(event: WindowEvent, listener: () => void): unknown;
  readonly webContents: FollowedPage;
}

export interface UnresponsiveEpisode {
  readonly document: string;
  readonly unresponsiveMs: number;
  readonly workingSetBytes: number | undefined;
  readonly recovered: boolean;
}

export interface WorkingSetCrossing {
  readonly document: string;
  readonly workingSetBytes: number;
}

export interface CpuSummary {
  readonly process: ProcessKind;
  readonly meanPercent: number;
  readonly maxPercent: number;
  readonly windowState: WindowState;
  readonly workingAgents: WorkingAgents;
}

function documentOf(page: FollowedPage): string {
  const url = page.getURL();
  return URL.canParse(url) ? path.posix.basename(new URL(url).pathname) : "unknown";
}

function workingSetOf(pid: number): number | undefined {
  const metric = app.getAppMetrics().find((each) => each.pid === pid);
  return metric === undefined ? undefined : metric.memory.workingSetSize * BYTES_PER_KILOBYTE;
}

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

function workingAgentsRung(count: number): WorkingAgents {
  if (count >= 5) return WORKING_AGENTS.MANY;
  if (count >= 2) return WORKING_AGENTS.FEW;
  if (count === 1) return WORKING_AGENTS.ONE;
  return WORKING_AGENTS.NONE;
}

function windowStateNow(): WindowState {
  const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
  if (windows.some((window) => window.isFocused())) return WINDOW_STATE.FOCUSED;
  if (windows.some((window) => window.isVisible() && !window.isMinimized())) {
    return WINDOW_STATE.VISIBLE;
  }
  return WINDOW_STATE.HIDDEN;
}

function mostCounted<T>(counts: ReadonlyMap<T, number>): T | undefined {
  let most: T | undefined;
  let mostCount = 0;
  for (const [value, count] of counts) {
    if (count > mostCount) [most, mostCount] = [value, count];
  }
  return most;
}

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

export function sampleWindowMemory(
  crossed: (crossing: WorkingSetCrossing) => void,
): Effect.Effect<void> {
  return Effect.suspend(() => {
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

export function sampleProcessCpu(
  workingAgents: () => number,
  summarized: (summary: CpuSummary) => void,
): Effect.Effect<void> {
  return Effect.suspend(() => {
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
