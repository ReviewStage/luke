import type { ReactNode } from "react";
import {
  CHOICE_BAR_INSET,
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  type ChoiceBarInset,
  type ChoiceBarSize,
  type ChoicePanelIds,
  ChoiceRow,
} from "../choice/choice-row.js";
import { COUNT_TONE, type CountPart, CountParts, type CountTone } from "../choice/count-part.js";

/**
 * tabs.tsx -- the row of tabs over a few views of one thing, which is `ChoiceBar` in its fill look with a panel for every tab, kept under this name while its callers move to `ChoiceBar`.
 *
 * Everything a reader meets is `ChoiceBar`'s (`choice-bar.tsx`): a
 * tablist, each tab its glyph, its name, and a count, the chosen one on
 * the fill. What is this module's own is its older vocabulary: `ids` for
 * `panels`, `density` for `size`, and a count drawn by the caller
 * (`TabCount`, or `CountParts`) rather than handed as parts.
 */

/** Where the row stands its tabs: `ChoiceBar`'s insets. */
export const TABS_INSET = CHOICE_BAR_INSET;

export type TabsInset = ChoiceBarInset;

/** How much room the row keeps around its tabs: `ChoiceBar`'s sizes. */
export const TABS_DENSITY = CHOICE_BAR_SIZE;

export type TabsDensity = ChoiceBarSize;

/** What a count says beside a tab's name, in the state palette or quiet: the count part's tones (`COUNT_TONE`). */
export const TAB_COUNT_TONE = COUNT_TONE;

export type TabCountTone = CountTone;

/** One tab: the view it shows, its glyph, its name, and what it counts. */
export interface TabItem<Value extends string> {
  value: Value;
  label: string;
  /** A glyph before the name, which a narrow row keeps where it drops the name. */
  icon?: ReactNode;
  /** What the view counts, drawn quiet after the name; `CountParts` (or a `TabCount`) where it has a tone. */
  count?: ReactNode;
}

/** The ids a tab and the panel it controls carry. */
export type TabIds = ChoicePanelIds;

/** A count's glyph and what it says, the words required beside one so it is never colour and shape alone. */
type TabCountGlyph =
  | { glyph?: undefined; glyphLabel?: undefined }
  | { glyph: ReactNode; glyphLabel: string };

/** A count of one part in `tone`, a glyph before it saying its state in words to a reader who cannot see it. */
export function TabCount(
  props: {
    tone?: TabCountTone;
    children?: string | undefined;
  } & TabCountGlyph,
): React.JSX.Element {
  const { tone, glyph, glyphLabel, children = "" } = props;
  const part: CountPart =
    glyph === undefined ? { text: children, tone } : { text: children, tone, glyph, glyphLabel };
  return <CountParts parts={[part]} />;
}

/** The row of `tabs`, `value`'s selected. */
export function Tabs<Value extends string>({
  label,
  tabs,
  value,
  onChange,
  ids,
  inset = TABS_INSET.NONE,
  density = TABS_DENSITY.REGULAR,
}: {
  /** The row's accessible name. */
  label: string;
  tabs: readonly TabItem<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  /** The id of each tab and of the panel it controls, by value. */
  ids: (value: Value) => TabIds;
  inset?: TabsInset | undefined;
  density?: TabsDensity | undefined;
}): React.JSX.Element {
  return (
    <ChoiceRow<Value>
      label={label}
      options={tabs}
      value={value}
      onChoose={onChange}
      look={CHOICE_BAR_LOOK.FILL}
      size={density}
      panels={ids}
      inset={inset}
    />
  );
}
