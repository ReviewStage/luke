/**
 * status-tone.ts -- the six tones a status is drawn in, the one list every component that says where something stands reads.
 *
 * Each tone means one thing, and its colours are set once, beside it, in
 * `tokens/status-tone.css`: whatever wears `data-tone` with one of these
 * values reads that tone's ink and tint as `--luke-tone-ink` and
 * `--luke-tone-tint`, so no component keeps a list of the palette's colours
 * of its own. Where Luke shows GitHub's own states, a pull request's or an
 * issue's, it takes GitHub's colours (merged, a closed pull request's
 * danger), because people already know them; nothing of Luke's own is
 * merged.
 */

/** Where something stands, as its colour says it. */
export const STATUS_TONE = {
  /** At rest, or ended with nothing to say: backlog, todo, draft, stopped, canceled, off. */
  NEUTRAL: "neutral",
  /** Still going, with nothing to do yet: a task in progress, running checks, the merge queue. */
  WORKING: "working",
  /** Needs a person: needs you, a review asked for, a sign-in expired. */
  ATTENTION: "attention",
  /** Finished well: a task done, an agent finished, a check passed, connected. */
  COMPLETE: "complete",
  /** GitHub's shipped: a merged pull request, an issue closed as completed. */
  MERGED: "merged",
  /** Failed, or can't go on: failed, couldn't start, conflicts, checks failing. */
  DANGER: "danger",
} as const;

export type StatusTone = (typeof STATUS_TONE)[keyof typeof STATUS_TONE];
