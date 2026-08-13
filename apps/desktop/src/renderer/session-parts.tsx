import type { SessionState } from "@sidecar/core";
import { PANEL_TAB, panelPanelId, panelTabId } from "./panel-tabs";
import { ProviderMark } from "./provider-marks";
import {
  type ArrangedSessions,
  SESSION_SORT,
  type SessionSort,
  type SessionView,
} from "./session-model";

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

/**
 * The list's own controls, above the scrolling box rather than inside it, so
 * they stay where they were put however many sessions are observed — the same
 * place, and the same reason, as the tab bar above them.
 *
 * Both groups are pressed buttons rather than radios: a radio owes its reader
 * arrow-key navigation, and the panel is a surface someone tabs through beside
 * the capsule rather than one that claims the arrow keys. Each set is a real
 * `fieldset`, so the group is named for a reader by the markup rather than by
 * a role attached to a bare element.
 */
export function SessionToolbar({
  list,
  view,
  onViewChange,
}: {
  list: ArrangedSessions;
  view: SessionView;
  onViewChange: (view: SessionView) => void;
}): React.JSX.Element {
  return (
    <div className="session-toolbar" style={{ "--row-index": 1 } as React.CSSProperties}>
      {/* With only All to choose there is nothing to choose between, so the
          chips are left out rather than offered as a row of one answer. */}
      {list.options.length > 1 ? (
        <fieldset className="session-filters" aria-label="Show sessions">
          {list.options.map((option) => (
            <button
              type="button"
              key={option.filter}
              className="filter-chip"
              data-agent={String(option.providerId !== undefined)}
              data-active={String(option.filter === list.filter)}
              aria-pressed={option.filter === list.filter}
              // An agent is named by its own mark rather than by a word, which
              // is how every row below already names it — and four names would
              // not fit the line beside the coarser chips in any case. The
              // label is still the accessible name, so it is what is announced
              // and what a voice control is told to press.
              aria-label={option.providerId ? `${option.label} ${option.count}` : undefined}
              title={option.providerId ? option.label : undefined}
              onClick={() => onViewChange({ ...view, filter: option.filter })}
            >
              {option.providerId ? (
                <ProviderMark providerId={option.providerId} className="filter-mark" />
              ) : (
                option.label
              )}
              <span className="filter-count">{option.count}</span>
            </button>
          ))}
        </fieldset>
      ) : null}
      <div className="session-sort">
        <span className="session-sort-label" id={SORT_LABEL_ID}>
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
