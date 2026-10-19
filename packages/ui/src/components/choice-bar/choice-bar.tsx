/**
 * choice-bar.tsx -- the one bar of options where you choose one: tabs over a few views of one thing, or a pick-one that sets a value, in a fill or a segmented trough.
 *
 * What it says to a reader follows from what it does, never from how it
 * looks. A bar handed `panels` switches what is shown: it is a tablist,
 * each tab selected while its view is shown and controlling that view's
 * panel, which the caller draws labelled by its tab. A bar without sets a
 * value: it is a radio group, each option checked while it is the value.
 * Either is one tab stop on the chosen option (the first while none is),
 * the arrows (and ↑/↓ for a radio group) moving along it and choosing as
 * they go, wrapping, Home and End going to either end, a disabled option
 * stepped past. A bar its owner drives from a field the keyboard stays in
 * (`focus: none`) takes no focus at all, a press on it leaving the keyboard
 * where it was. A `clearable` bar's chosen option, pressed again, takes the
 * choice back.
 *
 * Each option is its glyph, its name, and a count. The name is always
 * given: a fill bar narrower than its options need scrolls sideways and
 * shows an option other than the chosen one by its glyph alone, its name
 * left to a reader who cannot see it. A count is words, or parts each in
 * its own tone (`CountPart`), which holds chosen or not; a diff's lines are
 * `linesCount`'s, always green and red.
 *
 * `look` is how the chosen option stands out. `fill` is the window's own
 * selected state, a sidebar row's and an open tab's: plain words at the
 * control's height, a fill under the one chosen. It draws no underline: a
 * bar heading a page or a column stands in its header's band, whose
 * hairline is the header's. `segmented` is a trough, the chosen option on a
 * thumb raised in it, its options wrapping inside it when too wide. In
 * either the fill or the thumb slides from option to option. `size`
 * compact is a step smaller, in the caption's type. A fill bar heading a
 * page read at its measure, or a narrow column, stands its options in line
 * with the words under it (`inset`). What finds the bar for an app (the
 * desktop's settings search) is the app's: it hands the bar the `data-`
 * attributes its search lands on.
 */

import type { ReactNode } from "react";
import {
  CHOICE_BAR_FOCUS,
  CHOICE_BAR_INSET,
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  type ChoiceAppAttributes,
  type ChoiceBarFocus,
  type ChoiceBarInset,
  type ChoiceBarLook,
  type ChoiceBarSize,
  type ChoicePanelIds,
  ChoiceRow,
} from "../choice/choice-row.js";
import { type CountPart, CountParts } from "../choice/count-part.js";

export {
  CHOICE_BAR_FOCUS,
  CHOICE_BAR_INSET,
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  type ChoiceBarFocus,
  type ChoiceBarInset,
  type ChoiceBarLook,
  type ChoiceBarSize,
  type ChoicePanelIds,
};

/** One option: the value it chooses, its name, its glyph, what it counts, and whether it can be chosen. */
export interface ChoiceItem<Value extends string> {
  readonly value: Value;
  /** The option's name, read aloud where a narrow bar shows its glyph alone. */
  readonly label: string;
  readonly icon?: ReactNode;
  /** Words drawn quiet after the name, or parts each in its own tone. */
  readonly count?: string | readonly CountPart[] | undefined;
  readonly disabled?: boolean | undefined;
}

interface ChoiceBarBase<Value extends string> {
  /** The bar's accessible name. */
  label: string;
  items: readonly ChoiceItem<Value>[];
  /** The chosen option, or nothing while none is. */
  value: Value | undefined;
  look: ChoiceBarLook;
  size?: ChoiceBarSize | undefined;
  /** The id of each tab and of the panel it shows, by value: given, the bar is a tablist; absent, a radio group. */
  panels?: ((value: Value) => ChoicePanelIds) | undefined;
  focus?: ChoiceBarFocus | undefined;
  inset?: ChoiceBarInset | undefined;
  disabled?: boolean | undefined;
}

/** A bar whose choice always stands once made. */
interface ChoiceBarFixed<Value extends string> extends ChoiceBarBase<Value> {
  clearable?: false | undefined;
  onChange: (value: Value) => void;
}

/** A bar whose chosen option, pressed again, takes the choice back where `clearable` is on. */
interface ChoiceBarClearable<Value extends string> extends ChoiceBarBase<Value> {
  clearable: boolean;
  onChange: (value: Value | undefined) => void;
}

export type ChoiceBarProps<Value extends string> = (
  | ChoiceBarFixed<Value>
  | ChoiceBarClearable<Value>
) &
  ChoiceAppAttributes;

/** Whether an option's count is parts, each in its tone, rather than words. */
function isParts(count: string | readonly CountPart[]): count is readonly CountPart[] {
  return Array.isArray(count);
}

/** What an option counts, drawn: words as one quiet part, parts each in its tone. */
function countOf(count: ChoiceItem<string>["count"]): ReactNode {
  if (count === undefined) return undefined;
  return <CountParts parts={isParts(count) ? count : [{ text: count }]} />;
}

/** The bar over `items`, `value` chosen. */
export function ChoiceBar<Value extends string>(props: ChoiceBarProps<Value>): React.JSX.Element {
  const {
    label,
    items,
    value,
    look,
    size,
    panels,
    focus,
    inset,
    disabled,
    clearable: _,
    onChange: __,
    ...appAttributes
  } = props;
  return (
    <ChoiceRow<Value>
      label={label}
      options={items.map((item) => ({ ...item, count: countOf(item.count) }))}
      value={value}
      onChoose={(chosen) => props.onChange(chosen)}
      onClear={props.clearable === true ? () => props.onChange(undefined) : undefined}
      look={look}
      size={size}
      panels={panels}
      focus={focus}
      inset={inset}
      disabled={disabled}
      appAttributes={appAttributes}
    />
  );
}
