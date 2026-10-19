import type { ReactNode } from "react";
import { CHOICE_ROLE } from "../choice/choice-keys.js";
import { COUNT_TONE, type CountPart, CountParts, type CountTone } from "../choice/count-part.js";
import { useChoiceKeys } from "../choice/use-choice-keys.js";

/**
 * tabs.tsx -- the one row of tabs over a few views of one thing: each tab its glyph, its name, and a quiet count, the chosen one underlined on the row's hairline.
 *
 * It is a tablist, as a reader expects one: each tab is a tab selected
 * while its view is shown and controlling that view's panel, Tab lands on
 * the selected tab and leaves the row in one press, and the arrows (Home and
 * End to either end) move along it and show each view as they go, wrapping
 * at either end. The panels are the caller's: it gives each tab and panel
 * its id (`ids`), and draws each panel labelled by its tab. Narrower than
 * its tabs need, a tab other than the selected one keeps its glyph and its
 * count, its name left to a reader who cannot see it. A row whose tabs
 * line up with a reading measure's words (`inset`) stands them inside it,
 * its hairline still running to the container's edges, and one heading a
 * narrow column stands them in from its edges as far as the column's own
 * rows. A row in a narrow column that must name every tab (`density`)
 * draws them compact: the caption's type, a tab's room around its words
 * and between its name and its count taken in.
 */

/** Where the row stands its tabs: at its container's edges, or with the words of a page read at its measure, a column's inset at least. */
export const TABS_INSET = {
  NONE: "none",
  READING: "reading",
  COLUMN: "column",
} as const;

export type TabsInset = (typeof TABS_INSET)[keyof typeof TABS_INSET];

/** How much room the row keeps around its tabs: a page's, or a narrow column's, which names them all in less. */
export const TABS_DENSITY = {
  REGULAR: "regular",
  COMPACT: "compact",
} as const;

export type TabsDensity = (typeof TABS_DENSITY)[keyof typeof TABS_DENSITY];

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
export interface TabIds {
  readonly tab: string;
  readonly panel: string;
}

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
  // An arrow shows the next view along and takes the keyboard to its tab; Home and End go to either end.
  const keys = useChoiceKeys({ options: tabs, value, role: CHOICE_ROLE.TAB, onChoose: onChange });
  return (
    <div
      className="luke-tabs"
      data-inset={inset}
      data-density={density}
      role="tablist"
      aria-label={label}
      onKeyDown={keys.onKeyDown}
    >
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            id={ids(tab.value).tab}
            type="button"
            role="tab"
            className="luke-tab"
            aria-selected={selected}
            aria-controls={ids(tab.value).panel}
            tabIndex={keys.tabIndexOf(tab.value)}
            onClick={() => onChange(tab.value)}
          >
            {tab.icon === undefined ? null : (
              <span className="luke-tab-icon" aria-hidden="true">
                {tab.icon}
              </span>
            )}
            <span className="luke-tab-label">{tab.label}</span>
            {tab.count === undefined ? null : <span className="luke-tab-count">{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
