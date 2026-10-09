import { CheckIcon, ChevronRightIcon, SearchIcon } from "@sidecar/panel";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Tooltip } from "./tooltip";

/**
 * searchable-menu.tsx -- the one picker menu the repository chip and the Start button drop, and Settings' menus may.
 *
 * A command menu: a search field as the first row, focused as the menu
 * opens and filtering as it is typed in; under it the rows, each an icon,
 * a name, a muted detail where the row has one, and an end slot the check
 * stands in where it is the one chosen, in a list that scrolls past a
 * bounded height; and under the list, pinned where the scrolling cannot
 * take them, the rows the owner wants always on screen, such as the page
 * on GitHub or the effort an agent will run at. A pinned row is a press of
 * its own, a switch the press turns without closing anything, or opens a
 * submenu of rows beside itself, anchored to the row and turned to the
 * other side where the window leaves no room. Focus
 * stays in the field the whole time: the arrows move one highlight
 * through the rows that match and on through the pinned rows, Enter picks
 * the highlighted one, Right opens its submenu and Left closes it, and
 * Escape closes the submenu where one is open and otherwise asks the
 * owner to close, which stops here so it closes the menu and not what is
 * behind it. A pointer over a row highlights it the same way, so there is
 * one highlight however it was reached, and a submenu opened by the
 * pointer closes only as the highlight moves on, never as the pointer
 * crosses to it. A list too short to search is drawn with no field, the
 * list itself holding focus and reading the same keys. The owner says
 * what to list, what to say in the list's place while there is nothing to
 * list, and what a pick does; the menu decides nothing about either.
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
  /** Muted words after the label: the effort a model runs at, an owner, "(Fast)". */
  detail?: string | undefined;
}

/** Rows a pinned row opens beside itself: the efforts a model lists. */
interface Submenu {
  /** What the rows are, for assistive technology. */
  label: string;
  rows: readonly MenuRow[];
  /** The id of the row chosen now, drawn checked. */
  value: string | undefined;
  onPick: (id: string) => void;
}

/** A row pinned under the list: a press of its own, a switch, or a submenu beside it. */
export interface FootRow {
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** Muted words at the row's end, before its mark: the effort chosen now. */
  detail?: string | undefined;
  /** A mark in the row's end slot: the arrow out on a row that leaves the app. A submenu row draws its own chevron. */
  mark?: React.ReactNode;
  onPress?: () => void;
  submenu?: Submenu;
  /** A switch at the row's end, which a press turns; the menu stays open. */
  toggle?: { on: boolean; onToggle: () => void };
  /** The row cannot be pressed, and says why on hover. */
  disabled?: string | undefined;
}

/** Which side of the menu a submenu stands on: beside its row to the right, or to the left where there is no room. */
const SUBMENU_SIDE = {
  RIGHT: "right",
  LEFT: "left",
} as const;

type SubmenuSide = (typeof SUBMENU_SIDE)[keyof typeof SUBMENU_SIDE];

/** How a submenu stands against its row: down from the row's top, or up from its foot where the window's bottom would cut it. */
const SUBMENU_STAND = {
  DOWN: "down",
  UP: "up",
} as const;

type SubmenuStand = (typeof SUBMENU_STAND)[keyof typeof SUBMENU_STAND];

/** Where a submenu stands, measured as it opens. */
interface SubmenuPlace {
  side: SubmenuSide;
  stand: SubmenuStand;
}

const SUBMENU_FIRST_PLACE: SubmenuPlace = { side: SUBMENU_SIDE.RIGHT, stand: SUBMENU_STAND.DOWN };

/** The rows whose label or terms hold every word of the query, case aside; all of them for no query. */
function matchingRows<Row extends MenuRow>(rows: readonly Row[], query: string): readonly Row[] {
  const words = query.toLowerCase().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return rows;
  return rows.filter((row) => {
    const terms = [row.label, ...(row.terms ?? [])].map((term) => term.toLowerCase());
    return words.every((word) => terms.some((term) => term.includes(word)));
  });
}

/**
 * Where the arrows take the highlight: a step on, wrapping at either end,
 * and on past any row that cannot be pressed; from nowhere, to the first or
 * the last. Where no row can be, the highlight stays.
 */
function stepped(
  at: number,
  count: number,
  key: string,
  skipped: (index: number) => boolean = () => false,
): number {
  if (count === 0) return 0;
  const down = key === "ArrowDown";
  let next = at < 0 ? (down ? 0 : count - 1) : (at + (down ? 1 : -1) + count) % count;
  for (let steps = 1; steps < count && skipped(next); steps += 1) {
    next = (next + (down ? 1 : -1) + count) % count;
  }
  return skipped(next) ? at : next;
}

/** Where no row is highlighted: nothing matches and the arrows have not moved on to a pinned row. */
const NOWHERE = -1;

/** The highlight over a set of rows: the one moved to, else the one chosen, else the first match, else nowhere. */
function highlightOver(input: {
  moved: number | undefined;
  chosen: number;
  matches: number;
  count: number;
}): number {
  if (input.moved !== undefined) return Math.min(input.moved, input.count - 1);
  if (input.chosen >= 0) return input.chosen;
  return input.matches > 0 ? 0 : NOWHERE;
}

/** The inside of every row: the mark, the name, the detail, and the end slot, which is drawn whether or not it holds anything so the names line up. */
function RowBody(props: {
  icon: React.ReactNode;
  label: string;
  detail: string | undefined;
  end: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      {props.icon}
      <span className="plan-compose-menu-name">{props.label}</span>
      {props.detail !== undefined ? (
        <span className="plan-compose-menu-detail">{props.detail}</span>
      ) : null}
      <span className="plan-compose-menu-end">{props.end}</span>
    </>
  );
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
  /** Pinned under the list, always on screen, reached by the arrows past the last match. */
  foot?: readonly FootRow[] | undefined;
  className?: string;
}): React.JSX.Element {
  const { rows, value, onPick } = props;
  const [query, setQuery] = useState("");
  const matches = matchingRows(rows, query);
  const foot = props.foot ?? [];
  // Until the arrows or the pointer move it, the highlight follows the chosen
  // row, which may arrive after the menu opened, so Enter keeps what stands.
  const [highlight, setHighlight] = useState<number | undefined>(undefined);
  const chosen = matches.findIndex((row) => row.id === value);
  const at = highlightOver({
    moved: highlight,
    chosen,
    matches: matches.length,
    count: matches.length + foot.length,
  });
  const footAt = at - matches.length;
  const branch = footAt >= 0 ? foot[footAt]?.submenu : undefined;
  // The submenu open under the highlighted pinned row, and the highlight inside it.
  const [submenu, setSubmenu] = useState<{ moved: number | undefined } | undefined>(undefined);
  const [place, setPlace] = useState<SubmenuPlace>(SUBMENU_FIRST_PLACE);
  const open = branch !== undefined && submenu !== undefined ? branch : undefined;
  const subChosen = open?.rows.findIndex((row) => row.id === open.value) ?? -1;
  const subAt = highlightOver({
    moved: submenu?.moved,
    chosen: subChosen,
    matches: open?.rows.length ?? 0,
    count: open?.rows.length ?? 0,
  });
  const listId = useId();
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
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

  // A submenu opens to the right and down from its row, and turns to the
  // left or stands up where the window ends before it does, measured
  // before it is painted.
  const opened = open !== undefined;
  useLayoutEffect(() => {
    if (!opened || panel.current === null) return;
    const bounds = panel.current.getBoundingClientRect();
    const room = document.documentElement;
    setPlace({
      side: bounds.right > room.clientWidth ? SUBMENU_SIDE.LEFT : SUBMENU_SIDE.RIGHT,
      stand: bounds.bottom > room.clientHeight ? SUBMENU_STAND.UP : SUBMENU_STAND.DOWN,
    });
  }, [opened]);

  const moveTo = (index: number | undefined) => {
    setHighlight(index);
    setSubmenu(undefined);
  };
  const openSubmenu = () => {
    setPlace(SUBMENU_FIRST_PLACE);
    setSubmenu({ moved: undefined });
  };
  const pressFoot = (row: FootRow) => {
    if (row.disabled !== undefined) return;
    if (row.submenu !== undefined) openSubmenu();
    else if (row.toggle !== undefined) row.toggle.onToggle();
    else row.onPress?.();
  };

  const onKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (open !== undefined) setSubmenu(undefined);
      else props.onClose();
      return;
    }
    if (event.key === "ArrowLeft" && open !== undefined) {
      event.preventDefault();
      setSubmenu(undefined);
      return;
    }
    if (event.key === "ArrowRight" && branch !== undefined && open === undefined) {
      event.preventDefault();
      openSubmenu();
      return;
    }
    // Enter on a button in the foot is that button's own press; from the field
    // or the list it picks the highlighted row, and goes no further either way,
    // so a form around the menu never takes it as its own submit.
    if (
      event.key === "Enter" &&
      (event.target === field.current || event.target === list.current)
    ) {
      event.preventDefault();
      if (open !== undefined) {
        const row = open.rows[subAt];
        if (row !== undefined) open.onPick(row.id);
        return;
      }
      const row = at >= 0 ? matches[at] : undefined;
      const pinned = footAt >= 0 ? foot[footAt] : undefined;
      if (row !== undefined) onPick(row.id);
      else if (pinned !== undefined) pressFoot(pinned);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    (field.current ?? list.current)?.focus();
    if (open !== undefined) {
      setSubmenu({ moved: stepped(subAt, open.rows.length, event.key) });
      return;
    }
    // A pinned row that cannot be pressed is passed over, and never a dead stop.
    setHighlight(
      stepped(
        at,
        matches.length + foot.length,
        event.key,
        (index) => foot[index - matches.length]?.disabled !== undefined,
      ),
    );
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
              const typed = event.currentTarget.value;
              setQuery(typed);
              // The first match takes the highlight; with none, nothing does, so Enter picks nothing.
              moveTo(matchingRows(rows, typed).length > 0 ? 0 : undefined);
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
            onMouseMove={() => moveTo(index)}
            onClick={() => onPick(row.id)}
          >
            <RowBody
              icon={row.icon}
              label={row.label}
              detail={row.detail}
              end={row.id === value ? <CheckIcon /> : null}
            />
          </button>
        ))}
        {props.note}
        {matches.length === 0 && props.note === undefined ? (
          <p className="plan-compose-menu-note">{props.noMatch}</p>
        ) : null}
      </div>
      {foot.length > 0 ? (
        <div className="plan-compose-menu-foot">
          {foot.map((row, index) => {
            // What every pinned row's button shares; a switch row adds its role on top.
            const shared = {
              type: "button",
              tabIndex: -1,
              className: "plan-compose-menu-row",
              "aria-disabled": row.disabled === undefined ? undefined : "true",
              "data-highlighted": index === footAt ? "true" : undefined,
              onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
              onMouseMove: () => {
                if (row.disabled !== undefined) return;
                if (index === footAt && (open !== undefined || row.submenu === undefined)) return;
                setHighlight(matches.length + index);
                if (row.submenu === undefined) setSubmenu(undefined);
                else openSubmenu();
              },
              onClick: () => pressFoot(row),
            } as const;
            const button =
              row.toggle === undefined ? (
                <button
                  {...shared}
                  data-submenu={row.submenu === undefined ? undefined : "true"}
                  aria-haspopup={row.submenu === undefined ? undefined : "listbox"}
                  aria-expanded={
                    row.submenu === undefined ? undefined : index === footAt && open !== undefined
                  }
                >
                  <RowBody
                    icon={row.icon}
                    label={row.label}
                    detail={row.detail}
                    end={row.submenu === undefined ? row.mark : <ChevronRightIcon />}
                  />
                </button>
              ) : (
                <button {...shared} role="switch" aria-checked={row.toggle.on}>
                  {row.icon}
                  <span className="plan-compose-menu-name">{row.label}</span>
                  <span className="switch plan-compose-menu-switch">
                    <span className="switch-thumb" />
                  </span>
                </button>
              );
            return (
              <div key={row.id} className="plan-compose-menu-branch">
                {row.disabled === undefined ? (
                  button
                ) : (
                  <Tooltip label={row.disabled}>{button}</Tooltip>
                )}
                {index === footAt && open !== undefined ? (
                  <div
                    ref={panel}
                    className="plan-compose-submenu"
                    role="listbox"
                    aria-label={open.label}
                    data-side={place.side}
                    data-stand={place.stand}
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    {open.rows.map((sub, subIndex) => (
                      <button
                        key={sub.id}
                        type="button"
                        role="option"
                        tabIndex={-1}
                        className="plan-compose-menu-row"
                        aria-selected={subIndex === subAt}
                        aria-current={sub.id === open.value ? "true" : undefined}
                        onMouseMove={() => setSubmenu({ moved: subIndex })}
                        onClick={() => open.onPick(sub.id)}
                      >
                        <RowBody
                          icon={sub.icon}
                          label={sub.label}
                          detail={sub.detail}
                          end={sub.id === open.value ? <CheckIcon /> : null}
                        />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
