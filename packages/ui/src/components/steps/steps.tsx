import type { ReactNode } from "react";
import { CheckIcon } from "../../face/glyphs.js";
import { TEXT_VARIANT, Text } from "../text/text.js";
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";

/**
 * steps.tsx -- a short setup told as numbered steps that check off as each is done: run this, then paste what it printed.
 *
 * A setup a person carries out partly elsewhere, in a terminal or on a
 * provider's page, reads as an ordered list: each step a number in a small
 * disc, its words beside it, and what it needs (a command to copy, a link,
 * a field) under them. The step to do now (`STEP_STATE.CURRENT`) draws its
 * disc in the accent's ink; one done (`STEP_STATE.DONE`) turns its number to
 * the check on the complete fill, and a reader hears it said done; one still
 * to come (`STEP_STATE.TO_DO`) stands muted. No step is ever locked, so a
 * person who already holds what a step makes goes straight to the next. It
 * is a list rather than a control: what presses there are inside a step are
 * its caller's. It is drawn in the Tailwind theme's utilities.
 */

/** Where a step stands: still to come, the one to do now, or done. */
export const STEP_STATE = {
  TO_DO: "to_do",
  CURRENT: "current",
  DONE: "done",
} as const;

export type StepState = (typeof STEP_STATE)[keyof typeof STEP_STATE];

/** What a step's disc is drawn in, for each state. */
const DISC = {
  [STEP_STATE.TO_DO]: "border border-border-strong text-muted-foreground",
  [STEP_STATE.CURRENT]: "border border-accent-ink text-accent-ink",
  [STEP_STATE.DONE]: "bg-complete text-primary-foreground [&_svg]:text-primary-foreground",
} as const satisfies Record<StepState, string>;

/** What a reader hears after a step done. */
const DONE = "Done";

/** Steps, one under another, in the order they are done. */
export function Steps({ children }: { children: ReactNode }): React.JSX.Element {
  return <ol className="m-0 flex list-none flex-col gap-field-gap p-0">{children}</ol>;
}

/** Step `number`: its disc, what to do, and what it needs under that. */
export function Step({
  number,
  title,
  state,
  children,
}: {
  /** Its place in the order, from 1. */
  number: number;
  /** What to do, as a short sentence: "Run this in a terminal"; none where what the step needs names it, a field by its label. */
  title?: ReactNode;
  state: StepState;
  /** What the step needs: a command to copy, a link, a field. */
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-ui-12" data-state={state}>
      <span
        className={`inline-grid size-ui-20 flex-none place-items-center rounded-full text-caption tabular-nums [&_svg]:size-ui-12 ${DISC[state]}`}
        aria-hidden="true"
      >
        {state === STEP_STATE.DONE ? <CheckIcon /> : number}
      </span>
      <div className="flex min-w-0 flex-col gap-ui-8">
        {title === undefined ? null : (
          <Text variant={TEXT_VARIANT.LABEL}>
            {title}
            {state === STEP_STATE.DONE ? <VisuallyHidden>{` (${DONE})`}</VisuallyHidden> : null}
          </Text>
        )}
        {children}
      </div>
    </li>
  );
}
