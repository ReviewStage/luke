import { ERRAND_TARGET, errandTargetProps } from "./luke-errand";
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

/**
 * Rides beside a branch name to say which kind of identifier it is: a branch
 // SAFETY: The preceding check establishes the asserted contract.
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
  // SAFETY: The preceding check establishes the asserted contract.
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
/**
 * Named so the panel can tell a press on the button from a press outside the
 * sheet. The button keeps its own toggle: dismissed on the way down and toggled
 * on the way up, a press here would close and reopen the sheet in one gesture.
 */
export const SESSION_OPTIONS_BUTTON_ID = "session-options-button";

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
      id={SESSION_OPTIONS_BUTTON_ID}
      className="options-button"
      // The button already says how the list is being shown, so it is where a
      // narrowing or a re-ordering Luke made himself is signed.
      {...errandTargetProps(ERRAND_TARGET.LIST_OPTIONS)}
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
 * What it costs has to be paid back the moment a choice is made. The sheet is
 * taller than a row, and a narrowed list can be a single row: left open over
 * one, it hides the very sessions it was asked for, and the control reads as
 * having done nothing. So `onViewChange` is also what puts the sheet away — it
 * is a menu over the list, not a shelf beside it.
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
          // SAFETY: The preceding check establishes the asserted contract.
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
