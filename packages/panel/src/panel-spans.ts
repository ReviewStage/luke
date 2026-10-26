/**
 * panel-spans.ts -- the panel's own timings of what the developer waits on, handed to whatever traces the window, or to no one.
 *
 * The panel times a task opening and its agent's transcript drawing and
 * catching up, the window's own start to its first state drawn and to its
 * first task list read, and a keystroke in a box timed to the paint that
 * followed it, and hands each one, once it ended, to the recorder its shell
 * installed: the desktop's panel window answers it with Sentry's renderer
 * SDK (`apps/desktop/src/renderer/desktop-sentry-sdk.ts`), which samples it
 * at the window's own trace rate. A window with no recorder, a test's or a
 * shell that traces nothing, times nothing, which is why this is a door of
 * its own rather than a capability every shell must answer.
 *
 * Note that a span's attributes are numbers alone, and read only where the
 * recorder keeps the span, so an unsampled one costs nothing to measure and
 * no attribute can carry a message's words or a credential. A keystroke's
 * span says how long it waited and nothing of the key or the words.
 */

import { useCallback, useRef } from "react";

/** The spans the panel times, under the names Sentry lists them by. */
export const PANEL_SPAN = {
  /** A task's press to its document drawn ready. */
  TASK_OPEN: "task.open",
  /** A transcript followed to its first page committed. */
  TRANSCRIPT_FIRST_PAINT: "transcript.first_paint",
  /** A transcript followed to the page that left nothing more to read. */
  TRANSCRIPT_CAUGHT_UP: "transcript.caught_up",
  /** The window's root starting to its first state drawn. */
  WINDOW_FIRST_PAINT: "window.first_paint",
  /** The window's root starting to the sidebar's first task list read answered. */
  WINDOW_FIRST_USABLE: "window.first_usable",
  /** A key pressed in a message box to the paint after it. */
  KEYSTROKE_COMPOSER: "keystroke.composer",
  /** A key pressed in ⌘K's search field to the paint after it. */
  KEYSTROKE_COMMAND_PALETTE: "keystroke.command_palette",
} as const;
type PanelSpanName = (typeof PANEL_SPAN)[keyof typeof PANEL_SPAN];

/** The spans timed from the window's start, each at most once a window. */
type WindowSpanName = typeof PANEL_SPAN.WINDOW_FIRST_PAINT | typeof PANEL_SPAN.WINDOW_FIRST_USABLE;

/** The spans a box's keystrokes are timed under. */
type KeystrokeSpanName =
  | typeof PANEL_SPAN.KEYSTROKE_COMPOSER
  | typeof PANEL_SPAN.KEYSTROKE_COMMAND_PALETTE;

/** What a span says of what it waited on, by Sentry's attribute names. */
export const PANEL_SPAN_ATTRIBUTE = {
  /** How many messages the transcript held as the span ended. */
  MESSAGE_COUNT: "transcript.message_count",
  /** The size of the page that ended the span, as its JSON. */
  PAGE_BYTES: "transcript.page_bytes",
  /** Whether the follow's first page was the window the host held from the last time it was followed, 1, or read from the service, 0. */
  CACHE_HIT: "transcript.cache_hit",
  /** The size of the plan the task opened on, in characters. */
  PLAN_CHARS: "task.plan_chars",
  /** How many tasks, of every workspace, the sidebar's first list read answered. */
  TASK_COUNT: "window.task_count",
  /** How long a keystroke waited before its handlers ran, in milliseconds. */
  INPUT_DELAY: "keystroke.input_delay_ms",
  /** How long a keystroke's handlers ran, in milliseconds. */
  PROCESSING: "keystroke.processing_ms",
} as const;
type PanelSpanAttribute = (typeof PANEL_SPAN_ATTRIBUTE)[keyof typeof PANEL_SPAN_ATTRIBUTE];

/** One timing, ended: when it started and ended, in the epoch's milliseconds, and what it measured, read only where it is kept. */
export interface PanelSpan {
  readonly name: PanelSpanName;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly attributes: () => Partial<Readonly<Record<PanelSpanAttribute, number>>>;
}

/** What a shell records a span through. */
export type PanelSpanRecorder = (span: PanelSpan) => void;

/**
 * The shortest wait the browser reports a keystroke for, the least Event
 * Timing allows: a key whose paint came within a frame is not reported, so
 * only the keystrokes a person could feel are timed.
 */
const KEYSTROKE_REPORTED_MS = 16;

/**
 * What the keystroke observer hears: every event the browser times past that
 * wait. Note that TypeScript's DOM types do not yet name Event Timing's
 * threshold, so the shape says it.
 */
const KEYSTROKES_OBSERVED: PerformanceObserverInit & { readonly durationThreshold: number } = {
  type: "event",
  durationThreshold: KEYSTROKE_REPORTED_MS,
};

let recorder: PanelSpanRecorder | undefined;

/** When this window's root started, and the spans timed from it that have ended; none where the shell times no start. */
let windowStart: { readonly at: number; readonly ended: Set<WindowSpanName> } | undefined;

/** The boxes whose keystrokes are timed, each by the span it is timed under. */
const timedBoxes = new Map<Element, KeystrokeSpanName>();

/** What hears the browser's keystroke timings, from the first time a box is timed. */
let keystrokeObserver: PerformanceObserver | undefined;

/** The span a keystroke on `target` is timed under: the timed box it was pressed in, if any. */
function timedBoxOf(target: Node | null): KeystrokeSpanName | undefined {
  if (target === null) return undefined;
  for (const [box, name] of timedBoxes) if (box.contains(target)) return name;
  return undefined;
}

/** Whether a timing the browser reported is an event's, as every one an `event` observer hears is. */
function isEventTiming(entry: PerformanceEntry): entry is PerformanceEventTiming {
  return "processingStart" in entry;
}

/**
 * Records each key pressed in a timed box from the moment it was pressed to
 * the paint after it, every handler it ran among it; the key's own wait
 * before its handlers and their run are what it says of it.
 */
function recordKeystrokes(list: PerformanceObserverEntryList): void {
  for (const entry of list.getEntriesByName("keydown")) {
    if (!isEventTiming(entry)) continue;
    const name = timedBoxOf(entry.target);
    if (name === undefined) continue;
    const startedAt = performance.timeOrigin + entry.startTime;
    const delay = entry.processingStart - entry.startTime;
    const processing = entry.processingEnd - entry.processingStart;
    recordPanelSpan({
      name,
      startedAt,
      endedAt: startedAt + entry.duration,
      attributes: () => ({
        [PANEL_SPAN_ATTRIBUTE.INPUT_DELAY]: delay,
        [PANEL_SPAN_ATTRIBUTE.PROCESSING]: processing,
      }),
    });
  }
}

/** Whether this window's browser reports how long a keystroke waited. */
function reportsKeystrokes(): boolean {
  return (
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes.includes("event")
  );
}

/**
 * Times every key pressed in `box` under `name`, answering what stops it.
 * A window with no recorder, or a browser that reports no keystroke, times
 * nothing. One observer hears every box, made the first time one is timed
 * and kept, because a box's ref is handed back and given again as its owner
 * draws, and a timing reported between the two must not be lost with it.
 */
function timeKeystrokes(box: Element, name: KeystrokeSpanName): () => void {
  if (recorder === undefined || !reportsKeystrokes()) return () => undefined;
  timedBoxes.set(box, name);
  if (keystrokeObserver === undefined) {
    keystrokeObserver = new PerformanceObserver(recordKeystrokes);
    keystrokeObserver.observe(KEYSTROKES_OBSERVED);
  }
  return () => {
    timedBoxes.delete(box);
  };
}

/** Installs what this window records its spans through, and answers what takes it back. */
export function installPanelSpanRecorder(installed: PanelSpanRecorder): () => void {
  recorder = installed;
  return () => {
    if (recorder === installed) recorder = undefined;
  };
}

/** Hands one ended span to the window's recorder; a window with none records nothing. */
export function recordPanelSpan(span: PanelSpan): void {
  recorder?.(span);
}

/**
 * Marks this window's root starting, which its window spans are timed from;
 * a window whose shell marks none times none. Marked again, the window's
 * spans start afresh.
 */
export function markWindowStart(at: number = Date.now()): void {
  windowStart = { at, ended: new Set() };
}

/**
 * Ends one of the window's spans now, recording it from the window's start
 * the first time and never again; `attributes` are read only where it is kept.
 */
export function endWindowSpan(
  name: WindowSpanName,
  attributes: PanelSpan["attributes"] = () => ({}),
): void {
  if (windowStart === undefined || windowStart.ended.has(name)) return;
  windowStart.ended.add(name);
  recordPanelSpan({ name, startedAt: windowStart.at, endedAt: Date.now(), attributes });
}

/** Ends one of the window's spans untimed, so nothing later records it: the wait it measured never came to stand. */
export function leaveWindowSpan(name: WindowSpanName): void {
  windowStart?.ended.add(name);
}

/**
 * Ends one of the window's spans once `root` is first drawn into, which is
 * the commit of the first surface rendered there: a root draws into its
 * element only as it commits. Note that the draw is heard just after the
 * commit, so a span left as the commit runs, a surface that failed and drew
 * its fallback, is never recorded.
 */
export function endWindowSpanOnFirstDraw(root: Element, name: WindowSpanName): void {
  const drawn = new MutationObserver(() => {
    drawn.disconnect();
    endWindowSpan(name);
  });
  drawn.observe(root, { childList: true });
}

/**
 * The ref of a box whose keystrokes are timed under `name`, each from the key
 * pressed to the paint after it, for as long as the box stands.
 */
export function useKeystrokeSpans(name: KeystrokeSpanName): (box: Element | null) => void {
  const stop = useRef<(() => void) | undefined>(undefined);
  // Note that a box that goes is handed back as null, which stops its timing.
  return useCallback(
    (box: Element | null) => {
      stop.current?.();
      stop.current = box === null ? undefined : timeKeystrokes(box, name);
    },
    [name],
  );
}

/** The size of a value as the JSON it would be sent as, which a span measures a page by. */
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
