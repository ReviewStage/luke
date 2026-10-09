import { CheckIcon, SearchIcon } from "@sidecar/panel";
import { useEffect, useId, useRef, useState } from "react";

/**
 * searchable-menu.tsx -- the one picker menu the repository chip and the Start button drop, and Settings' menus may.
 *
 * A command palette in a menu's clothes: a search field as the first row,
 * focused as the menu opens and filtering as it is typed in; under it the
 * rows, each an icon, a name, and a check where it is the one chosen, in a
 * list that scrolls past a bounded height; and under the list, pinned where
 * the scrolling cannot take it, whatever the owner wants always on screen,
 * such as the page on GitHub or the Start that names an effort. Focus stays
 * in the field the whole time: the arrows move a highlight through the rows
 * that match, Enter picks the highlighted one, and Escape asks the owner to
 * close, which stops here so it closes the menu and not what is behind it.
 * A pointer over a row highlights it the same way, so there is one
 * highlight however it was reached. A list too short to search is drawn
 * with no field, the list itself holding focus and reading the same keys.
 * The owner says what to list, what to say in the list's place while there
 * is nothing to list, and what a pick does; the menu decides nothing about
 * either.
 */

/** One row the menu lists. */
export interface MenuRow {
  /** Names the row apart from every other; what a pick hands back, and what `value` names. */
  id: string;
  label: string;
  /** A mark drawn ahead of the label: a provider's logo, the GitHub mark, a lock. */
  icon?: React.ReactNode;
  /** Words a search matches beside the label, such as a model's provider. */
  terms?: readonly string[];
}

/** The rows whose label or terms hold every word of the query, case aside; all of them for no query. */
function matchingRows<Row extends MenuRow>(rows: readonly Row[], query: string): readonly Row[] {
  const words = query.toLowerCase().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return rows;
  return rows.filter((row) => {
    const terms = [row.label, ...(row.terms ?? [])].map((term) => term.toLowerCase());
    return words.every((word) => terms.some((term) => term.includes(word)));
  });
}

/** Where the arrows take the highlight: a step on, wrapping at either end. */
function stepped(at: number, count: number, key: string): number {
  if (count === 0) return 0;
  return (at + (key === "ArrowDown" ? 1 : -1) + count) % count;
}

export function SearchableMenu(props: {
  /** The menu's id, which its trigger's `aria-controls` names. */
  id: string;
  /** What the list is, for assistive technology: "Repository", "Model". */
  label: string;
  /** The search field's placeholder; none draws the menu without a field, for a list too short to search. */
  placeholder?: string | undefined;
  rows: readonly MenuRow[];
  /** The id of the row chosen now, drawn checked; none while nothing is. */
  value: string | undefined;
  /** Said in the list's place while there is nothing to list: reading, a failure, an empty catalog. */
  note?: React.ReactNode;
  /** Said when a query matches nothing. */
  noMatch: string;
  onPick: (id: string) => void;
  /** Escape was pressed: the owner closes the menu and hands focus back to its trigger. */
  onClose: () => void;
  /** Focus left the menu for `left`; the owner closes unless that is still its own. */
  onLeave: (left: EventTarget | null) => void;
  /** Pinned under the list, always on screen. */
  foot?: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  const { rows, value, onPick } = props;
  const [query, setQuery] = useState("");
  const matches = matchingRows(rows, query);
  // The highlight starts on the chosen row, so Enter at once keeps what stands.
  const [highlight, setHighlight] = useState(() =>
    Math.max(
      0,
      rows.findIndex((row) => row.id === value),
    ),
  );
  const at = Math.min(highlight, Math.max(0, matches.length - 1));
  const listId = useId();
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const searching = props.placeholder !== undefined;

  // The field takes focus as the menu opens, and keeps it; with no field, the list does.
  useEffect(() => {
    (field.current ?? list.current)?.focus();
  }, []);

  // The row the arrows reach is brought into the bounded list's view.
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    row?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const onKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      props.onClose();
      return;
    }
    // Enter on a button in the foot is that button's own press.
    if (
      event.key === "Enter" &&
      (event.target === field.current || event.target === list.current)
    ) {
      const row = matches[at];
      if (row === undefined) return;
      event.preventDefault();
      onPick(row.id);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    (field.current ?? list.current)?.focus();
    setHighlight(stepped(at, matches.length, event.key));
  };

  const root =
    props.className === undefined
      ? "plan-compose-menu searchable-menu"
      : `plan-compose-menu searchable-menu ${props.className}`;
  return (
    <div
      id={props.id}
      className={root}
      role="dialog"
      aria-label={props.label}
      onKeyDown={onKey}
      onBlur={(event) => props.onLeave(event.relatedTarget)}
    >
      {searching ? (
        <div className="plan-compose-menu-search">
          <SearchIcon />
          <input
            ref={field}
            type="text"
            role="combobox"
            aria-label={props.placeholder}
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            placeholder={props.placeholder}
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setHighlight(0);
            }}
          />
        </div>
      ) : null}
      {/* Note that a press on a row is kept from taking focus, because the
          field is where the keys are read and a pick closes the menu anyway. */}
      <div
        ref={list}
        id={listId}
        className="plan-compose-menu-list"
        role="listbox"
        aria-label={props.label}
        tabIndex={searching ? undefined : -1}
        onMouseDown={(event) => event.preventDefault()}
      >
        {matches.map((row, index) => (
          <button
            key={row.id}
            type="button"
            role="option"
            tabIndex={-1}
            className="plan-compose-menu-row"
            aria-selected={index === at}
            aria-current={row.id === value ? "true" : undefined}
            onMouseMove={() => setHighlight(index)}
            onClick={() => onPick(row.id)}
          >
            {row.icon}
            <span className="plan-compose-menu-name">{row.label}</span>
            {row.id === value ? <CheckIcon /> : null}
          </button>
        ))}
        {props.note}
        {matches.length === 0 && props.note === undefined ? (
          <p className="plan-compose-menu-note">{props.noMatch}</p>
        ) : null}
      </div>
      {props.foot !== undefined ? <div className="plan-compose-menu-foot">{props.foot}</div> : null}
    </div>
  );
}
