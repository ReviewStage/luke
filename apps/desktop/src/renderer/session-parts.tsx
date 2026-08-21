import { useRef } from "react";
import { ERRAND_TARGET, errandTargetProps } from "./luke-errand";
import { PANEL_TAB, panelPanelId, panelTabId } from "./panel-tabs";
import { ProviderMark } from "./provider-marks";
import {
  type ArrangedSessions,
  SESSION_FILTER,
  SESSION_SORT,
  type SessionFilter,
  type SessionFilterAxis,
  type SessionFilterOption,
  type SessionSort,
  type SessionView,
  toggledSessionFilters,
} from "./session-model";
import { CloseIcon, CloudIcon, LaptopIcon, OptionsIcon, VoiceIcon } from "./settings-icons";

/**
 * Rides beside a branch name to say which kind of identifier it is: a branch
 * name alone reads as any string of slashes. Ours rather than a brand, so it is
 * drawn in whatever text colour the line already has.
 */
export function BranchGlyph(): React.JSX.Element {
  return (
    <svg className="row-branch-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <circle cx="4.2" cy="3.4" r="1.55" />
        <circle cx="4.2" cy="12.6" r="1.55" />
        <circle cx="11.8" cy="5.2" r="1.55" />
        <path d="M4.2 5v6M11.8 6.9c0 2.5-2.6 3-5.4 3.4" />
      </g>
    </svg>
  );
}

/**
 * Rides beside a workspace's name to say what kind of thing the tray is. The
 * shape is the tray itself in miniature — one box with its name line across
 * the top — drawn in whatever text colour the line already has, like the
 * branch glyph beside a branch.
 */
export function WorkspaceGlyph(): React.JSX.Element {
  return (
    <svg className="workspace-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <rect x="2.2" y="2.8" width="11.6" height="10.4" rx="2.6" />
        <path d="M2.8 6.5h10.4" />
      </g>
    </svg>
  );
}

/**
 * Marks a row the developer asked Luke to listen for — a small ear-like arc
 * pair, drawn in the line's own colour like every row glyph. The ask itself is
 * the hover and the accessible name, so the mark says what is being listened
 * for rather than only that something is.
 */
export function ListeningGlyph({ ask }: { ask: string }): React.JSX.Element {
  const label = `Luke is listening: ${ask}`;
  return (
    <svg
      className="row-listening"
      viewBox="0 0 16 16"
      role="img"
      aria-label={label}
      focusable="false"
    >
      <title>{label}</title>
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" />
        <path d="M4.6 4.6a4.8 4.8 0 0 0 0 6.8M11.4 4.6a4.8 4.8 0 0 1 0 6.8" />
      </g>
    </svg>
  );
}

/** Leads a finished session's sentence, the way a spinner leads a working one. */
export function CheckGlyph(): React.JSX.Element {
  return (
    <svg className="row-check" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path
        d="M2.4 6.6l2.5 2.5 4.7-5.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function EmptyState(): React.JSX.Element {
  return (
    <div className="empty-state">
      <strong>Nothing to watch yet</strong>
    </div>
  );
}

/** Wraps the sessions tab so its tab semantics match the settings tab. */
export function SessionsPanel({
  className,
  style,
  children,
}: {
  className: string;
  /** Custom properties the view is sized by — the open sheet's reserved height. */
  style?: React.CSSProperties;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={className}
      {...(style ? { style } : undefined)}
      role="tabpanel"
      id={panelPanelId(PANEL_TAB.SESSIONS)}
      aria-labelledby={panelTabId(PANEL_TAB.SESSIONS)}
    >
      {children}
    </div>
  );
}

interface SortDescriptor {
  sort: SessionSort;
  label: string;
  /** Said in full on hover, because two words alone could be read as states. */
  description: string;
}

const SORT_DESCRIPTORS: readonly SortDescriptor[] = [
  {
    sort: SESSION_SORT.URGENCY,
    label: "Urgent",
    description: "Most urgent first",
  },
  {
    sort: SESSION_SORT.RECENCY,
    label: "Recent",
    description: "Most recently observed first",
  },
];

const SORT_LABEL_ID = "session-sort-label";
export const SESSION_OPTIONS_ID = "session-options";
/**
 * The whole control the sheet answers to: the toggle and, while a selection
 * stands, the X that clears it. Named so the panel can tell a press here from
 * a press outside the sheet. The toggle keeps its own click: dismissed on the
 * way down and toggled on the way up, a press here would close and reopen the
 * sheet in one gesture. The X sits on the same control, so clearing is not
 * "outside" either.
 */
export const SESSION_OPTIONS_CONTROL_ID = "session-options-control";
export const SESSION_OPTIONS_BUTTON_ID = "session-options-button";

/** What each coarse chip is drawn with. An agent carries its own mark instead. */
function FilterIcon({ filter }: { filter: SessionFilter }): React.JSX.Element | null {
  if (filter === SESSION_FILTER.LOCAL) return <LaptopIcon />;
  if (filter === SESSION_FILTER.CLOUD) return <CloudIcon />;
  if (filter === SESSION_FILTER.VOICE) return <VoiceIcon />;
  return null;
}

/** The mark for a brand — agent or Superset — the glyph for a place, nothing for everything. */
function FilterMark({ option }: { option: SessionFilterOption }): React.JSX.Element | null {
  if (option.markId) {
    return <ProviderMark providerId={option.markId} className="filter-mark" />;
  }
  return <FilterIcon filter={option.filter} />;
}

/** The chips of the selection in force, in the order the sheet offers them. */
function selectedFilterOptions(list: ArrangedSessions): readonly SessionFilterOption[] {
  return list.groups
    .flatMap((group) => group.options)
    .filter((option) => list.filters.includes(option.filter));
}

/** How many chosen chips the button names before it resorts to counting. */
const NARROWED_ON_BUTTON = 2;

/**
 * The button that opens the list's own controls, on the tab bar's line because
 * that is the row the panel already spends on saying what you are looking at.
 *
 * It also has to say when the list is narrowed. A control that hides its own
 * effect is the one thing this panel cannot afford — the capsule is out there
 * counting sessions the list would not be showing — so the selection in force
 * is named on the button itself rather than only inside the sheet it opens.
 * The button has one line to say it on, so it names the first two choices and
 * counts the rest; the full selection stays on the hover and in the sheet.
 * While a selection stands, an X on the right clears every chosen chip at
 * once — a sibling rather than a nested button, because a button cannot hold
 * another, and a press there must not also toggle the sheet.
 */
export function SessionOptionsButton({
  list,
  open,
  onToggle,
  onClear,
}: {
  list: ArrangedSessions;
  open: boolean;
  onToggle: () => void;
  /** Drops every chosen chip. Offered only while a selection stands. */
  onClear: () => void;
}): React.JSX.Element {
  const toggle = useRef<HTMLButtonElement | null>(null);
  const narrowed = list.filters.length > 0;
  const named = selectedFilterOptions(list).slice(0, NARROWED_ON_BUTTON);
  const beyond = list.filters.length - named.length;
  const summary = selectionSummary(list);

  return (
    <span
      className="options-control"
      id={SESSION_OPTIONS_CONTROL_ID}
      data-narrowed={String(narrowed)}
      // The control already says how the list is being shown, so it is where
      // a narrowing or a re-ordering Luke made himself is signed. The mark
      // sits on the wrapper rather than the toggle because while a selection
      // stands the wrapper is the drawn pill, X segment and all, and a ring
      // around the toggle alone would outline half a control.
      {...errandTargetProps(ERRAND_TARGET.LIST_OPTIONS)}
    >
      <button
        ref={toggle}
        type="button"
        id={SESSION_OPTIONS_BUTTON_ID}
        className="options-button"
        data-active={String(open)}
        data-narrowed={String(narrowed)}
        aria-expanded={open}
        aria-controls={SESSION_OPTIONS_ID}
        aria-label={narrowed ? `Options — showing ${summary} only` : "Options"}
        title={narrowed ? `Showing ${summary} only` : "Filter and sort"}
        onClick={onToggle}
      >
        <OptionsIcon />
        {narrowed ? (
          <span className="options-current">
            {named.map((option) => (
              <span className="options-current-item" key={option.filter}>
                <FilterMark option={option} />
                {option.label}
              </span>
            ))}
            {beyond > 0 ? <span className="options-current-item">+{beyond}</span> : null}
          </span>
        ) : null}
      </button>
      {narrowed ? (
        <button
          type="button"
          className="options-clear"
          // Asking Luke for the whole list back is this X's own act, so that
          // is where he signs it — and the X unmounts under his tap, which
          // the errand already treats as a control the change took away.
          {...errandTargetProps(ERRAND_TARGET.LIST_CLEAR)}
          aria-label="Clear filters"
          title="Clear filters"
          onClick={() => {
            onClear();
            // The X unmounts with the selection. Return focus to the toggle
            // it sat beside, the way the search clear returns to its field,
            // so a keyboard press is not dumped onto the document.
            toggle.current?.focus();
          }}
        >
          <CloseIcon />
        </button>
      ) : null}
    </span>
  );
}

/** Names one axis's row for a reader, from the fixed axis value set. */
function filterAxisLabelId(axis: SessionFilterAxis): string {
  return `session-filter-axis-${axis}`;
}

/**
 * The selection in force, worded. A chosen value can outlive its chip — a
 * spoken ask can name the only provider there is — and it still has to be
 * named to be cleared, so a value no chip labels is worded by its own id
 * rather than left out.
 */
function selectionSummary(list: ArrangedSessions): string {
  const labels = new Map<SessionFilter, string>();
  for (const group of list.groups) {
    for (const option of group.options) labels.set(option.filter, option.label);
  }
  return list.filters.map((filter) => labels.get(filter) ?? filter).join(" · ");
}

/**
 * What the button opens: which sessions the list shows, and what puts one at
 * the top.
 *
 * It is drawn over the top of the list rather than above it. Inserted into the
 * flow it would push the last row down before the surface behind it had grown,
 * and the surface only grows on the spring — which would leave a row drawn on
 * the desktop for the length of it. Floating costs the top of the list while
 * the sheet is open, and costs the shape nothing.
 *
 * The filters combine — several chips can stand pressed at once, alternatives
 * within one row and a further narrowing across rows — so a chip press leaves
 * the sheet open for the next one: closing on each press would make choosing
 * two filters cost two openings. A sort is one choice of two, so choosing one
 * still puts the sheet away, as does pressing anywhere outside it. What an
 * open sheet covers while filters are picked is admitted on the options
 * button, which names the selection in force the whole time.
 *
 * Every group is pressed buttons rather than radios or checkboxes: a radio
 * owes its reader arrow-key navigation, and the panel is a surface someone
 * tabs through beside the capsule rather than one that claims the arrow keys.
 * Each set is a real `fieldset`, so the group is named for a reader by the
 * markup rather than by a role attached to a bare element.
 */
export function SessionOptions({
  list,
  view,
  onViewChange,
  onFiltersChange,
  measure,
}: {
  list: ArrangedSessions;
  view: SessionView;
  /** Carries a sort choice, and puts the sheet away with it. */
  onViewChange: (view: SessionView) => void;
  /** Carries a toggled selection; the sheet stays open for the next chip. */
  onFiltersChange: (filters: readonly SessionFilter[]) => void;
  /**
   * Reports the sheet's own height, so the list can reserve it: the sheet
   * floats, and a panel shorter than it would crop the sheet's foot at the
   * surface's clipped edge.
   */
  measure: (element: HTMLElement | null) => void;
}): React.JSX.Element {
  return (
    <div className="session-options" id={SESSION_OPTIONS_ID} ref={measure}>
      {list.groups.map((group) => (
        <div className="options-row" key={group.axis}>
          <span className="options-label" id={filterAxisLabelId(group.axis)}>
            {group.label}
          </span>
          <fieldset className="session-filters" aria-labelledby={filterAxisLabelId(group.axis)}>
            {group.options.map((option) => {
              const active = list.filters.includes(option.filter);
              return (
                <button
                  type="button"
                  key={option.filter}
                  className="filter-chip"
                  data-brand={String(option.markId !== undefined)}
                  data-active={String(active)}
                  aria-pressed={active}
                  // A brand is named by its own mark rather than by a word, which
                  // is how every row below already names agents and associated
                  // apps. The label stays the accessible name and hover.
                  aria-label={option.markId ? `${option.label} ${option.count}` : undefined}
                  title={option.markId ? option.label : undefined}
                  onClick={() =>
                    onFiltersChange(toggledSessionFilters(list.filters, option.filter))
                  }
                >
                  <FilterMark option={option} />
                  {option.markId ? null : option.label}
                  <span className="filter-count">{option.count}</span>
                </button>
              );
            })}
          </fieldset>
        </div>
      ))}
      <div className="options-row">
        <span className="options-label" id={SORT_LABEL_ID}>
          Sort
        </span>
        <fieldset className="sort-group" aria-labelledby={SORT_LABEL_ID}>
          {SORT_DESCRIPTORS.map((descriptor) => (
            <button
              type="button"
              key={descriptor.sort}
              className="sort-option"
              data-active={String(descriptor.sort === view.sort)}
              aria-pressed={descriptor.sort === view.sort}
              title={descriptor.description}
              onClick={() => onViewChange({ ...view, sort: descriptor.sort })}
            >
              {descriptor.label}
            </button>
          ))}
        </fieldset>
      </div>
    </div>
  );
}
