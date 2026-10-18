import { APP_SHORTCUTS, type KeyedCommand } from "@luke/settings/shortcuts";
import {
  type ComboboxGroup,
  ComboboxList,
  type ComboboxOption,
  comboboxOptionId,
  LIST_DENSITY,
  List,
  ListRow,
  MENU_ITEM_MARK,
  MenuItem,
  SEARCH_FIELD_LOOK,
  SearchField,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  useComboboxField,
} from "@luke/ui";
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Shortcut } from "./shortcut";
import { Tooltip } from "./tooltip";

/**
 * searchable-menu.tsx -- the one picker menu the repository chip, the Start button, and the side panel's "+" drop, and Settings' menus may.
 *
 * A command menu: a search field as the first row, focused as the menu
 * opens and filtering as it is typed in; under it the rows, each an icon,
 * a name, a muted detail where the row has one, the shortcut that does the
 * same where there is one, and an end slot the check stands in where it is
 * the one chosen; a name or a detail cut short by the menu's width ends
 * in an ellipsis, in a list that scrolls past a bounded height, the rows
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
 * `aria-activedescendant`, each row holding an id of its place. The keys
 * are `@luke/ui`'s `useComboboxField`, the one `Combobox` reads, so keys an
 * input method is composing with move and pick nothing here either; the
 * field is its `SearchField`, the lists its `ComboboxList`, and the pinned
 * rows its `MenuItem`s, steered from the field. A
 * list too short to search is drawn with no field, the list itself
 * holding focus, naming the highlight, and reading the same keys. An owner
 * that answers a search itself, such as one a service answers as the typing
 * rests, hears each query as it is typed and hands the rows that answer it,
 * which the menu lists as they come rather than filtering them. The owner says
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
  icon?: React.JSX.Element;
  /** Muted words at the row's end, before a submenu's chevron: the effort chosen now. */
  detail?: string | undefined;
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

/** What a row prints at its end: why it cannot be picked now, its shortcut, or nothing. */
function rowHint(row: MenuRow): React.ReactNode {
  if (row.disabled !== undefined) return row.disabled;
  if (row.command === undefined) return undefined;
  return <Shortcut chord={APP_SHORTCUTS[row.command].chord} />;
}

/**
 * The matching rows as the list's options, a run under each heading. A
 * menu with a row chosen keeps every row's check room, so their hints end
 * in one line; one with none chosen keeps none.
 */
function optionGroups(rows: readonly MenuRow[], value: string | undefined): ComboboxGroup[] {
  return sectionsOf(rows).map((section) => ({
    label: section.heading,
    options: section.rows.map(({ row }) => ({
      id: row.id,
      label: row.label,
      icon: row.icon,
      detail: row.detail,
      hint: rowHint(row),
      disabled: row.disabled !== undefined,
      current: value === undefined ? undefined : row.id === value,
    })),
  }));
}

/** A submenu's rows as its list's options, the chosen one checked. */
function submenuOptions(open: Submenu): ComboboxOption[] {
  return open.rows.map((row) => ({
    id: row.id,
    label: row.label,
    icon: row.icon,
    detail: row.detail,
    current: row.id === open.value,
  }));
}

/** One muted line pressed by nothing, under the pinned rows or a submenu's. */
function FootNote({ words }: { words: string }): React.JSX.Element {
  return (
    <div className="task-compose-menu-foot-note">
      <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE}>
        {words}
      </Text>
    </div>
  );
}

/**
 * A menu's rows drawn in place rather than dropped: each a row of its own
 * in the page's order, under its section's heading as the menu heads it,
 * with no search and no highlight of its own, as the side panel's well
 * offers what its "+" offers with every tab closed.
 */
export function MenuRowList({
  label,
  rows,
  onPick,
}: {
  /** What the rows are, for assistive technology, where they stand under no heading. */
  label: string;
  rows: readonly MenuRow[];
  onPick: (id: string) => void;
}): React.JSX.Element {
  return (
    <>
      {sectionsOf(rows).map((section) => {
        const first = section.rows[0]?.row.id;
        return (
          <Fragment key={first}>
            {section.heading === undefined ? null : (
              <div className="menu-row-list-heading" aria-hidden="true">
                <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE}>
                  {section.heading}
                </Text>
              </div>
            )}
            <List label={section.heading ?? label} density={LIST_DENSITY.DENSE}>
              {section.rows.map(({ row }) => (
                <ListRow
                  key={row.id}
                  leading={row.icon}
                  title={row.label}
                  description={row.detail}
                  meta={rowHint(row)}
                  disabled={row.disabled !== undefined}
                  onPress={() => onPick(row.id)}
                />
              ))}
            </List>
          </Fragment>
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
  /** Present, the owner answers the search: it hears each query as typed, and the rows it hands are listed as they are, unfiltered. */
  onSearch?: ((query: string) => void) | undefined;
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
  // Note that rows an owner searched for are its answer to the query already, so the menu filters nothing.
  const answered = props.onSearch !== undefined;
  const matches = answered ? rows : matchingRows(rows, query);
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
  const searching = props.placeholder !== undefined;

  // The field takes focus as the menu opens, and keeps it; with no field, the
  // list does. A menu opened again while it was leaving takes it back too.
  useEffect(() => {
    if (!leaving) (field.current ?? list.current)?.focus();
  }, [leaving]);

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

  // What the field controls, as the space-separated list of ids ARIA reads:
  // the list, the pinned rows, and a submenu while one is open, so every row
  // it may name stands in a popup it controls.
  const footed = foot.length > 0 || props.footNote !== undefined;
  const controlled = [
    listId,
    ...(footed ? [footId] : []),
    ...(open === undefined ? [] : [submenuId]),
  ];
  // Every row's id is its place: an option's in the list, a pinned row's
  // under it, an option's in the open submenu.
  const optionId = (index: number) => comboboxOptionId(listId, index);
  const footRowId = (index: number) => `${footId}-row-${index}`;
  const subOptionId = (index: number) => comboboxOptionId(submenuId, index);
  // Note that the field, or the list where there is none, names the
  // highlighted row, because focus stays there and a reader would otherwise
  // hear nothing as the arrows move. The field may name a submenu or a
  // pinned row, since it controls those too; the list names only its own
  // options, which are all it holds.
  const listActive = at >= 0 && at < matches.length ? optionId(at) : undefined;
  const footActive = footAt >= 0 && footAt < foot.length ? footRowId(footAt) : undefined;
  const subActive = open !== undefined && subAt >= 0 ? subOptionId(subAt) : undefined;

  // What Enter picks: the highlighted row of an open submenu, else the
  // highlighted match where it may be picked, else the pinned row's press.
  const pick = (index: number) => {
    if (open !== undefined) {
      const row = open.rows[index];
      if (row !== undefined) open.onPick(row.id);
      return;
    }
    const row = index >= 0 ? matches[index] : undefined;
    const pinned = index >= matches.length ? foot[index - matches.length] : undefined;
    if (row !== undefined) {
      if (row.disabled === undefined) onPick(row.id);
    } else if (pinned !== undefined) pressFoot(pinned);
  };
  const steered = open === undefined ? at : subAt;
  // The list always stands, so the keys always steer it: the submenu's rows
  // while one is open, else the matches and on through the pinned rows, a
  // row that cannot be picked passed over and never a dead stop. An Enter
  // held with Command picks as a bare one does.
  const keys = useComboboxField({
    open: true,
    active: steered,
    count: open === undefined ? matches.length + foot.length : open.rows.length,
    skipped: open === undefined ? blocked : undefined,
    controls: controlled.join(" "),
    activeId: subActive ?? listActive ?? footActive,
    onActiveChange: (index) => {
      (field.current ?? list.current)?.focus();
      if (open === undefined) setHighlight(index);
      else setSubmenu({ moved: index });
    },
    onChoose: pick,
    onEnter: () => pick(steered),
    onEscape: () => {
      if (open !== undefined) setSubmenu(undefined);
      else props.onClose();
    },
    onKey: (event) => {
      if (event.key === "ArrowLeft" && open !== undefined) {
        event.preventDefault();
        setSubmenu(undefined);
      } else if (event.key === "ArrowRight" && branch !== undefined && open === undefined) {
        event.preventDefault();
        openSubmenu();
      }
    },
  });
  // Enter on a control of the note or the foot is that control's own press,
  // and every other key heard there steers the rows as the field's would;
  // the field and the list hear their own keys.
  const onKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target === field.current || event.target === list.current) return;
    if (event.key === "Enter") return;
    keys.onKeyDown(event);
  };

  // The pointer over a pinned row highlights it, and opens its submenu, or
  // closes the one standing beside another row.
  const hoverFoot = (row: FootRow, index: number) => {
    if (index === footAt && (open !== undefined || row.submenu === undefined)) return;
    setHighlight(matches.length + index);
    if (row.submenu === undefined) setSubmenu(undefined);
    else openSubmenu();
  };

  const root =
    props.className === undefined
      ? "menu-surface searchable-menu"
      : `menu-surface searchable-menu ${props.className}`;
  return (
    <div
      ref={props.ref}
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
        <SearchField
          ref={field}
          look={SEARCH_FIELD_LOOK.MENU}
          label={props.placeholder ?? props.label}
          placeholder={props.placeholder}
          value={query}
          combobox={keys}
          onChange={(typed) => {
            setQuery(typed);
            props.onSearch?.(typed);
            // The first match that may be picked takes the highlight; with
            // none, nothing does, so Enter picks nothing. The owner's own
            // answer is not in yet, so its first row takes it as it comes.
            const first = answered ? NOWHERE : firstOpen(matchingRows(rows, typed));
            moveTo(first === NOWHERE ? undefined : first);
          }}
        />
      ) : null}
      <ComboboxList
        ref={list}
        id={listId}
        label={props.label}
        groups={optionGroups(matches, value)}
        active={at}
        onActiveChange={moveTo}
        onChoose={(_index, option) => onPick(option.id)}
        steer={searching ? undefined : keys}
        note={props.note}
        empty={props.note === undefined ? props.noMatch : undefined}
      />
      {footed ? (
        <div id={footId} className="task-compose-menu-foot">
          {foot.map((row, index) => {
            const item = (
              <MenuItem
                action={{
                  label: row.label,
                  ...(row.icon === undefined ? undefined : { icon: row.icon }),
                  hint: row.detail,
                  onSelect: () => pressFoot(row),
                  disabled: row.disabled !== undefined,
                  checked: row.toggle?.on,
                  mark: row.toggle === undefined ? undefined : MENU_ITEM_MARK.SWITCH,
                  opens: row.submenu !== undefined,
                }}
                steered={{
                  id: footRowId(index),
                  highlighted: index === footAt,
                  expanded: index === footAt && open !== undefined,
                  onHover: () => hoverFoot(row, index),
                }}
                onChoose={() => pressFoot(row)}
              />
            );
            const branch = (
              <div className="task-compose-menu-branch">
                {item}
                {index === footAt && open !== undefined ? (
                  // Note that a press anywhere on the submenu, its note too, keeps the focus in the field.
                  // biome-ignore lint/a11y/noStaticElementInteractions: the press is its options'; the box only keeps the focus where it is.
                  <div
                    ref={panel}
                    className="menu-surface task-compose-submenu"
                    data-side={place.side}
                    data-stand={place.stand}
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    <ComboboxList
                      id={submenuId}
                      label={open.label}
                      groups={[{ options: submenuOptions(open) }]}
                      active={subAt}
                      onActiveChange={(moved) => setSubmenu({ moved })}
                      onChoose={(_index, option) => open.onPick(option.id)}
                    />
                    {open.note === undefined ? null : <FootNote words={open.note} />}
                  </div>
                ) : null}
              </div>
            );
            // A row that cannot be pressed says why on hover, from around it,
            // since the item takes no handlers but its own.
            return row.disabled === undefined ? (
              <Fragment key={row.id}>{branch}</Fragment>
            ) : (
              <Tooltip key={row.id} label={row.disabled}>
                {branch}
              </Tooltip>
            );
          })}
          {props.footNote === undefined ? null : <FootNote words={props.footNote} />}
        </div>
      ) : null}
    </div>
  );
}
