import type { ReactNode } from "react";
import { CheckIcon } from "../../face/glyphs.js";
import { TEXT_VARIANT, Text } from "../text/text.js";
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";

export const STEP_STATE = {
  TO_DO: "to_do",
  CURRENT: "current",
  DONE: "done",
} as const;

export type StepState = (typeof STEP_STATE)[keyof typeof STEP_STATE];

const DISC = {
  [STEP_STATE.TO_DO]: "border border-border-strong text-muted-foreground",
  [STEP_STATE.CURRENT]: "border border-accent-ink text-accent-ink",
  [STEP_STATE.DONE]: "bg-complete text-primary-foreground [&_svg]:text-primary-foreground",
} as const satisfies Record<StepState, string>;

const DONE = "Done";

export function Steps({ children }: { children: ReactNode }): React.JSX.Element {
  return <ol className="m-0 flex list-none flex-col gap-field-gap p-0">{children}</ol>;
}

export function Step({
  number,
  title,
  state,
  children,
}: {
  number: number;
  title?: ReactNode;
  state: StepState;
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
