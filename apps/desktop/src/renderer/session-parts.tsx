import type { SessionState } from "@sidecar/core";
import { PANEL_TAB, panelPanelId, panelTabId } from "./panel-tabs";
import { ProviderMark } from "./provider-marks";
import {
  type ArrangedSessions,
  SESSION_FILTER,
  SESSION_SORT,
  type SessionFilter,
  type SessionFilterOption,
  type SessionSort,
  type SessionView,
} from "./session-model";
import { CloudIcon, LaptopIcon, OptionsIcon } from "./settings-icons";

export function StateChip({
  state,
  label,
}: {
  state: SessionState;
  label: string;
}): React.JSX.Element {
  return (
    <span className="state-chip" data-state={state}>
      <span className="state-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function EmptyState(): React.JSX.Element {
  return (
    <div className="empty-state">
      <strong>Nothing to watch yet</strong>
      <small>Sessions appear here as soon as an agent starts working.</small>
    </div>
  );
}

/** Wraps the sessions tab so its tab semantics match the settings tab. */
export function SessionsPanel({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={className}
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
const SHOW_LABEL_ID = "session-show-label";
export const SESSION_OPTIONS_ID = "session-options";

/** What each coarse chip is drawn with. An agent carries its own mark instead. */
function FilterIcon({ filter }: { filter: SessionFilter }): React.JSX.Element | null {
  if (filter === SESSION_FILTER.LOCAL) return <LaptopIcon />;
  if (filter === SESSION_FILTER.CLOUD) return <CloudIcon />;
  return null;
}

/** The mark for an agent, the glyph for a place, nothing for everything. */
function FilterMark({ option }: { option: SessionFilterOption }): React.JSX.Element | null {
  if (option.providerId) {
    return <ProviderMark providerId={option.providerId} className="filter-mark" />;
  }
  return <FilterIcon filter={option.filter} />;
}

/**
 * The button that opens the list's own controls, on the tab bar's line because
 * that is the row the panel already spends on saying what you are looking at.
 *
 * It also has to say when the list is narrowed. A control that hides its own
 * effect is the one thing this panel cannot afford — the capsule is out there
 * counting sessions the list would not be showing — so a filter other than All
 * is named on the button itself rather than only inside the sheet it opens.
 */
export function SessionOptionsButton({
  list,
  open,
  onToggle,
}: {
  list: ArrangedSessions;
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const narrowed = list.options.find(
    (option) => option.filter === list.filter && option.filter !== SESSION_FILTER.ALL,
  );

  return (
    <button
      type="button"
      className="options-button"
      data-active={String(open)}
      data-narrowed={String(narrowed !== undefined)}
      aria-expanded={open}
      aria-controls={SESSION_OPTIONS_ID}
      aria-label={narrowed ? `Options — showing ${narrowed.label} only` : "Options"}
      title={narrowed ? `Showing ${narrowed.label} only` : "Filter and sort"}
      onClick={onToggle}
    >
      <OptionsIcon />
      {narrowed ? (
        <span className="options-current">
          <FilterMark option={narrowed} />
          {narrowed.label}
        </span>
      ) : null}
    </button>
  );
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
 * Both groups are pressed buttons rather than radios: a radio owes its reader
 * arrow-key navigation, and the panel is a surface someone tabs through beside
 * the capsule rather than one that claims the arrow keys. Each set is a real
 * `fieldset`, so the group is named for a reader by the markup rather than by
 * a role attached to a bare element.
 */
export function SessionOptions({
  list,
  view,
  onViewChange,
}: {
  list: ArrangedSessions;
  view: SessionView;
  onViewChange: (view: SessionView) => void;
}): React.JSX.Element {
  return (
    <div className="session-options" id={SESSION_OPTIONS_ID}>
      {/* With only All to choose there is nothing to choose between, so the
          chips are left out rather than offered as a row of one answer. */}
      {list.options.length > 1 ? (
        <div className="options-row">
          <span className="options-label" id={SHOW_LABEL_ID}>
            Show
          </span>
          <fieldset className="session-filters" aria-labelledby={SHOW_LABEL_ID}>
            {list.options.map((option) => (
              <button
                type="button"
                key={option.filter}
                className="filter-chip"
                data-agent={String(option.providerId !== undefined)}
                data-active={String(option.filter === list.filter)}
                aria-pressed={option.filter === list.filter}
                // An agent is named by its own mark rather than by a word, which
                // is how every row below already names it, and four names would
                // not fit the line beside the coarser chips. The label is still
                // the accessible name, so it is what is announced and what a
                // voice control is told to press.
                aria-label={option.providerId ? `${option.label} ${option.count}` : undefined}
                title={option.providerId ? option.label : undefined}
                onClick={() => onViewChange({ ...view, filter: option.filter })}
              >
                <FilterMark option={option} />
                {option.providerId ? null : option.label}
                <span className="filter-count">{option.count}</span>
              </button>
            ))}
          </fieldset>
        </div>
      ) : null}
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
