/**
 * thinking-elapsed.ts -- what a wait on Luke says of its own age, shared by the Conversation's thinking row and the Plans tab's status row.
 *
 * Pure, so the planning model can word the status row without reaching a
 * component. The clock that moves the age a second at a time is
 * `useThinkingClock` in `conversation-rows.tsx`.
 */

/** How long a run goes before the wait says how long it has been. */
const THINKING_ELAPSED_AFTER_MS = 10_000;

/**
 * What the wait says once a run has gone on long enough to be worth a word,
 * and nothing before that: a quick reply earns no sentence, and a run that has
 * stood for minutes must not read like one that started a second ago.
 */
export function thinkingElapsedLabel(since: number, now: number): string | undefined {
  const elapsed = now - since;
  if (elapsed < THINKING_ELAPSED_AFTER_MS) return undefined;
  const seconds = Math.floor(elapsed / 1000);
  return `Still thinking · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
