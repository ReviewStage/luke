import { BUTTON_VARIANT, type BusyProps, Button } from "../button/button.js";

/**
 * auth-step-foot.tsx -- the foot of an AuthPage that is one step of several: Back, where the step stands among them, Skip, and its way on.
 *
 * The foot is three columns, so where the step stands holds the card's
 * centre whatever stands beside it, and does not move as Back arrives on
 * the second step. Back stands at the start; Skip and the way on at the end,
 * Skip before it. Note that a foot too narrow for the three in a line, a
 * phone's card, stands where the step is on a line of its own under them,
 * because the three columns would otherwise squeeze the words letter by
 * letter or push the way on past the card's edge. A quiet button standing at either end gives its inset back
 * to the card, so its words, not its box, stand on the edge the card's
 * controls, rows, and the way on stand on.
 *
 * The AuthPage stands it under everything the step holds (`foot`), and owns
 * the length above it.
 */

/** A step's way on: its words, its press, and whether it is out or not yet offered. */
export type AuthStepNext = BusyProps & {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean | undefined;
};

/** The foot's columns: Back, where the step stands, and the rest; two in a line and the place under them where the foot is narrow. */
const FOOT =
  "ui-auth-step-foot grid grid-cols-[1fr_auto_1fr] items-center gap-control-gap @max-[300px]/ui-auth-foot:grid-cols-[auto_1fr]";

/** Where the step stands, kept on one line, and on a line of its own where the foot is narrow. */
const PLACE =
  "whitespace-nowrap text-caption text-muted-foreground tabular-nums @max-[300px]/ui-auth-foot:col-span-full @max-[300px]/ui-auth-foot:row-start-2 @max-[300px]/ui-auth-foot:justify-self-center";

/** Pulls a quiet button standing at the foot's start or end out by its own inset. */
const BLEED = {
  start: "flex -ms-control-inset",
  end: "flex -me-control-inset",
  none: "flex",
} as const;

/** The step's way on, the foot's one primary press. */
function NextButton({ next }: { next: AuthStepNext }): React.JSX.Element {
  const { label, onPress, ...pressed } = next;
  return (
    <Button variant={BUTTON_VARIANT.PRIMARY} onClick={onPress} {...pressed}>
      {label}
    </Button>
  );
}

/** One step's foot: step `at` of `total`, with Back, Skip, and `next` where each is offered. */
export function AuthStepFoot({
  at,
  total,
  onBack,
  onSkip,
  next,
}: {
  /** The step, counted from one. */
  at: number;
  total: number;
  /** Back to the step before; none on the first. */
  onBack?: (() => void) | undefined;
  /** On without doing the step; none where it cannot be skipped. */
  onSkip?: (() => void) | undefined;
  /** The step's way on, the one primary press; none while Skip alone goes on. */
  next?: AuthStepNext | undefined;
}): React.JSX.Element {
  return (
    <div className={FOOT}>
      <div className="flex justify-start">
        {onBack === undefined ? null : (
          <span className={BLEED.start}>
            <Button variant={BUTTON_VARIANT.QUIET} onClick={onBack}>
              Back
            </Button>
          </span>
        )}
      </div>
      <span className={PLACE}>
        {at} of {total}
      </span>
      <div className="flex justify-end gap-control-gap">
        {onSkip === undefined ? null : (
          <span className={next === undefined ? BLEED.end : BLEED.none}>
            <Button variant={BUTTON_VARIANT.QUIET} onClick={onSkip}>
              Skip
            </Button>
          </span>
        )}
        {next === undefined ? null : <NextButton next={next} />}
      </div>
    </div>
  );
}
