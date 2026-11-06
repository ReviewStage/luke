import { useCallback, useRef } from "react";

export const PANEL_SPAN = {
  TASK_OPEN: "task.open",
  TRANSCRIPT_FIRST_PAINT: "transcript.first_paint",
  TRANSCRIPT_CAUGHT_UP: "transcript.caught_up",
  WINDOW_FIRST_PAINT: "window.first_paint",
  WINDOW_FIRST_USABLE: "window.first_usable",
  KEYSTROKE_COMPOSER: "keystroke.composer",
  KEYSTROKE_COMMAND_PALETTE: "keystroke.command_palette",
  INBOX_OPEN: "inbox.open",
  INBOX_ITEM_OPEN: "inbox.item_open",
  KEYSTROKE_INBOX_ANSWER: "keystroke.inbox_answer",
} as const;
type PanelSpanName = (typeof PANEL_SPAN)[keyof typeof PANEL_SPAN];

type PressSpanName = typeof PANEL_SPAN.INBOX_OPEN | typeof PANEL_SPAN.INBOX_ITEM_OPEN;

type WindowSpanName = typeof PANEL_SPAN.WINDOW_FIRST_PAINT | typeof PANEL_SPAN.WINDOW_FIRST_USABLE;

export type KeystrokeSpanName =
  | typeof PANEL_SPAN.KEYSTROKE_COMPOSER
  | typeof PANEL_SPAN.KEYSTROKE_COMMAND_PALETTE
  | typeof PANEL_SPAN.KEYSTROKE_INBOX_ANSWER;

export const PANEL_SPAN_ATTRIBUTE = {
  MESSAGE_COUNT: "transcript.message_count",
  HELD_BYTES: "transcript.held_bytes",
  CACHE_HIT: "transcript.cache_hit",
  DESCRIPTION_CHARS: "task.description_chars",
  TASK_COUNT: "window.task_count",
  ITEM_COUNT: "inbox.item_count",
  HELD: "inbox.held",
  INPUT_DELAY: "keystroke.input_delay_ms",
  PROCESSING: "keystroke.processing_ms",
} as const;
type PanelSpanAttribute = (typeof PANEL_SPAN_ATTRIBUTE)[keyof typeof PANEL_SPAN_ATTRIBUTE];

export interface PanelSpan {
  readonly name: PanelSpanName;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly attributes: () => Partial<Readonly<Record<PanelSpanAttribute, number>>>;
}

export type PanelSpanRecorder = (span: PanelSpan) => void;

const KEYSTROKE_REPORTED_MS = 16;

const KEYSTROKES_OBSERVED: PerformanceObserverInit & { readonly durationThreshold: number } = {
  type: "event",
  durationThreshold: KEYSTROKE_REPORTED_MS,
};

let recorder: PanelSpanRecorder | undefined;

let windowStart: { readonly at: number; readonly ended: Set<WindowSpanName> } | undefined;

const begun = new Map<PressSpanName, number>();

const timedBoxes = new Map<Element, KeystrokeSpanName>();

let keystrokeObserver: PerformanceObserver | undefined;

function timedBoxOf(target: Node | null): KeystrokeSpanName | undefined {
  if (target === null) return undefined;
  for (const [box, name] of timedBoxes) if (box.contains(target)) return name;
  return undefined;
}

function isEventTiming(entry: PerformanceEntry): entry is PerformanceEventTiming {
  return "processingStart" in entry;
}

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

function reportsKeystrokes(): boolean {
  return (
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes.includes("event")
  );
}

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

export function installPanelSpanRecorder(installed: PanelSpanRecorder): () => void {
  recorder = installed;
  return () => {
    if (recorder === installed) recorder = undefined;
  };
}

export function recordPanelSpan(span: PanelSpan): void {
  recorder?.(span);
}

export function beginPanelSpan(name: PressSpanName): void {
  if (recorder === undefined) return;
  begun.set(name, Date.now());
}

export function endPanelSpan(
  name: PressSpanName,
  attributes: PanelSpan["attributes"] = () => ({}),
): void {
  const startedAt = begun.get(name);
  if (startedAt === undefined) return;
  begun.delete(name);
  recordPanelSpan({ name, startedAt, endedAt: Date.now(), attributes });
}

export function leavePanelSpan(name: PressSpanName): void {
  begun.delete(name);
}

export function markWindowStart(at: number = Date.now()): void {
  windowStart = { at, ended: new Set() };
}

export function endWindowSpan(
  name: WindowSpanName,
  attributes: PanelSpan["attributes"] = () => ({}),
): void {
  if (windowStart === undefined || windowStart.ended.has(name)) return;
  windowStart.ended.add(name);
  recordPanelSpan({ name, startedAt: windowStart.at, endedAt: Date.now(), attributes });
}

export function leaveWindowSpan(name: WindowSpanName): void {
  windowStart?.ended.add(name);
}

export function endWindowSpanOnFirstDraw(root: Element, name: WindowSpanName): void {
  const drawn = new MutationObserver(() => {
    drawn.disconnect();
    endWindowSpan(name);
  });
  drawn.observe(root, { childList: true });
}

export function useKeystrokeSpans(name: KeystrokeSpanName): (box: Element | null) => void {
  const stop = useRef<(() => void) | undefined>(undefined);
  return useCallback(
    (box: Element | null) => {
      stop.current?.();
      stop.current = box === null ? undefined : timeKeystrokes(box, name);
    },
    [name],
  );
}

export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
