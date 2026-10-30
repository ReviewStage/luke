import type { ShortcutChord } from "@luke/settings/shortcuts";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
} from "../../icons/icons.js";
import { IconButton } from "../button/button.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * pager.tsx -- stepping one item at a time through a list the item stands apart from: where it stands, "2 of 8", and the arrows to the one before it and the one after.
 *
 * An item read on its own, an Inbox item standing alone, an agent among its
 * automation's runs, a chapter of a pull request, ends its bar in this pager,
 * so every list stepped through one item at a time reads the same: its place
 * in the caption's muted ink, in figures that hold their width as they step,
 * and two glyph-alone arrows, up and down where the list stands as a column,
 * left and right where it reads as pages. The place leads the arrows, or
 * stands between them where it says what each arrow steps through ("Run 3
 * of 5"). Each arrow is named for where it goes, its hint able to say more
 * (the neighbour's own title) and the key that reaches it. An arrow with
 * nowhere to go stands stepped back rather than gone, so the other does not
 * shift, and keeps the keyboard, because a step that reaches an end leaves
 * focus on it.
 */

/** Which way the list runs: a column, stepped up and down, or pages, stepped left and right. */
export const PAGER_AXIS = {
  VERTICAL: "vertical",
  HORIZONTAL: "horizontal",
} as const;

export type PagerAxis = (typeof PAGER_AXIS)[keyof typeof PAGER_AXIS];

/** Where the place stands: before both arrows, or between them. */
export const PAGER_COUNT = {
  LEAD: "lead",
  BETWEEN: "between",
} as const;

export type PagerCount = (typeof PAGER_COUNT)[keyof typeof PAGER_COUNT];

/** The arrows' glyphs, the step back first, for each way a list runs. */
const ARROWS = {
  [PAGER_AXIS.VERTICAL]: [<ChevronUpIcon key="up" />, <ChevronDownIcon key="down" />],
  [PAGER_AXIS.HORIZONTAL]: [<ChevronLeftIcon key="left" />, <ChevronRightIcon key="right" />],
} as const satisfies Record<PagerAxis, readonly [React.JSX.Element, React.JSX.Element]>;

/** The place's margin, a caption's gap from the arrows it leads, or a tight one either side between them. */
const COUNT_PLACE = {
  [PAGER_COUNT.LEAD]: "mr-item-gap",
  [PAGER_COUNT.BETWEEN]: "mx-tight-gap",
} as const satisfies Record<PagerCount, string>;

/** Where the item stands among the list's, counted from one, and what the list holds where the place says it ("Run"). */
export interface PagerPlace {
  readonly at: number;
  readonly total: number;
  readonly noun?: string | undefined;
}

/** One arrow: its name, what its hint says where that is more than its name, the key that reaches it, and its press, none at the list's end. */
export interface PagerStep {
  readonly label: string;
  readonly hint?: string | undefined;
  readonly chord?: ShortcutChord | undefined;
  readonly onStep: (() => void) | undefined;
}

/** One of the pager's arrows, stepped back where there is nowhere to go. */
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

/** The pager: the item's place, where there is one to say, and the arrows either side of the item, in the order `count` lays them. */
export function Pager({
  axis,
  place,
  count = PAGER_COUNT.LEAD,
  previous,
  next,
}: {
  axis: PagerAxis;
  /** Where the item stands; none draws only the arrows. */
  place: PagerPlace | undefined;
  count?: PagerCount;
  previous: PagerStep;
  next: PagerStep;
}): React.JSX.Element {
  const [back, on] = ARROWS[axis];
  const words =
    place === undefined ? null : (
      <span
        className={`luke-pager-count ${COUNT_PLACE[count]} whitespace-nowrap text-caption-inline text-muted-foreground tabular-nums`}
      >
        {place.noun === undefined
          ? `${place.at} of ${place.total}`
          : `${place.noun} ${place.at} of ${place.total}`}
      </span>
    );
  return (
    <div className="luke-pager flex flex-none items-center">
      {count === PAGER_COUNT.LEAD ? words : null}
      <PagerArrow step={previous} icon={back} />
      {count === PAGER_COUNT.BETWEEN ? words : null}
      <PagerArrow step={next} icon={on} />
    </div>
  );
}
