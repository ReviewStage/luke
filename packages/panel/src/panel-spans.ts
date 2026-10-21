/**
 * panel-spans.ts -- the panel's own timings of what the developer waits on, handed to whatever traces the window, or to no one.
 *
 * The panel times a task opening and its agent's transcript drawing and
 * catching up, and hands each one, once it ended, to the recorder its shell
 * installed: the desktop's panel window answers it with Sentry's renderer
 * SDK (`apps/desktop/src/renderer/desktop-sentry-sdk.ts`), which samples it
 * at the window's own trace rate. A window with no recorder, a test's or a
 * shell that traces nothing, times nothing, which is why this is a door of
 * its own rather than a capability every shell must answer.
 *
 * Note that a span's attributes are numbers alone, and read only where the
 * recorder keeps the span, so an unsampled one costs nothing to measure and
 * no attribute can carry a message's words or a credential.
 */

/** The spans the panel times, under the names Sentry lists them by. */
export const PANEL_SPAN = {
  /** A task's press to its document drawn ready. */
  TASK_OPEN: "task.open",
  /** A transcript followed to its first page committed. */
  TRANSCRIPT_FIRST_PAINT: "transcript.first_paint",
  /** A transcript followed to the page that left nothing more to read. */
  TRANSCRIPT_CAUGHT_UP: "transcript.caught_up",
} as const;
export type PanelSpanName = (typeof PANEL_SPAN)[keyof typeof PANEL_SPAN];

/** What a span says of what it waited on, by Sentry's attribute names. */
export const PANEL_SPAN_ATTRIBUTE = {
  /** How many messages the transcript held as the span ended. */
  MESSAGE_COUNT: "transcript.message_count",
  /** The size of the page that ended the span, as its JSON. */
  PAGE_BYTES: "transcript.page_bytes",
  /** The size of the plan the task opened on, in characters. */
  PLAN_CHARS: "task.plan_chars",
} as const;
export type PanelSpanAttribute = (typeof PANEL_SPAN_ATTRIBUTE)[keyof typeof PANEL_SPAN_ATTRIBUTE];

/** One timing, ended: when it started and ended, in the epoch's milliseconds, and what it measured, read only where it is kept. */
export interface PanelSpan {
  readonly name: PanelSpanName;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly attributes: () => Partial<Readonly<Record<PanelSpanAttribute, number>>>;
}

/** What a shell records a span through. */
export type PanelSpanRecorder = (span: PanelSpan) => void;

let recorder: PanelSpanRecorder | undefined;

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

/** The size of a value as the JSON it would be sent as, which a span measures a page by. */
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
