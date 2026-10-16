import { CheckIcon, ChevronRightIcon, SearchIcon } from "@luke/ui";
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { APP_SHORTCUTS, type KeyedCommand } from "#shared/shortcuts";
import { Shortcut } from "./shortcut";
import { Switch } from "./switch";
import { Tooltip } from "./tooltip";
import { useClipped } from "./use-clipped";

/**
 * searchable-menu.tsx -- the one picker menu the repository chip, the Start button, and the side panel's "+" drop, and Settings' menus may.
 *
 * A command menu: a search field as the first row, focused as the menu
 * opens and filtering as it is typed in; under it the rows, each an icon,
 * a name, a muted detail where the row has one, the shortcut that does the
 * same where there is one, and an end slot the check stands in where it is
 * the one chosen; a name or a detail cut short by the menu's width fades
 * out at its end rather than ending in an ellipsis, in a list that scrolls past a bounded height, the rows
 * of a section under its heading; and under the list, pinned where the scrolling cannot
 * take them, the rows the owner wants always on screen, such as the page
 * on GitHub or the effort an agent will run at. A pinned row is a press of
 * its own, a switch the press turns without closing anything, or opens a
 * submenu of rows beside itself, anchored to the row and turned to the
 * other side where the window leaves no room. Focus
 * stays in the field the whole time: the arrows move one highlight
 * through the rows that match and on through the pinned rows, past any
 * that cannot be picked now, which are dimmed and say why, Enter picks
 * the highlighted one, Right opens its submenu and Left closes it, and
 * Escape closes the submenu where one is open and otherwise asks the
 * owner to close, which stops here so it closes the menu and not what is
 * behind it. A pointer over a row highlights it the same way, so there is
 * one highlight however it was reached, and a submenu opened by the
 * pointer closes only as the highlight moves on, never as the pointer
 * crosses to it. Home and End take the highlight to the first and the
 * last row that may be picked. Focus never moves to a row, so the field
 * names the highlighted one to assistive technology by
 * `aria-activedescendant`, each row holding a stable id of its own. A
 * list too short to search is drawn with no field, the list itself
 * holding focus, naming the highlight, and reading the same keys. The owner says
 * what to list, what to say in the list's place while there is nothing to
 * list, and what a pick does; the menu decides nothing about either.
 * Its owner holds it drawn through its exit (`useDisclosure`), handing it
 * `leaving`, which leaves it inert and fading, focus already handed back.
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
  /** Muted words after the label: the effort a model runs at, an owner, "(Fast)", where an agent stands. */
  detail?: React.ReactNode;
  /** The heading the row stands under, with the rows beside it that share it, and which a search matches; none stands under no heading. */
  section?: string | undefined;
  /** The shortcut that does what picking the row does, printed muted at the row's end. */
  command?: KeyedCommand | undefined;
  /** Why the row cannot be picked now, printed muted at its end in the shortcut's place; the row is dimmed and the arrows pass over it. */
  disabled?: string | undefined;
  /** The row is listed only once something is searched: a model older than its family's newest. */
  searchOnly?: boolean | undefined;
}

/** A run of matching rows under one heading, or under none, each with its place among the matches. */
interface Section<Row extends MenuRow> {
  heading: string | undefined;
  rows: { row: Row; index: number }[];
}

/** Rows a pinned row opens beside itself: the efforts a model lists, its context windows. */
interface Submenu {
  /** What the rows are, for assistive technology. */
  label: string;
  rows: readonly MenuRow[];
  /** The id of the row chosen now, drawn checked. */
  value: string | undefined;
  onPick: (id: string) => void;
  /** One muted line under the rows, pressed by nothing: what the long context window costs. */
  note?: string | undefined;
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

/** The matching rows cut into runs that share a heading, in their order. */
function sectionsOf<Row extends MenuRow>(rows: readonly Row[]): Section<Row>[] {
  const sections: Section<Row>[] = [];
  rows.forEach((row, index) => {
    const last = sections.at(-1);
    if (last !== undefined && last.heading === row.section) last.rows.push({ row, index });
    else sections.push({ heading: row.section, rows: [{ row, index }] });
  });
  return sections;
}

/** The first row that may be picked, or nowhere. */
function firstOpen(rows: readonly MenuRow[]): number {
  return rows.findIndex((row) => row.disabled === undefined);
}

/** The rows whose label, terms, or section hold every word of the query, case aside; for no query, every row not kept for a search. */
function matchingRows<Row extends MenuRow>(rows: readonly Row[], query: string): readonly Row[] {
  const words = query.toLowerCase().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return rows.filter((row) => row.searchOnly !== true);
  return rows.filter((row) => {
    const named = [
      row.label,
      ...(row.terms ?? []),
      ...(row.section === undefined ? [] : [row.section]),
    ];
    const terms = named.map((term) => term.toLowerCase());
    return words.every((word) => terms.some((term) => term.includes(word)));
  });
}

/** The keys that move the highlight. */
const STEP_KEYS: ReadonlySet<string> = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

/**
 * Where a key takes the highlight: the arrows a step on, wrapping at either
 * end, and on past any row that cannot be pressed; from nowhere, to the
 * first or the last; Home and End to the first or the last that can be.
 * Where no row can be, the highlight stays.
 */
function stepped(
  at: number,
  count: number,
  key: string,
  skipped: (index: number) => boolean = () => false,
): number {
  if (count === 0) return 0;
  const down = key === "ArrowDown" || key === "Home";
  const edge = key === "Home" || key === "End";
  let next = at < 0 || edge ? (down ? 0 : count - 1) : (at + (down ? 1 : -1) + count) % count;
  for (let steps = 1; steps < count && skipped(next); steps += 1) {
    next = (next + (down ? 1 : -1) + count) % count;
  }
  return skipped(next) ? at : next;
}

/** Where no row is highlighted: nothing matches and the arrows have not moved on to a pinned row. */
const NOWHERE = -1;

/**
 * The highlight over a set of rows: the one moved to while it may still be
 * picked, else the one chosen, else the first that may be picked, else
 * nowhere. Note that the row moved to is asked again on every render,
 * because the owner may hand rows anew with it now cut off.
 */
function highlightOver(input: {
  moved: number | undefined;
  chosen: number;
  first: number;
  count: number;
  blocked: (index: number) => boolean;
}): number {
  const moved = input.moved === undefined ? undefined : Math.min(input.moved, input.count - 1);
  if (moved !== undefined && !input.blocked(moved)) return moved;
  if (input.chosen >= 0) return input.chosen;
  return input.first;
}

/** The highlighted row of an open submenu, which a reader is told of before the pinned row it opened from. */
const SUBMENU_HIGHLIGHT = '.task-compose-submenu [aria-selected="true"]';

/** The highlighted option of the list itself. */
const OPTION_HIGHLIGHT = '[aria-selected="true"]';

/** The one highlighted row of the list or the pinned rows under it. */
const MENU_HIGHLIGHT = '.task-compose-menu-list [aria-selected="true"], [data-highlighted="true"]';

/** Hands a row drawn in a loop, where no hook may be called, a stable id of its own. */
function WithId(props: { children: (id: string) => React.JSX.Element }): React.JSX.Element {
  return props.children(useId());
}

/** What a row prints before its end slot: why it cannot be picked, its shortcut, or nothing. */
function RowHint({ row }: { row: MenuRow }): React.JSX.Element | null {
  if (row.disabled !== undefined) {
    return <span className="menu-item-hint">{row.disabled}</span>;
  }
  if (row.command === undefined) return null;
  return <Shortcut chord={APP_SHORTCUTS[row.command].chord} className="menu-item-hint" />;
}

/** Words in a row cut short by its width, marked so desktop.css fades them out at their end. */
function RowWords(props: { className: string; children: React.ReactNode }): React.JSX.Element {
  const [words, clipped] = useClipped();
  return (
    <span ref={words} className={props.className} data-overflow={String(clipped)}>
      {props.children}
    </span>
  );
}

/** A row's mark, in the glyph slot every menu's rows share; none where the row has no mark. */
function RowGlyph({ icon }: { icon: React.ReactNode }): React.JSX.Element | null {
  if (icon === undefined || icon === null) return null;
  return <span className="menu-item-glyph">{icon}</span>;
}

/** The inside of every row: the mark, the name, the detail, the hint, and the end slot, which is drawn whether or not it holds anything so the names line up. */
function RowBody(props: {
  icon: React.ReactNode;
  label: string;
  detail: React.ReactNode;
  hint?: React.ReactNode;
  end: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      <RowGlyph icon={props.icon} />
      <RowWords className="task-compose-menu-name">{props.label}</RowWords>
      {props.detail !== undefined ? (
        <RowWords className="task-compose-menu-detail">{props.detail}</RowWords>
      ) : null}
      {props.hint}
      <span className="menu-item-end">{props.end}</span>
    </>
  );
}

/**
 * A menu's rows drawn in place rather than dropped: each a button of its own
 * in the page's order, in a row's look, under its section's heading as the
 * menu heads it, with no search and no highlight of its own, as the side
 * panel's well offers what its "+" offers with every tab closed.
 */
export function MenuRowList({
  rows,
  onPick,
}: {
  rows: readonly MenuRow[];
  onPick: (id: string) => void;
}): React.JSX.Element {
  return (
    <>
      {sectionsOf(rows).map((section) => {
        const buttons = section.rows.map(({ row }) => (
          <button
            key={row.id}
            type="button"
            className="menu-item"
            disabled={row.disabled !== undefined}
            onClick={() => onPick(row.id)}
          >
            <RowBody
              icon={row.icon}
              label={row.label}
              detail={row.detail}
              hint={<RowHint row={row} />}
              end={null}
            />
          </button>
        ));
        const first = section.rows[0]?.row.id;
        return section.heading === undefined ? (
          <Fragment key={first}>{buttons}</Fragment>
        ) : (
          <section key={first} aria-label={section.heading}>
            <div className="menu-heading" aria-hidden="true">
              {section.heading}
            </div>
            {buttons}
          </section>
        );
      })}
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
  /** One muted line under the pinned rows, pressed by nothing: what the agent has cost. */
  footNote?: string | undefined;
  className?: string;
  /** The menu is on its way out: drawn fading, and taking nothing. */
  leaving?: boolean | undefined;
  /** Hands the menu's element to the hold its owner draws it through its exit with. */
  ref?: ((element: HTMLElement | null) => void) | undefined;
}): React.JSX.Element {
  const { rows, value, onPick } = props;
  const leaving = props.leaving === true;
  const [query, setQuery] = useState("");
  const matches = matchingRows(rows, query);
  const foot = props.foot ?? [];
  // Until the arrows or the pointer move it, the highlight follows the chosen
  // row, which may arrive after the menu opened, so Enter keeps what stands.
  const [highlight, setHighlight] = useState<number | undefined>(undefined);
  const chosen = matches.findIndex((row) => row.id === value);
  // A row that cannot be picked takes no highlight, from the arrows or from a moment ago.
  const blocked = (index: number) =>
    (matches[index] ?? foot[index - matches.length])?.disabled !== undefined;
  const at = highlightOver({
    moved: highlight,
    chosen,
    first: firstOpen(matches),
    count: matches.length + foot.length,
    blocked,
  });
  const footAt = at - matches.length;
  const branch = footAt >= 0 ? foot[footAt]?.submenu : undefined;
  // The submenu open under the highlighted pinned row, and the highlight inside it.
  const [submenu, setSubmenu] = useState<{ moved: number | undefined } | undefined>(undefined);
  const [place, setPlace] = useState<SubmenuPlace>(SUBMENU_FIRST_PLACE);
  // Opened again while it was leaving, the menu starts afresh, as one opened anew does.
  const [wasLeaving, setWasLeaving] = useState(leaving);
  if (wasLeaving !== leaving) {
    setWasLeaving(leaving);
    if (!leaving) {
      setQuery("");
      setHighlight(undefined);
      setSubmenu(undefined);
    }
  }
  const open = branch !== undefined && submenu !== undefined ? branch : undefined;
  const subChosen = open?.rows.findIndex((row) => row.id === open.value) ?? -1;
  const subAt = highlightOver({
    moved: submenu?.moved,
    chosen: subChosen,
    first: open === undefined || open.rows.length === 0 ? NOWHERE : 0,
    count: open?.rows.length ?? 0,
    blocked: () => false,
  });
  const listId = useId();
  const footId = useId();
  const submenuId = useId();
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // The menu's element is its own and also its owner's, whose hold waits on its exit.
  const hold = props.ref;
  const drawn = useCallback(
    (node: HTMLDivElement | null) => {
      menu.current = node;
      hold?.(node);
    },
    [hold],
  );
  const searching = props.placeholder !== undefined;

  // The field takes focus as the menu opens, and keeps it; with no field, the
  // list does. A menu opened again while it was leaving takes it back too.
  useEffect(() => {
    if (!leaving) (field.current ?? list.current)?.focus();
  }, [leaving]);

  // Note that the field, or the list where there is none, names the
  // highlighted row after every render, because focus stays there and a
  // reader would otherwise hear nothing as the arrows move. The field may
  // name a pinned or a submenu row, since it controls those too; the list
  // names only its own options, which are all it holds.
  useLayoutEffect(() => {
    const keys = field.current ?? list.current;
    const row =
      field.current === null
        ? list.current?.querySelector(OPTION_HIGHLIGHT)
        : (menu.current?.querySelector(SUBMENU_HIGHLIGHT) ??
          menu.current?.querySelector(MENU_HIGHLIGHT));
    if (row?.id) keys?.setAttribute("aria-activedescendant", row.id);
    else keys?.removeAttribute("aria-activedescendant");
  });

  // The row the arrows reach is brought into the bounded list's view.
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    row?.scrollIntoView({ block: "nearest" });
  }, [at]);

  // A submenu opens to the right and down from its row, and turns to the
  // left or stands up where the window ends before it does, measured
  // before it is painted, and again as the pointer moves it to another
  // row, whose submenu may stand taller.
  const openAt = open === undefined ? undefined : footAt;
  useLayoutEffect(() => {
    if (openAt === undefined || panel.current === null) return;
    const bounds = panel.current.getBoundingClientRect();
    const room = document.documentElement;
    setPlace({
      side: bounds.right > room.clientWidth ? SUBMENU_SIDE.LEFT : SUBMENU_SIDE.RIGHT,
      stand: bounds.bottom > room.clientHeight ? SUBMENU_STAND.UP : SUBMENU_STAND.DOWN,
    });
  }, [openAt]);

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
      if (row !== undefined) {
        if (row.disabled === undefined) onPick(row.id);
      } else if (pinned !== undefined) pressFoot(pinned);
      return;
    }
    if (!STEP_KEYS.has(event.key)) return;
    event.preventDefault();
    (field.current ?? list.current)?.focus();
    if (open !== undefined) {
      setSubmenu({ moved: stepped(subAt, open.rows.length, event.key) });
      return;
    }
    // A row that cannot be picked is passed over, and never a dead stop.
    setHighlight(stepped(at, matches.length + foot.length, event.key, blocked));
  };

  // What the field controls, as the space-separated list of ids ARIA reads:
  // the list, the pinned rows, and a submenu while one is open, so every row
  // it may name stands in a popup it controls.
  const footed = foot.length > 0 || props.footNote !== undefined;
  const controlled = [
    listId,
    ...(footed ? [footId] : []),
    ...(open === undefined ? [] : [submenuId]),
  ];
  const root =
    props.className === undefined
      ? "menu-surface searchable-menu"
      : `menu-surface searchable-menu ${props.className}`;
  return (
    <div
      ref={drawn}
      id={props.id}
      className={root}
      role="dialog"
      aria-label={props.label}
      data-leaving={leaving ? "true" : undefined}
      inert={leaving}
      onKeyDown={onKey}
      onBlur={(event) => props.onLeave(event.relatedTarget)}
    >
      {searching ? (
        <div className="task-compose-menu-search">
          <SearchIcon />
          <input
            ref={field}
            type="text"
            role="combobox"
            aria-label={props.placeholder}
            aria-expanded="true"
            aria-controls={controlled.join(" ")}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            placeholder={props.placeholder}
            value={query}
            onChange={(event) => {
              const typed = event.currentTarget.value;
              setQuery(typed);
              // The first match that may be picked takes the highlight; with
              // none, nothing does, so Enter picks nothing.
              const first = firstOpen(matchingRows(rows, typed));
              moveTo(first === NOWHERE ? undefined : first);
            }}
          />
        </div>
      ) : null}
      {/* Note that a press on a row is kept from taking focus, because the
          field is where the keys are read and a pick closes the menu anyway. */}
      <div
        ref={list}
        id={listId}
        className="task-compose-menu-list"
        role="listbox"
        aria-label={props.label}
        tabIndex={searching ? undefined : -1}
        onMouseDown={(event) => event.preventDefault()}
      >
        {sectionsOf(matches).map((section) => {
          const options = section.rows.map(({ row, index }) => (
            <WithId key={row.id}>
              {(id) => (
                <button
                  id={id}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  className="menu-item"
                  aria-selected={index === at}
                  aria-disabled={row.disabled === undefined ? undefined : "true"}
                  aria-current={row.id === value ? "true" : undefined}
                  onMouseMove={() => {
                    if (row.disabled === undefined) moveTo(index);
                  }}
                  onClick={() => {
                    if (row.disabled === undefined) onPick(row.id);
                  }}
                >
                  <RowBody
                    icon={row.icon}
                    label={row.label}
                    detail={row.detail}
                    hint={<RowHint row={row} />}
                    end={row.id === value ? <CheckIcon /> : null}
                  />
                </button>
              )}
            </WithId>
          ));
          const first = section.rows[0]?.row.id;
          return section.heading === undefined ? (
            <Fragment key={first}>{options}</Fragment>
          ) : (
            // biome-ignore lint/a11y/useSemanticElements: a listbox's section is a group of options, which a <fieldset> of form controls is not.
            <div key={first} role="group" aria-label={section.heading}>
              <div className="menu-heading" aria-hidden="true">
                {section.heading}
              </div>
              {options}
            </div>
          );
        })}
        {props.note}
        {matches.length === 0 && props.note === undefined ? (
          <p className="task-compose-menu-note">{props.noMatch}</p>
        ) : null}
      </div>
      {footed ? (
        <div id={footId} className="task-compose-menu-foot">
          {foot.map((row, index) => (
            <WithId key={row.id}>
              {(id) => {
                // What every pinned row's button shares; a switch row adds its role on top.
                const shared = {
                  id,
                  type: "button",
                  tabIndex: -1,
                  className: "menu-item",
                  "aria-disabled": row.disabled === undefined ? undefined : "true",
                  "data-highlighted": index === footAt ? "true" : undefined,
                  onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
                  onMouseMove: () => {
                    if (row.disabled !== undefined) return;
                    if (index === footAt && (open !== undefined || row.submenu === undefined))
                      return;
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
                        row.submenu === undefined
                          ? undefined
                          : index === footAt && open !== undefined
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
                      <RowGlyph icon={row.icon} />
                      <span className="task-compose-menu-name">{row.label}</span>
                      <Switch checked={row.toggle.on} className="task-compose-menu-switch" />
                    </button>
                  );
                return (
                  <div className="task-compose-menu-branch">
                    {row.disabled === undefined ? (
                      button
                    ) : (
                      <Tooltip label={row.disabled}>{button}</Tooltip>
                    )}
                    {index === footAt && open !== undefined ? (
                      <div
                        ref={panel}
                        id={submenuId}
                        className="menu-surface task-compose-submenu"
                        role="listbox"
                        aria-label={open.label}
                        data-side={place.side}
                        data-stand={place.stand}
                        onMouseDown={(event) => event.preventDefault()}
                      >
                        {open.rows.map((sub, subIndex) => (
                          <WithId key={sub.id}>
                            {(subId) => (
                              <button
                                id={subId}
                                type="button"
                                role="option"
                                tabIndex={-1}
                                className="menu-item"
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
                            )}
                          </WithId>
                        ))}
                        {open.note === undefined ? null : (
                          <p className="task-compose-menu-foot-note" data-submenu-note="">
                            {open.note}
                          </p>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              }}
            </WithId>
          ))}
          {props.footNote === undefined ? null : (
            <p className="task-compose-menu-foot-note" data-foot-note="">
              {props.footNote}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
