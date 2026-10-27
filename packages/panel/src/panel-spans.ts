/**
 * panel-spans.ts -- the panel's own timings of what the developer waits on, handed to whatever traces the window, or to no one.
 *
 * The panel times a task opening and its agent's transcript drawing and
 * catching up, the window's own start to its first state drawn and to its
 * first task list read, a keystroke in a box timed to the paint that
 * followed it, any press or key anywhere slow enough to feel, and any frame
 * held long enough to stutter, and hands each one, once it ended, to the
 * recorder its shell
 * installed: the desktop's panel window answers it with Sentry's renderer
 * SDK (`apps/desktop/src/renderer/desktop-sentry-sdk.ts`), which samples it
 * at the window's own trace rate. A window with no recorder, a test's or a
 * shell that traces nothing, times nothing, which is why this is a door of
 * its own rather than a capability every shell must answer.
 *
 * Note that a span's attributes are numbers, or words from this file's own
 * fixed sets (`PANEL_REGION`, `PANEL_PAGE`, `INTERACTION_KIND`), and read
 * only where the recorder keeps the span, so an unsampled one costs nothing
 * to measure and no attribute can carry a message's words or a credential.
 * A keystroke's span says how long it waited and where, and nothing of the
 * key or the words.
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
  /** A press or key anywhere else, from the moment it came to the paint after it, where that took long enough to feel. */
  INTERACTION_SLOW: "interaction.slow",
  /** A frame the page held long enough to stutter, whatever held it. */
  FRAME_LONG: "frame.long",
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
  /** Where in the window an event came, a `PANEL_REGION`. */
  REGION: "panel.region",
  /** The page the window's main column showed, a `PANEL_PAGE`; none where it shows none of them, as Settings. */
  PAGE: "panel.page",
  /** Whether a slow interaction was a press or a key, an `INTERACTION_KIND`. */
  INTERACTION_KIND: "interaction.kind",
  /** How long a slow interaction waited before its handlers ran, in milliseconds. */
  INTERACTION_INPUT_DELAY: "interaction.input_delay_ms",
  /** How long a slow interaction's handlers ran, in milliseconds. */
  INTERACTION_PROCESSING: "interaction.processing_ms",
  /** How long a slow interaction's paint came after its handlers ended, in milliseconds: the render and layout it caused. */
  INTERACTION_PRESENTATION: "interaction.presentation_ms",
  /** How much of a long frame blocked input, in milliseconds. */
  FRAME_BLOCKING: "frame.blocking_ms",
  /** How long a long frame's scripts ran, in milliseconds. */
  FRAME_SCRIPT: "frame.script_ms",
  /** How long a long frame spent on style and layout, in milliseconds. */
  FRAME_LAYOUT: "frame.layout_ms",
} as const;
type PanelSpanAttribute = (typeof PANEL_SPAN_ATTRIBUTE)[keyof typeof PANEL_SPAN_ATTRIBUTE];

/**
 * The parts of the window an event can come in, as `data-span-region`
 * names them on the part's root, nearest first; a dialog and a menu are read
 * by their roles, since they draw over every part.
 */
export const PANEL_REGION = {
  SIDEBAR: "sidebar",
  MAIN: "main",
  SIDE_PANEL: "side_panel",
  DIALOG: "dialog",
  MENU: "menu",
  ELSEWHERE: "elsewhere",
} as const;
export type PanelRegion = (typeof PANEL_REGION)[keyof typeof PANEL_REGION];

/** The pages the main column shows, as `data-span-page` names the one it shows. */
export const PANEL_PAGE = {
  TASK: "task",
  INBOX: "inbox",
  AGENT: "agent",
  PERSON: "person",
  TASKS: "tasks",
  ADMIN: "admin",
  AUTOMATIONS: "automations",
} as const;
export type PanelPage = (typeof PANEL_PAGE)[keyof typeof PANEL_PAGE];

/** What a slow interaction was. */
const INTERACTION_KIND = {
  PRESS: "press",
  KEY: "key",
} as const;
type InteractionKind = (typeof INTERACTION_KIND)[keyof typeof INTERACTION_KIND];

/** What a span may say: a number, or a word from one of this file's fixed sets. */
type PanelSpanValue = number | PanelRegion | PanelPage | InteractionKind;

/** One timing, ended: when it started and ended, in the epoch's milliseconds, and what it measured, read only where it is kept. */
export interface PanelSpan {
  readonly name: PanelSpanName;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly attributes: () => Partial<Readonly<Record<PanelSpanAttribute, PanelSpanValue>>>;
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

/**
 * The shortest wait an interaction is timed past wherever it came: a tenth
 * of a second, about where a press stops feeling instant.
 */
const SLOW_INTERACTION_MS = 100;

/** The shortest frame timed as long, past the fifty milliseconds the browser reports one at, where an animation or a stream visibly stutters. */
const LONG_FRAME_MS = 100;

/** How many interactions are remembered as timed, so the other events of one are not timed again. */
const TIMED_INTERACTIONS_KEPT = 64;

/** The attribute a part of the window names itself on, and the one the main column names its page on. */
const REGION_ATTRIBUTE = "data-span-region";
const PAGE_ATTRIBUTE = "data-span-page";

/** What a dialog and a menu are read by, whichever part they were opened from. */
const DIALOG_ROLES = '[role="dialog"], [role="alertdialog"]';
const MENU_ROLES = '[role="menu"], [role="listbox"]';

let recorder: PanelSpanRecorder | undefined;

/** How many tasks the sidebar last listed, said on every span; none until it has listed any. */
let listedTasks: number | undefined;

/** The interactions already timed, by the browser's id, the newest last. */
let timedInteractions: number[] = [];

/** When this window's root started, and the spans timed from it that have ended; none where the shell times no start. */
let windowStart: { readonly at: number; readonly ended: Set<WindowSpanName> } | undefined;

/** The boxes whose keystrokes are timed, each by the span it is timed under. */
const timedBoxes = new Map<Element, KeystrokeSpanName>();

/** What hears the browser's event timings, from the first time one is asked for. */
let eventObserver: PerformanceObserver | undefined;

/** What hears the browser's long frames, from the first time a recorder is installed. */
let frameObserver: PerformanceObserver | undefined;

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

/** The part of the window `target` is in, read off the nearest part that names itself. */
function regionOf(target: Node | null): PanelRegion {
  const element = target instanceof Element ? target : (target?.parentElement ?? null);
  if (element === null) return PANEL_REGION.ELSEWHERE;
  if (element.closest(DIALOG_ROLES) !== null) return PANEL_REGION.DIALOG;
  if (element.closest(MENU_ROLES) !== null) return PANEL_REGION.MENU;
  const named = element.closest(`[${REGION_ATTRIBUTE}]`)?.getAttribute(REGION_ATTRIBUTE);
  return Object.values(PANEL_REGION).find((region) => region === named) ?? PANEL_REGION.ELSEWHERE;
}

/** The page the window's main column shows now; none where it names none of `PANEL_PAGE`. */
function pageShown(): PanelPage | undefined {
  const named = document.querySelector(`[${PAGE_ATTRIBUTE}]`)?.getAttribute(PAGE_ATTRIBUTE);
  return Object.values(PANEL_PAGE).find((page) => page === named);
}

/** Where an event came: its part of the window, and the page the main column showed. */
function placeOf(target: Node | null): Partial<Record<PanelSpanAttribute, PanelSpanValue>> {
  const page = pageShown();
  return {
    [PANEL_SPAN_ATTRIBUTE.REGION]: regionOf(target),
    ...(page === undefined ? undefined : { [PANEL_SPAN_ATTRIBUTE.PAGE]: page }),
  };
}

/** Whether the interaction `id` was timed already, remembering it as timed now. */
function timedAlready(id: number): boolean {
  if (timedInteractions.includes(id)) return true;
  timedInteractions = [...timedInteractions, id].slice(-TIMED_INTERACTIONS_KEPT);
  return false;
}

/** Records a key pressed in a timed box from the moment it was pressed to the paint after it; its wait before its handlers and their run are what it says of it. */
function recordKeystroke(entry: PerformanceEventTiming, name: KeystrokeSpanName): void {
  const startedAt = performance.timeOrigin + entry.startTime;
  const delay = entry.processingStart - entry.startTime;
  const processing = entry.processingEnd - entry.processingStart;
  const place = placeOf(entry.target);
  recordPanelSpan({
    name,
    startedAt,
    endedAt: startedAt + entry.duration,
    attributes: () => ({
      [PANEL_SPAN_ATTRIBUTE.INPUT_DELAY]: delay,
      [PANEL_SPAN_ATTRIBUTE.PROCESSING]: processing,
      ...place,
    }),
  });
}

/** Records a slow interaction from the moment it came to the paint after it, split into its wait, its handlers' run, and the paint's lag after them. */
function recordSlowInteraction(entry: PerformanceEventTiming): void {
  const startedAt = performance.timeOrigin + entry.startTime;
  const kind = entry.name.startsWith("key") ? INTERACTION_KIND.KEY : INTERACTION_KIND.PRESS;
  const delay = entry.processingStart - entry.startTime;
  const processing = entry.processingEnd - entry.processingStart;
  const presentation = entry.startTime + entry.duration - entry.processingEnd;
  const place = placeOf(entry.target);
  recordPanelSpan({
    name: PANEL_SPAN.INTERACTION_SLOW,
    startedAt,
    endedAt: startedAt + entry.duration,
    attributes: () => ({
      [PANEL_SPAN_ATTRIBUTE.INTERACTION_KIND]: kind,
      [PANEL_SPAN_ATTRIBUTE.INTERACTION_INPUT_DELAY]: delay,
      [PANEL_SPAN_ATTRIBUTE.INTERACTION_PROCESSING]: processing,
      [PANEL_SPAN_ATTRIBUTE.INTERACTION_PRESENTATION]: presentation,
      ...place,
    }),
  });
}

/**
 * Records what the browser timed of each event: a key pressed in a timed box
 * under its box's span, and any other interaction slow enough to feel as a
 * slow one, once for each interaction, though its press, release, and click
 * are each reported.
 */
function recordEvents(list: PerformanceObserverEntryList): void {
  for (const entry of list.getEntries()) {
    if (!isEventTiming(entry) || entry.interactionId === 0) continue;
    const box = entry.name === "keydown" ? timedBoxOf(entry.target) : undefined;
    if (box === undefined && entry.duration < SLOW_INTERACTION_MS) continue;
    if (timedAlready(entry.interactionId)) continue;
    if (box === undefined) recordSlowInteraction(entry);
    else recordKeystroke(entry, box);
  }
}

/**
 * A long frame as the browser reports it. Note that TypeScript's DOM types
 * do not yet name the Long Animation Frames API, so the shape says the
 * fields read.
 */
interface LongFrameTiming extends PerformanceEntry {
  readonly blockingDuration: number;
  readonly styleAndLayoutStart: number;
  readonly scripts: readonly { readonly duration: number }[];
}

/** Whether a timing the browser reported is a long frame's. */
function isLongFrame(entry: PerformanceEntry): entry is LongFrameTiming {
  return "blockingDuration" in entry && "scripts" in entry;
}

/** Records each frame held past `LONG_FRAME_MS`: how much of it blocked input, ran scripts, and laid out, and the page it held. */
function recordFrames(list: PerformanceObserverEntryList): void {
  for (const entry of list.getEntries()) {
    if (!isLongFrame(entry) || entry.duration < LONG_FRAME_MS) continue;
    const startedAt = performance.timeOrigin + entry.startTime;
    const ended = entry.startTime + entry.duration;
    const page = pageShown();
    recordPanelSpan({
      name: PANEL_SPAN.FRAME_LONG,
      startedAt,
      endedAt: startedAt + entry.duration,
      attributes: () => ({
        [PANEL_SPAN_ATTRIBUTE.FRAME_BLOCKING]: entry.blockingDuration,
        [PANEL_SPAN_ATTRIBUTE.FRAME_SCRIPT]: entry.scripts.reduce(
          (sum, script) => sum + script.duration,
          0,
        ),
        [PANEL_SPAN_ATTRIBUTE.FRAME_LAYOUT]:
          entry.styleAndLayoutStart > 0 ? ended - entry.styleAndLayoutStart : 0,
        ...(page === undefined ? undefined : { [PANEL_SPAN_ATTRIBUTE.PAGE]: page }),
      }),
    });
  }
}

/** Whether this window's browser reports timings of the `type` given. */
function reports(type: string): boolean {
  return (
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes.includes(type)
  );
}

/**
 * Starts hearing the browser's event timings, past the shortest wait it
 * reports one at, once; a browser that reports none is never heard.
 */
function observeEvents(): void {
  if (eventObserver !== undefined || !reports("event")) return;
  eventObserver = new PerformanceObserver(recordEvents);
  eventObserver.observe(KEYSTROKES_OBSERVED);
}

/** Starts hearing the browser's long frames, once; a browser that reports none is never heard. */
function observeFrames(): void {
  if (frameObserver !== undefined || !reports("long-animation-frame")) return;
  frameObserver = new PerformanceObserver(recordFrames);
  frameObserver.observe({ type: "long-animation-frame" });
}

/**
 * Times every key pressed in `box` under `name`, answering what stops it.
 * A window with no recorder, or a browser that reports no keystroke, times
 * nothing. One observer hears every box, made the first time one is timed
 * and kept, because a box's ref is handed back and given again as its owner
 * draws, and a timing reported between the two must not be lost with it.
 */
function timeKeystrokes(box: Element, name: KeystrokeSpanName): () => void {
  if (recorder === undefined || !reports("event")) return () => undefined;
  timedBoxes.set(box, name);
  observeEvents();
  return () => {
    timedBoxes.delete(box);
  };
}

/**
 * Installs what this window records its spans through, and answers what
 * takes it back; from then on, every slow interaction and long frame is
 * timed, as each keystroke in a timed box is.
 */
export function installPanelSpanRecorder(installed: PanelSpanRecorder): () => void {
  recorder = installed;
  timedInteractions = [];
  listedTasks = undefined;
  observeEvents();
  observeFrames();
  return () => {
    if (recorder === installed) recorder = undefined;
  };
}

/**
 * Hands one ended span to the window's recorder, saying how many tasks the
 * sidebar last listed where the span says none of its own, so a wait can be
 * read against the size of the workspace; a window with none records nothing.
 */
export function recordPanelSpan(span: PanelSpan): void {
  if (recorder === undefined) return;
  const listed = listedTasks;
  recorder(
    listed === undefined
      ? span
      : {
          ...span,
          attributes: () => ({ [PANEL_SPAN_ATTRIBUTE.TASK_COUNT]: listed, ...span.attributes() }),
        },
  );
}

/** Notes how many tasks the sidebar lists now, which every span from then on says. */
export function noteListedTasks(count: number): void {
  listedTasks = count;
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
