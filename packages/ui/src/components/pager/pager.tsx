import type { ShortcutChord } from "@repo/settings/shortcuts";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
} from "../../icons/icons.js";
import { IconButton } from "../button/button.js";
import { Tooltip } from "../tooltip/hint.js";

export const PAGER_AXIS = {
  VERTICAL: "vertical",
  HORIZONTAL: "horizontal",
} as const;

export type PagerAxis = (typeof PAGER_AXIS)[keyof typeof PAGER_AXIS];

export const PAGER_COUNT = {
  LEAD: "lead",
  BETWEEN: "between",
} as const;

export type PagerCount = (typeof PAGER_COUNT)[keyof typeof PAGER_COUNT];

const ARROWS = {
  [PAGER_AXIS.VERTICAL]: [<ChevronUpIcon key="up" />, <ChevronDownIcon key="down" />],
  [PAGER_AXIS.HORIZONTAL]: [<ChevronLeftIcon key="left" />, <ChevronRightIcon key="right" />],
} as const satisfies Record<PagerAxis, readonly [React.JSX.Element, React.JSX.Element]>;

const COUNT_PLACE = {
  [PAGER_COUNT.LEAD]: "mr-item-gap",
  [PAGER_COUNT.BETWEEN]: "mx-tight-gap",
} as const satisfies Record<PagerCount, string>;

export interface PagerPlace {
  readonly at: number;
  readonly total: number;
  readonly noun?: string | undefined;
}

export interface PagerStep {
  readonly label: string;
  readonly hint?: string | undefined;
  readonly chord?: ShortcutChord | undefined;
  readonly onStep: (() => void) | undefined;
}

function PagerArrow({
  step,
  icon,
}: {
  step: PagerStep;
  icon: React.JSX.Element;
}): React.JSX.Element {
  return (
    <Tooltip label={step.hint ?? step.label} chord={step.chord}>
      <IconButton
        icon={icon}
        label={step.label}
        disabled={step.onStep === undefined}
        focusableWhenDisabled
        onClick={step.onStep}
      />
    </Tooltip>
  );
}

export function Pager({
  axis,
  place,
  count = PAGER_COUNT.LEAD,
  previous,
  next,
}: {
  axis: PagerAxis;
  place: PagerPlace | undefined;
  count?: PagerCount;
  previous: PagerStep;
  next: PagerStep;
}): React.JSX.Element {
  const [back, on] = ARROWS[axis];
  const words =
    place === undefined ? null : (
      <span
        className={`ui-pager-count ${COUNT_PLACE[count]} whitespace-nowrap text-caption-inline text-muted-foreground tabular-nums`}
      >
        {place.noun === undefined
          ? `${place.at} of ${place.total}`
          : `${place.noun} ${place.at} of ${place.total}`}
      </span>
    );
  return (
    <div className="ui-pager flex flex-none items-center">
      {count === PAGER_COUNT.LEAD ? words : null}
      <PagerArrow step={previous} icon={back} />
      {count === PAGER_COUNT.BETWEEN ? words : null}
      <PagerArrow step={next} icon={on} />
    </div>
  );
}
