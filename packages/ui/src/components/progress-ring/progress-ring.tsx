import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";

/**
 * progress-ring.tsx -- how far a known amount of work has come as a small ring filled from twelve o'clock, and the same ring beside its count ("4/6").
 *
 * The ring is a picture of a share, so it is hidden from a reader; what a
 * reader hears is the words the caller gives, whole, in place of the figures
 * (`ProgressCount`'s `label`). Its fill is the working ink unless a caller
 * names another tone: the agent's context ring, which is muted with room to
 * spare, amber near compaction, and red past it, is the one that does.
 * `ProgressCount` draws its figures in the caption's size and tabular
 * figures itself, so no container it stands in can inflate them, and holds
 * the ring's size beside them whatever the room.
 */

/** The ring's radius and stroke in its 16-unit box, and the length of its circle. */
const RING_RADIUS = 6;
const RING_STROKE = 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** The ink a ring's fill is drawn in: the working blue, the muted ink, amber, or red. */
export const PROGRESS_RING_TONE = {
  WORKING: "working",
  MUTED: "muted",
  ATTENTION: "attention",
  DANGER: "danger",
} as const;

export type ProgressRingTone = (typeof PROGRESS_RING_TONE)[keyof typeof PROGRESS_RING_TONE];

const TONE_STROKE = {
  [PROGRESS_RING_TONE.WORKING]: "stroke-working",
  [PROGRESS_RING_TONE.MUTED]: "stroke-muted-foreground",
  [PROGRESS_RING_TONE.ATTENTION]: "stroke-attention",
  [PROGRESS_RING_TONE.DANGER]: "stroke-destructive",
} as const satisfies Record<ProgressRingTone, string>;

/** The ring: a faint track and `share` of it filled over, from twelve o'clock, as large as a control's glyph unless its seat sizes it. */
export function ProgressRing({
  share,
  tone = PROGRESS_RING_TONE.WORKING,
}: {
  /** How much of the ring is filled, from 0 to 1; a share past either end is held to it. */
  readonly share: number;
  readonly tone?: ProgressRingTone | undefined;
}): React.JSX.Element {
  const filled = Math.min(1, Math.max(0, share)) * RING_LENGTH;
  return (
    <svg
      className="luke-progress-ring size-control-icon flex-none -rotate-90 fill-none"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <circle
        className="stroke-border-strong"
        cx="8"
        cy="8"
        r={RING_RADIUS}
        strokeWidth={RING_STROKE}
      />
      <circle
        className={`transition-[stroke-dasharray] ${TONE_STROKE[tone]}`}
        strokeLinecap="round"
        cx="8"
        cy="8"
        r={RING_RADIUS}
        strokeWidth={RING_STROKE}
        strokeDasharray={`${filled} ${RING_LENGTH}`}
      />
    </svg>
  );
}

/**
 * How many of the things a row or a card holds are done, of all of them: the
 * ring filled to that share in the working blue, then "2/5" in the muted
 * ink, whose words a screen reader hears whole (`label`, "2 of 5 sub-tasks
 * done") in place of the picture and the figures. The ring is filled in the
 * working blue even once all are done.
 */
export function ProgressCount({
  done,
  total,
  label,
}: {
  readonly done: number;
  readonly total: number;
  /** What the figures count, said whole to a reader who hears no figures. */
  readonly label: string;
}): React.JSX.Element {
  return (
    <span className="luke-progress-count inline-flex flex-none items-center gap-tight-gap me-tight-gap text-caption-inline text-muted-foreground tabular-nums">
      <ProgressRing share={total > 0 ? done / total : 0} />
      <span aria-hidden="true">
        {done}/{total}
      </span>
      <VisuallyHidden>{label}</VisuallyHidden>
    </span>
  );
}
