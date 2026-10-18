import type { ReactNode } from "react";

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
 * its hairline still running to the container's edges.
 */

/** The keys that move along the row, and which way. */
const STEP_KEYS = new Map([
  ["ArrowRight", 1],
  ["ArrowLeft", -1],
]);

/** Where the row stands its tabs: at its container's edges, or with the words of a page read at its measure, a column's inset at least. */
export const TABS_INSET = {
  NONE: "none",
  READING: "reading",
} as const;

export type TabsInset = (typeof TABS_INSET)[keyof typeof TABS_INSET];

/** What a count says beside a tab's name, in the state palette or quiet. */
export const TAB_COUNT_TONE = {
  QUIET: "quiet",
  COMPLETE: "complete",
  ATTENTION: "attention",
  DANGER: "danger",
} as const;

export type TabCountTone = (typeof TAB_COUNT_TONE)[keyof typeof TAB_COUNT_TONE];

/** One tab: the view it shows, its glyph, its name, and what it counts. */
export interface TabItem<Value extends string> {
  value: Value;
  label: string;
  /** A glyph before the name, which a narrow row keeps where it drops the name. */
  icon?: ReactNode;
  /** What the view counts, drawn quiet after the name; a `TabCount` where it has a tone. */
  count?: ReactNode;
}

/** The ids a tab and the panel it controls carry. */
export interface TabIds {
  readonly tab: string;
  readonly panel: string;
}

/** The index of the tab `key` moves to from `at` in a row of `length`, wrapping at either end; none for a key that moves nowhere. */
function targetOf(key: string, at: number, length: number): number | undefined {
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  const step = STEP_KEYS.get(key);
  return step === undefined ? undefined : (Math.max(at, 0) + step + length) % length;
}

/** A count's glyph and what it says, the words required beside one so it is never colour and shape alone. */
type TabCountGlyph =
  | { glyph?: undefined; glyphLabel?: undefined }
  | { glyph: ReactNode; glyphLabel: string };

/** A count in `tone`, a glyph before it saying its state in words to a reader who cannot see it. */
export function TabCount(
  props: {
    tone?: TabCountTone;
    children?: string | undefined;
  } & TabCountGlyph,
): React.JSX.Element {
  const { tone = TAB_COUNT_TONE.QUIET, glyph, glyphLabel, children } = props;
  return (
    <span className="luke-tab-count-part" data-tone={tone}>
      {glyph === undefined ? null : (
        <span className="luke-tab-count-glyph" role="img" aria-label={glyphLabel}>
          {glyph}
        </span>
      )}
      {children}
    </span>
  );
}

/** The row of `tabs`, `value`'s selected. */
export function Tabs<Value extends string>({
  label,
  tabs,
  value,
  onChange,
  ids,
  inset = TABS_INSET.NONE,
}: {
  /** The row's accessible name. */
  label: string;
  tabs: readonly TabItem<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  /** The id of each tab and of the panel it controls, by value. */
  ids: (value: Value) => TabIds;
  inset?: TabsInset | undefined;
}): React.JSX.Element {
  // An arrow shows the next view along and takes the keyboard to its tab; Home and End go to either end.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex((tab) => tab.value === value);
    const to = targetOf(event.key, at, tabs.length);
    const next = to === undefined ? undefined : tabs[to];
    if (next === undefined) return;
    event.preventDefault();
    if (next.value !== value) onChange(next.value);
    document.getElementById(ids(next.value).tab)?.focus();
  };
  return (
    <div
      className="luke-tabs"
      data-inset={inset}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
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
            tabIndex={selected ? 0 : -1}
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
