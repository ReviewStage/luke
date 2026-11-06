import { Badge } from "../badge/badge.js";
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";

const RING_RADIUS = 6;
const RING_STROKE = 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

export const PROGRESS_RING_TONE = {
  WORKING: "working",
  MUTED: "muted",
  ATTENTION: "attention",
  DANGER: "danger",
} as const;

export type ProgressRingTone = (typeof PROGRESS_RING_TONE)[keyof typeof PROGRESS_RING_TONE];

export const PROGRESS_COUNT_LOOK = {
  BARE: "bare",
  BADGE: "badge",
} as const;

export type ProgressCountLook = (typeof PROGRESS_COUNT_LOOK)[keyof typeof PROGRESS_COUNT_LOOK];

const TONE_STROKE = {
  [PROGRESS_RING_TONE.WORKING]: "stroke-working",
  [PROGRESS_RING_TONE.MUTED]: "stroke-muted-foreground",
  [PROGRESS_RING_TONE.ATTENTION]: "stroke-attention",
  [PROGRESS_RING_TONE.DANGER]: "stroke-destructive",
} as const satisfies Record<ProgressRingTone, string>;

export function ProgressRing({
  share,
  tone = PROGRESS_RING_TONE.WORKING,
}: {
  readonly share: number;
  readonly tone?: ProgressRingTone | undefined;
}): React.JSX.Element {
  const filled = Math.min(1, Math.max(0, share)) * RING_LENGTH;
  return (
    <svg
      className="ui-progress-ring size-control-icon flex-none -rotate-90 fill-none"
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
        className={`transition-[stroke-dasharray] duration-(--ui-duration-quick) ease-motion-exit ${TONE_STROKE[tone]}`}
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

export function ProgressCount({
  done,
  total,
  label,
  look = PROGRESS_COUNT_LOOK.BARE,
}: {
  readonly done: number;
  readonly total: number;
  readonly label: string;
  readonly look?: ProgressCountLook | undefined;
}): React.JSX.Element {
  const ring = <ProgressRing share={total > 0 ? done / total : 0} />;
  const figures = (
    <>
      <span aria-hidden="true">
        {done}/{total}
      </span>
      <VisuallyHidden>{label}</VisuallyHidden>
    </>
  );
  if (look === PROGRESS_COUNT_LOOK.BADGE) {
    return (
      <span className="ui-progress-count inline-flex flex-none tabular-nums">
        <Badge icon={ring}>{figures}</Badge>
      </span>
    );
  }
  return (
    <span className="ui-progress-count inline-flex flex-none items-center gap-tight-gap text-caption-inline text-muted-foreground tabular-nums">
      {ring}
      {figures}
    </span>
  );
}
