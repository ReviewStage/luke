import { useRef } from "react";
import { FOCUS_FRAME_LIMIT } from "./credential-entry";
import { type ArrangedSessions, matchRanges, type SessionView } from "./session-model";
import { CloseIcon, SearchIcon } from "./settings-icons";

/**
 * What the field is for, in the words the rows themselves use: it finds
 * sessions, and it finds them by anything a row says.
 */
const SEARCH_PLACEHOLDER = "Search sessions…";

/**
 * How the search field is found from outside the component, the way the ask
 * field is: the search key is answered at the app level, where the tab it may
 * have to switch lives, and the field it lands in is here.
 */
export const SESSION_SEARCH_INPUT_ID = "session-search-input";

/**
 * Puts the caret in a search field, waiting out its arrival on the way — the
 * same frame-by-frame seek the ask field needs, because the key can arrive
 * with Settings showing and the field not yet drawn. What is already typed is
 * selected rather than kept, so a repeated summons types the next question
 * over the last one instead of appending to it. The field is named by the
 * caller, because the settings search opens its own field the same way.
 */
export function focusSearchField(fieldId: string): () => void {
  let frame = 0;
  let frames = 0;
  const take = () => {
    const element = document.getElementById(fieldId);
    if (element instanceof HTMLInputElement && getComputedStyle(element).visibility === "visible") {
      element.focus({ preventScroll: true });
      element.select();
      return;
    }
    if (frames++ > FOCUS_FRAME_LIMIT) return;
    frame = requestAnimationFrame(take);
  };
  take();
  return () => cancelAnimationFrame(frame);
}

/**
 * The button that opens the search field, beside the options button because
 * both are ways of narrowing the same list. It stays lit while the field is
 * open, so the control and its effect cannot be read apart.
 */
export function SessionSearchButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="search-button"
      data-active={String(open)}
      aria-expanded={open}
      aria-label="Search sessions"
      aria-keyshortcuts="Meta+F"
      title="Search sessions (⌘F)"
      onClick={onToggle}
    >
      <SearchIcon />
    </button>
  );
}

/**
 * The search field itself: one pill above the list, holding the query, the
 * running count of what it left, and the way out. The count is the pill's
 * honesty — a field that narrows the list must say how far — and it counts
 * against the filtered set, because that is what the query was read over.
 *
 * Escape unwinds one layer at a time, the way it does everywhere else in the
 * panel: a held query is cleared first, and only an empty field closes the
 * search — both stopped here, so neither press falls through and closes the
 * panel behind the field.
 */
export function SessionSearch({
  list,
  view,
  onViewChange,
  onClose,
  onEngagedChange,
}: {
  list: ArrangedSessions;
  view: SessionView;
  onViewChange: (view: SessionView) => void;
  onClose: () => void;
  /**
   * Reports someone being part-way through a search, which holds the panel
   * open against the pointer wandering off — the same hold a half-typed ask
   * has, for the same reason: the caret is the signal that hands are here.
   */
  onEngagedChange: (engaged: boolean) => void;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement | null>(null);
  const matched = list.sessions.length;

  return (
    // The element is a real `search`, so the landmark comes from the markup
    // rather than a role on a bare box.
    // biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only by design — the keyboard already lands in the field by tabbing, and the click handler only places the caret.
    <search
      className="session-search"
      // The whole pill is the field: a press on its padding or its count is
      // someone reaching for the caret, so the caret is what they get.
      onClick={() => field.current?.focus()}
    >
      <SearchIcon />
      <input
        ref={field}
        id={SESSION_SEARCH_INPUT_ID}
        className="session-search-input"
        aria-label="Search sessions"
        placeholder={SEARCH_PLACEHOLDER}
        autoComplete="off"
        spellCheck={false}
        value={view.query}
        onChange={(event) => onViewChange({ ...view, query: event.target.value })}
        onFocus={() => {
          // The panel can be showing without its window being key, and a
          // field that cannot be typed into is worse than no field.
          window.sidecar.focusPanel();
          onEngagedChange(true);
        }}
        onBlur={() => onEngagedChange(false)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          if (view.query.length > 0) onViewChange({ ...view, query: "" });
          else onClose();
        }}
      />
      {list.search ? (
        <span className="session-search-count" aria-live="polite">
          {matched === 0 ? "No matches" : `${matched} of ${list.search.searched}`}
        </span>
      ) : null}
      {list.search ? (
        <button
          type="button"
          className="session-search-clear"
          aria-label="Clear search"
          title="Clear search"
          onClick={(event) => {
            // The pill's own click would re-place the caret after this — let
            // it: a cleared field with the caret in it is ready for the next
            // question, which is what pressing clear asks for.
            event.stopPropagation();
            onViewChange({ ...view, query: "" });
            field.current?.focus();
          }}
        >
          <CloseIcon />
        </button>
      ) : null}
    </search>
  );
}

/**
 * What an emptied search says instead of rows. It never just shrugs: when the
 * filter is hiding sessions the query would find, the way to them is offered
 * as a button, because "no matches" while matches sit behind a chip would be
 * the silent narrowing this list refuses everywhere else.
 */
export function SearchEmptyState({
  beyondFilter,
  onWiden,
}: {
  beyondFilter: number;
  /** Widens the view to All, which is where the hidden matches are. */
  onWiden: () => void;
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <strong>No sessions match</strong>
      {beyondFilter > 0 ? (
        <button type="button" className="empty-state-action" onClick={onWiden}>
          Show {beyondFilter} {beyondFilter === 1 ? "match" : "matches"} from all sessions
        </button>
      ) : null}
    </div>
  );
}

/**
 * One drawn line with the query's words marked where they landed, so a row
 * says why it matched. A line the words did not land on is returned as it
 * was — plenty of rows match on a field another line carries.
 */
export function Highlighted({
  text,
  tokens,
}: {
  text: string;
  tokens?: readonly string[] | undefined;
}): React.JSX.Element {
  if (!tokens || tokens.length === 0) return <>{text}</>;
  const ranges = matchRanges(text, tokens);
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let from = 0;
  for (const range of ranges) {
    if (range.start > from) parts.push(text.slice(from, range.start));
    parts.push(
      <mark className="row-match" key={range.start}>
        {text.slice(range.start, range.end)}
      </mark>,
    );
    from = range.end;
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}

/** The widened view an emptied search's button asks for: no filters at all. */
export function widenedView(view: SessionView): SessionView {
  return { ...view, filters: [] };
}
