import { APP_SHORTCUTS, type KeyedCommand } from "@luke/settings/shortcuts";
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cssCustomProperties } from "../../css.js";
import { type SearchSubject, searchHit } from "../../search-score.js";
import { searchTokens } from "../../search-tokens.js";
import {
  AnchoredPopover,
  POPOVER_BOUNDS,
  POPOVER_WIDTH,
  type PopoverAlign,
  type PopoverBounds,
  type PopoverWidth,
  roomAround,
} from "../anchored-popover/anchored-popover.js";
import { clipsAround } from "../anchored-popover/clip-room.js";
import {
  type ComboboxGroup,
  ComboboxList,
  type ComboboxOption,
  comboboxOptionId,
} from "../combobox/combobox.js";
import { useComboboxField } from "../combobox/use-combobox-field.js";
import { LIST_DENSITY, List, ListRow } from "../list-row/list-row.js";
import { MENU_ITEM_MARK, MenuItem } from "../menu/menu.js";
import { inNarrowRoom, MenuSheetFrame } from "../menu/menu-sheet.js";
import { MENU_SURFACE_INSET, MenuSurface } from "../menu/menu-surface.js";
import { SEARCH_FIELD_LOOK, SearchField } from "../search-field/search-field.js";
import { SearchMatch } from "../search-match/search-match.js";
import { Shortcut } from "../shortcut/shortcut.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { RowHint, RowHintOptions, Tooltip } from "../tooltip/hint.js";

/**
 * searchable-menu.tsx -- the one picker menu: a search over rows, hung from the button that opened it, at one of three widths.
 *
 * A command menu: a search field as the first row, focused as the menu
 * opens and filtering as it is typed in; under it the rows, each an icon,
 * a name, a muted detail where the row has one, the shortcut that does the
 * same where there is one, the row's own end marks after that, such as a
 * teammate's face and a failed agent's mark, and an end slot the check
 * stands in where it is the one chosen; a name or a detail cut short by
 * the menu's width fades where it is cut, in a list that scrolls past a
 * bounded height, the rows of a section under its heading, a row that
 * opens a submenu ending in a
 * chevron; and under the list, pinned where the scrolling cannot
 * take them, the rows the owner wants always on screen, such as the page
 * on GitHub or the effort an agent will run at. A pinned row is a press of
 * its own, a switch the press turns without closing anything, or opens a
 * submenu of rows beside itself, as a listed row may too (a new Browser
 * tab, and where it opens), anchored to the row and turned to the other
 * side where the window leaves no room; a search matches a listed row by
 * its submenu's rows as well. Focus
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
 * are `useComboboxField`, the one `Combobox` reads, so keys an
 * input method is composing with move and pick nothing here either; the
 * field is `SearchField`, the lists `ComboboxList`, and the pinned
 * rows `MenuItem`s, steered from the field. A
 * list too short to search is drawn with no field, the list itself
 * holding focus, naming the highlight, and reading the same keys. An owner
 * that answers a search itself, such as one a service answers as the typing
 * rests, hears each query as it is typed and hands the rows that answer it,
 * which the menu lists as they come rather than filtering them. The owner says
 * what to list, what to say in the list's place while there is nothing to
 * list (that the rows are being read, or could not be, with a Retry), and
 * what a pick does; the menu decides nothing about either.
 *
 * It hangs from its button in an `AnchoredPopover`, whose anchor is the box
 * holding the button and the menu, from the edge its owner names, at one of
 * three widths (`POPOVER_WIDTH`): narrow for a Settings picker, regular for
 * the composer's, and wide for one that lists an issue's title with its key
 * and state. An owner that already hangs a layer of its own, a picker
 * floated by a box in the words (`RectFloat`) say, asks for it embedded
 * (`SEARCHABLE_MENU_LAYER.EMBEDDED`) instead: drawn with no layer, inside
 * the owner's, which says where it stands and how wide. Its owner holds it
 * drawn through its exit (`useDisclosure`), handing it `leaving`, which
 * leaves it inert and fading, focus already handed back.
 *
 * In a phone's layout, the narrow room the document's root says it stands
 * in, a menu hung from its button rises instead as a sheet from the
 * window's foot over the dimmed window, in the frame an action menu's sheet
 * stands in (`MenuSheetFrame`), the room read as it opens as `Menu` reads
 * it. Its head holds the grip, the menu's name, and the field, which takes
 * no focus as the sheet opens, so no keyboard rises over the rows until it
 * is pressed: the list takes the focus and reads the keys, as a list too
 * short to search does, and the field reads them too once pressed. Its rows
 * are the menu's at a finger's height, scrolling under the head with the
 * pinned rows fixed under them, and a submenu, pinned or listed, stands in
 * the sheet's place with a way back (and Left) rather than beside its row,
 * which only a press opens there; a pick in it puts the sheet away before
 * it is handed on. A pick, Escape, from a submenu's page too, a press on
 * the dimmed window, or a swipe down asks the owner to close; and since
 * the sheet traps focus as any dialog does, a focus moving inside it,
 * outside its owner's box as the sheet is, is never told to the owner as
 * leaving.
 */

/** Whether the menu hangs from its button in a layer of its own, or stands in a layer its owner hangs. */
export const SEARCHABLE_MENU_LAYER = {
  ANCHORED: "anchored",
  EMBEDDED: "embedded",
} as const;

export type SearchableMenuLayer =
  (typeof SEARCHABLE_MENU_LAYER)[keyof typeof SEARCHABLE_MENU_LAYER];

/** Where the menu stands: hung from its button's edge at a width, or in its owner's layer, which places it. */
type SearchableMenuPlace =
  | {
      layer?: typeof SEARCHABLE_MENU_LAYER.ANCHORED | undefined;
      /** The button's edge the menu hangs from. */
      align: PopoverAlign;
      /** What it keeps within: its marked room unless its owner asks for the window. */
      bounds?: PopoverBounds | undefined;
      /** How wide it stands, the room allowing: regular where none is named. */
      width?: PopoverWidth | undefined;
    }
  | { layer: typeof SEARCHABLE_MENU_LAYER.EMBEDDED };

/** How a row that cannot be picked says why: in words at its end, or by its end marks alone, a status dot whose hint says the words. */
export const MENU_ROW_WHY = {
  WORDS: "words",
  MARK: "mark",
} as const;

export type MenuRowWhy = (typeof MENU_ROW_WHY)[keyof typeof MENU_ROW_WHY];

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
  /** Whether that why is printed, or said by the row's end marks alone, so a column of status dots keeps one edge; printed where none is said. */
  why?: MenuRowWhy | undefined;
  /** The row is listed only once something is searched: a model older than its family's newest. */
  searchOnly?: boolean | undefined;
  /** Rows the row opens beside itself rather than being picked, as a pinned row's submenu: where a new Browser tab opens. */
  submenu?: Submenu | undefined;
  /** The card hung beside the row while the pointer rests on it, as ⌘K hangs an agent's: an agent's own card. */
  card?: React.ReactNode;
  /** Marks at the row's end, after its shortcut, as ⌘K's rows end: a teammate's face, a failed agent's mark. */
  end?: React.ReactNode;
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
  /** A quiet mark right after the label, such as an experiment's Experimental tag. */
  tag?: React.ReactNode;
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

/** How a submenu stands against its row: down from the row's top, or up from its foot where its room's bottom would cut it. */
const SUBMENU_STAND = {
  DOWN: "down",
  UP: "up",
} as const;

type SubmenuStand = (typeof SUBMENU_STAND)[keyof typeof SUBMENU_STAND];

/** Where a submenu stands, measured as it opens. */
interface SubmenuPlace {
  side: SubmenuSide;
  /** How far it is pushed back over the menu, where neither side holds it whole. */
  shift: number;
  stand: SubmenuStand;
}

const SUBMENU_FIRST_PLACE: SubmenuPlace = {
  side: SUBMENU_SIDE.RIGHT,
  shift: 0,
  stand: SUBMENU_STAND.DOWN,
};

/** The row whose submenu a sheet shows in its place: pinned under the list or listed in it, by its id. */
interface SheetPage {
  readonly pinned: boolean;
  readonly id: string;
}

/** The gap a submenu keeps from its row's edge, which `SUBMENU`'s place (the theme's `submenu-reach`) draws. */
const SUBMENU_GAP = 9;

/**
 * Hung from its button, a menu is no taller than the room its side of the
 * button leaves (`--luke-popover-room`, measured against what is seen of the
 * window), so a phone's keyboard or a short window never hides its last
 * rows: its list gives way and scrolls, under the search row that stays.
 * Embedded in a layer floated by a box in the words, it keeps to the room
 * that layer's side leaves it the same way.
 */
const MENU =
  "luke-searchable-menu relative [.luke-anchored-popover>&]:max-h-popover-room [.luke-rect-float>&]:max-h-popover-room";

/** The rows pinned under the list, behind a hairline, where the scrolling cannot take them. */
const FOOT = "luke-searchable-menu-foot block flex-none border-t border-border p-menu-inset";

/**
 * One muted line under the pinned rows or a submenu's, inset as a row's
 * words are: what the agent has cost; one aligned starts where a row's label
 * does, past the row's glyph slot.
 */
const NOTE =
  "luke-searchable-menu-note px-row-inset pt-luke-4 pb-0 [.luke-searchable-menu-submenu>&]:pb-menu-inset data-[aligned=true]:pl-menu-label";

/** A section's heading over rows drawn in place, inset as a row's words are. */
const HEADING = "luke-searchable-menu-heading px-row-inset pt-luke-8 pb-luke-4";

/**
 * A submenu stands beside the row that opened it, its top level with that
 * row's and its near edge a gap off the menu's own; it turns to the menu's
 * other side where its room ends before it does, is pushed back over the
 * menu (`--luke-submenu-shift`) where neither side holds it, and stands up
 * from the row's foot where its room's bottom would cut it.
 */
const SUBMENU =
  "luke-searchable-menu-submenu absolute top-0 left-submenu-reach z-1 w-submenu data-[side=left]:right-submenu-reach data-[side=left]:left-auto data-[stand=up]:top-auto data-[stand=up]:bottom-0";

/** The row a submenu stands beside, which holds it. */
const BRANCH = "luke-searchable-menu-branch relative";

/**
 * A listed row's submenu stands beside the row as the list scrolled it (the
 * menu places the branch over the row), taking no pointer itself, so the
 * rows under it stay the pointer's.
 */
const ROW_BRANCH =
  "luke-searchable-menu-branch luke-searchable-menu-row-branch pointer-events-none absolute right-0 left-0 [&>*]:pointer-events-auto";

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

/** What a row is searched by: its name, and as keywords the words it is found by and never draws on its own. */
function rowSubject(row: MenuRow): SearchSubject {
  return {
    label: row.label,
    keywords: [
      ...(row.terms ?? []),
      ...(row.section === undefined ? [] : [row.section]),
      ...(row.submenu?.rows.map((each) => each.label) ?? []),
    ],
  };
}

/**
 * The matching rows, ranked as ⌘K ranks its own (`searchHit`): a name typed
 * whole or begun first, then words that start a word of it, then words
 * anywhere, then the row's terms, section, and submenu rows; equals keep the
 * owner's order, and a section's rows stay together under its one heading,
 * the sections in the order of their best row. For no query, every row not
 * kept for a search, as the owner ordered them.
 */
export function matchingRows<Row extends MenuRow>(
  rows: readonly Row[],
  query: string,
): readonly Row[] {
  if (searchTokens(query).length === 0) return rows.filter((row) => row.searchOnly !== true);
  const ranked = rows
    .flatMap((row) => {
      const hit = searchHit(rowSubject(row), query);
      return hit === undefined ? [] : [{ row, score: hit.score }];
    })
    .sort((a, b) => b.score - a.score);
  const bySection = new Map<string | undefined, Row[]>();
  for (const { row } of ranked) {
    const stood = bySection.get(row.section);
    if (stood === undefined) bySection.set(row.section, [row]);
    else stood.push(row);
  }
  return [...bySection.values()].flat();
}

/** A row's name with the stretches a search matched marked, or as it is where nothing is typed. */
function markedLabel(row: MenuRow, query: string): React.ReactNode {
  const ranges = searchHit(rowSubject(row), query)?.label ?? [];
  if (ranges.length === 0) return row.label;
  const parts: React.ReactNode[] = [];
  let from = 0;
  for (const range of ranges) {
    if (range.start > from) parts.push(row.label.slice(from, range.start));
    // Where the query's words landed, so the row says why it matched, as the settings search marks its own.
    parts.push(
      <SearchMatch key={range.start}>{row.label.slice(range.start, range.end)}</SearchMatch>,
    );
    from = range.end;
  }
  if (from < row.label.length) parts.push(row.label.slice(from));
  return parts;
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

/** What a row prints at its end: why it cannot be picked now, unless its marks say it, or its shortcut, then its own marks; or nothing. */
function rowHint(row: MenuRow): React.ReactNode {
  const why = row.why === MENU_ROW_WHY.MARK ? undefined : row.disabled;
  const said =
    why ??
    (row.command === undefined ? undefined : <Shortcut chord={APP_SHORTCUTS[row.command].chord} />);
  if (row.end === undefined || row.end === null) return said;
  return (
    <>
      {said}
      {row.end}
    </>
  );
}

/**
 * The matching rows as the list's options, a run under each heading, the
 * one chosen checked; the rest keep no check room, so their hints end at the
 * row's edge.
 */
function optionGroups(
  rows: readonly MenuRow[],
  value: string | undefined,
  query: string,
): ComboboxGroup[] {
  return sectionsOf(rows).map((section) => ({
    label: section.heading,
    options: section.rows.map(({ row }) => ({
      id: row.id,
      label: markedLabel(row, query),
      words: row.label,
      icon: row.icon,
      detail: row.detail,
      hint: rowHint(row),
      disabled: row.disabled !== undefined,
      opens: row.submenu !== undefined,
      current: value === undefined ? undefined : row.id === value,
      card: row.card,
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
    hint: rowHint(row),
    card: row.card,
    current: row.id === open.value,
  }));
}

/** One muted line pressed by nothing, under the pinned rows or a submenu's. */
function FootNote({
  words,
  aligned = false,
}: {
  words: React.ReactNode;
  /** Whether the words start where a row's label does, past its glyph slot. */
  aligned?: boolean;
}): React.JSX.Element {
  return (
    <div className={NOTE} data-aligned={aligned || undefined}>
      <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {words}
      </Text>
    </div>
  );
}

/** One row of a list drawn in place: its glyph, name, detail and end marks, the card it hangs beside it where it has one. */
function PlacedRow({
  row,
  title,
  description,
  disabled,
  onPress,
}: {
  row: MenuRow;
  title: string;
  description: React.ReactNode;
  disabled: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <RowHintOptions card={row.card}>
      <ListRow
        leading={row.icon}
        title={title}
        description={description}
        meta={rowHint(row)}
        hint={row.card === undefined ? undefined : { Hint: RowHint, label: title }}
        disabled={disabled}
        onPress={onPress}
      />
    </RowHintOptions>
  );
}

/** A row's submenu drawn in place, with nowhere to open beside it: a row of each choice, named by the row and the choice after it, each wearing the choice's own end marks and card. */
function submenuRows(row: MenuRow, submenu: Submenu): React.JSX.Element[] {
  return submenu.rows.map((choice) => (
    <PlacedRow
      key={choice.id}
      row={choice}
      title={row.label}
      description={choice.label}
      disabled={row.disabled !== undefined}
      onPress={() => submenu.onPick(choice.id)}
    />
  ));
}

/**
 * A menu's rows drawn in place rather than dropped: each a row of its own
 * in the page's order, under its section's heading as the menu heads it,
 * with no search and no highlight of its own, as the side panel's well
 * offers what its "+" offers with every tab closed. A row that opens a
 * submenu stands as a row of each of its choices instead. A row wears its
 * end marks and hangs its card beside it, as the dropped menu's rows do.
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
              <div className={HEADING} aria-hidden="true">
                <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.GROUP}>
                  {section.heading}
                </Text>
              </div>
            )}
            <List label={section.heading ?? label} density={LIST_DENSITY.DENSE}>
              {section.rows.flatMap(({ row }) =>
                row.submenu === undefined
                  ? [
                      <PlacedRow
                        key={row.id}
                        row={row}
                        title={row.label}
                        description={row.detail}
                        disabled={row.disabled !== undefined}
                        onPress={() => onPick(row.id)}
                      />,
                    ]
                  : submenuRows(row, row.submenu),
              )}
            </List>
          </Fragment>
        );
      })}
    </>
  );
}

export function SearchableMenu(
  props: {
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
    /** One muted line under that, which may hold a link: the plan that pays, as its provider asks. */
    planNote?: React.ReactNode;
    /** The menu is on its way out: drawn fading, and taking nothing. */
    leaving?: boolean | undefined;
    /** Hands the menu's element to the hold its owner draws it through its exit with. */
    ref?: ((element: HTMLElement | null) => void) | undefined;
  } & SearchableMenuPlace,
): React.JSX.Element {
  const { rows, value, onPick } = props;
  const leaving = props.leaving === true;
  // Note that the room is read as the menu opens, so one standing open never turns into the other as the window is resized.
  const sheeted = () => props.layer !== SEARCHABLE_MENU_LAYER.EMBEDDED && inNarrowRoom();
  const [sheet, setSheet] = useState(sheeted);
  const [query, setQuery] = useState("");
  // Note that rows an owner searched for are its answer to the query already, so the menu filters nothing.
  const answered = props.onSearch !== undefined;
  const matches = answered ? rows : matchingRows(rows, query);
  const foot = props.foot ?? [];
  // Until the arrows or the pointer move it, the highlight follows the chosen
  // row, which may arrive after the menu opened, so Enter keeps what stands.
  // The row moved to is held by its id as well as its place, so rows an
  // owner hands anew, such as a search answering after the arrows moved,
  // keep the highlight on that row rather than on whatever took its place.
  const [highlight, setHighlightAt] = useState<{ index: number; id: string | undefined }>();
  const setHighlight = (index: number | undefined) =>
    setHighlightAt(index === undefined ? undefined : { index, id: matches[index]?.id });
  const movedRow =
    highlight?.id === undefined ? -1 : matches.findIndex((row) => row.id === highlight.id);
  const chosen = matches.findIndex((row) => row.id === value);
  // A row that cannot be picked takes no highlight, from the arrows or from a moment ago.
  const blocked = (index: number) =>
    (matches[index] ?? foot[index - matches.length])?.disabled !== undefined;
  const at = highlightOver({
    moved: movedRow >= 0 ? movedRow : highlight?.index,
    chosen,
    first: firstOpen(matches),
    count: matches.length + foot.length,
    blocked,
  });
  const footAt = at - matches.length;
  const branch = footAt >= 0 ? foot[footAt]?.submenu : matches[at]?.submenu;
  // The submenu open beside the highlighted row, listed or pinned, and the highlight inside it.
  const [submenu, setSubmenu] = useState<{ moved: number | undefined } | undefined>(undefined);
  const [place, setPlace] = useState<SubmenuPlace>(SUBMENU_FIRST_PLACE);
  // In a sheet the submenu stands in the sheet's place, held by its row's id, so rows handed anew keep it standing.
  const [page, setPage] = useState<SheetPage | undefined>(undefined);
  // Opened again while it was leaving, the menu starts afresh, as one opened anew does.
  const [wasLeaving, setWasLeaving] = useState(leaving);
  if (wasLeaving !== leaving) {
    setWasLeaving(leaving);
    if (!leaving) {
      setQuery("");
      setHighlightAt(undefined);
      setSubmenu(undefined);
      setPage(undefined);
      setSheet(sheeted());
    }
  }
  const paged =
    page === undefined
      ? undefined
      : (page.pinned ? foot : rows).find((row) => row.id === page.id)?.submenu;
  const open = sheet ? paged : branch !== undefined && submenu !== undefined ? branch : undefined;
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
  const surface = useRef<HTMLElement | null>(null);
  const searching = props.placeholder !== undefined;
  const ownerRef = props.ref;
  // The menu's element, held here to place a listed row's submenu, and handed on to its owner's hold.
  const holdSurface = useCallback(
    (element: HTMLElement | null) => {
      surface.current = element;
      ownerRef?.(element);
    },
    [ownerRef],
  );
  // Where a listed row that opened a submenu stands in the menu, which its submenu stands beside.
  const [rowBox, setRowBox] = useState<{ top: number; height: number } | undefined>(undefined);

  // The field takes focus as the menu opens, and keeps it; with no field, the
  // list does. A menu opened again while it was leaving takes it back too.
  // A sheet's list takes it instead, as its dialog lands it, and again each
  // time a submenu comes to stand in the sheet's place or goes, the list
  // then standing being that page's.
  useEffect(() => {
    if (leaving) return;
    if (sheet) list.current?.focus({ preventScroll: true });
    else (field.current ?? list.current)?.focus();
  }, [leaving, sheet, page]);

  // A submenu opens to the right and down from its row, turns to the left
  // where the room ends before it does (the window, or the box its menu
  // keeps to, `data-popover-room`, the side panel or an agent's pane, unless
  // its owner bounds it by the window alone, as its popover is, either cut
  // to each box that clips it, a card that scrolls say), and where neither
  // side holds it, takes the one it runs past less, pushed back over the
  // menu so it never runs past a column; it stands up where the room's
  // bottom would cut it. Measured before it is painted, and
  // again as the pointer moves it to another row, whose submenu may stand taller.
  const openAt = sheet || open === undefined ? undefined : at;
  const listedAt = !sheet && open !== undefined && footAt < 0 ? at : undefined;
  // A listed row's submenu stands beside the row as the list has it scrolled now, read before it is painted.
  useLayoutEffect(() => {
    if (listedAt === undefined) return setRowBox(undefined);
    const row = document
      .getElementById(comboboxOptionId(listId, listedAt))
      ?.getBoundingClientRect();
    const menu = surface.current?.getBoundingClientRect();
    if (row === undefined || menu === undefined) return setRowBox(undefined);
    setRowBox({ top: row.top - menu.top, height: row.height });
  }, [listedAt, listId]);
  const keepsToWindow =
    props.layer !== SEARCHABLE_MENU_LAYER.EMBEDDED && props.bounds === POPOVER_BOUNDS.WINDOW;
  useLayoutEffect(() => {
    const branch = panel.current?.parentElement;
    if (openAt === undefined || panel.current === null || branch == null) return;
    const bounds = panel.current.getBoundingClientRect();
    const row = branch.getBoundingClientRect();
    const room = roomAround(
      panel.current,
      keepsToWindow ? POPOVER_BOUNDS.WINDOW : POPOVER_BOUNDS.ROOM,
      clipsAround(panel.current),
    );
    const pastRight = Math.max(row.right + SUBMENU_GAP + bounds.width - room.right, 0);
    const pastLeft = Math.max(room.left - (row.left - SUBMENU_GAP - bounds.width), 0);
    const side =
      pastRight === 0 || (pastLeft > 0 && pastRight <= pastLeft)
        ? SUBMENU_SIDE.RIGHT
        : SUBMENU_SIDE.LEFT;
    setPlace({
      side,
      shift: side === SUBMENU_SIDE.RIGHT ? pastRight : pastLeft,
      stand: bounds.bottom > room.bottom ? SUBMENU_STAND.UP : SUBMENU_STAND.DOWN,
    });
  }, [openAt, rowBox, keepsToWindow]);

  const moveTo = (index: number | undefined) => {
    setHighlight(index);
    setSubmenu(undefined);
  };
  /** The submenu of the row at `index`, listed or pinned, opened beside it, or in a sheet's place. */
  const openSubmenu = (index: number) => {
    setPlace(SUBMENU_FIRST_PLACE);
    setSubmenu({ moved: undefined });
    const pinned = index >= matches.length;
    const row = pinned ? foot[index - matches.length] : matches[index];
    if (sheet && row !== undefined) setPage({ pinned, id: row.id });
  };
  const closeSubmenu = () => {
    setSubmenu(undefined);
    setPage(undefined);
  };
  /** A listed row chosen: its submenu opened beside it where it has one, else it is picked. */
  const chooseRow = (row: MenuRow, index: number) => {
    if (row.disabled !== undefined) return;
    if (row.submenu === undefined) return onPick(row.id);
    setHighlight(index);
    openSubmenu(index);
  };
  const pressFoot = (row: FootRow, index: number) => {
    if (row.disabled !== undefined) return;
    if (row.submenu !== undefined) {
      setHighlight(matches.length + index);
      openSubmenu(matches.length + index);
    } else if (row.toggle !== undefined) row.toggle.onToggle();
    else row.onPress?.();
  };
  // Note that a sheet is put away before a submenu's pick is handed on, as
  // an action menu's sheet is, focus already back on its trigger, because
  // an owner whose pick opens what takes the focus, as a new Browser tab
  // does, never hears it leave a sheet that traps it.
  const pickIn = (shown: Submenu, id: string) => {
    if (sheet) props.onClose();
    shown.onPick(id);
  };

  // What the field controls, as the space-separated list of ids ARIA reads:
  // the list, the pinned rows, and a submenu while one is open, so every row
  // it may name stands in a popup it controls.
  const footed = foot.length > 0 || props.footNote !== undefined || props.planNote !== undefined;
  const controlled =
    sheet && open !== undefined
      ? [submenuId]
      : [listId, ...(footed ? [footId] : []), ...(open === undefined ? [] : [submenuId])];
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
      if (row !== undefined) pickIn(open, row.id);
      return;
    }
    const row = index >= 0 ? matches[index] : undefined;
    const pinned = index >= matches.length ? foot[index - matches.length] : undefined;
    if (row !== undefined) chooseRow(row, index);
    else if (pinned !== undefined) pressFoot(pinned, index - matches.length);
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
      // A sheet's keys stay in its list, or in its field once that is pressed, so a key never raises the keyboard.
      if (!sheet) (field.current ?? list.current)?.focus();
      else if (document.activeElement !== field.current)
        list.current?.focus({ preventScroll: true });
      if (open === undefined) setHighlight(index);
      else setSubmenu({ moved: index });
    },
    onChoose: pick,
    onEnter: () => pick(steered),
    // Note that a sheet's Escape puts it away from a submenu's page too, as
    // an action menu's sheet does, Left being its way back.
    onEscape: () => {
      if (open !== undefined && !sheet) closeSubmenu();
      else props.onClose();
    },
    onKey: (event) => {
      if (event.key === "ArrowLeft" && open !== undefined) {
        event.preventDefault();
        closeSubmenu();
      } else if (event.key === "ArrowRight" && branch !== undefined && open === undefined) {
        event.preventDefault();
        openSubmenu(at);
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

  // The pointer over a listed row highlights it, and opens its submenu where
  // it has one, or closes the one standing beside another row. Note that in
  // a sheet it only highlights, because a submenu there stands in the
  // sheet's place, which a press alone opens.
  const hoverRow = (index: number) => {
    if (index === at && open !== undefined) return;
    if (sheet || matches[index]?.submenu === undefined) return moveTo(index);
    setHighlight(index);
    openSubmenu(index);
  };

  // The pointer over a pinned row highlights it, and opens its submenu, or
  // closes the one standing beside another row; in a sheet, it highlights.
  const hoverFoot = (row: FootRow, index: number) => {
    if (index === footAt && (sheet || open !== undefined || row.submenu === undefined)) return;
    setHighlight(matches.length + index);
    if (sheet || row.submenu === undefined) setSubmenu(undefined);
    else openSubmenu(matches.length + index);
  };

  // A submenu's rows and its note, beside its row, or in a sheet's place,
  // where its list holds the focus and reads the keys as the menu's did.
  const submenuBody = (shown: Submenu) => (
    <>
      <ComboboxList
        ref={sheet ? list : undefined}
        id={submenuId}
        label={shown.label}
        groups={[{ options: submenuOptions(shown) }]}
        active={subAt}
        onActiveChange={(moved) => setSubmenu({ moved })}
        onChoose={(_index, option) => pickIn(shown, option.id)}
        steer={sheet ? keys : undefined}
      />
      {shown.note === undefined ? null : <FootNote words={shown.note} />}
    </>
  );

  // Note that a press anywhere on the submenu, its note too, keeps the focus in the field.
  const submenuSurface = (shown: Submenu) => (
    <MenuSurface
      ref={panel}
      className={SUBMENU}
      inset={MENU_SURFACE_INSET.NONE}
      data-side={place.side}
      data-stand={place.stand}
      style={cssCustomProperties({ "--luke-submenu-shift": `${place.shift}px` })}
      onMouseDown={(event) => event.preventDefault()}
    >
      {submenuBody(shown)}
    </MenuSurface>
  );

  // A sheet's field is a well of its own in the sheet's head, and a hung menu's its head row.
  const searchField = searching ? (
    <SearchField
      ref={field}
      look={sheet ? SEARCH_FIELD_LOOK.WELL : SEARCH_FIELD_LOOK.MENU}
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
  ) : null;

  const rowList = (
    <ComboboxList
      ref={list}
      id={listId}
      label={props.label}
      groups={optionGroups(matches, value, answered ? "" : query)}
      active={at}
      onActiveChange={hoverRow}
      onChoose={(index) => {
        const row = matches[index];
        if (row !== undefined) chooseRow(row, index);
      }}
      steer={searching && !sheet ? undefined : keys}
      note={props.note}
      empty={props.note === undefined ? props.noMatch : undefined}
    />
  );

  // The submenu standing beside its row, which a sheet never draws there.
  const beside = sheet ? undefined : open;
  const footRows = footed ? (
    <div id={footId} className={FOOT}>
      {foot.map((row, index) => {
        const item = (
          <MenuItem
            action={{
              label: row.label,
              ...(row.icon === undefined ? undefined : { icon: row.icon }),
              tag: row.tag,
              hint: row.detail,
              onSelect: () => pressFoot(row, index),
              disabled: row.disabled !== undefined,
              checked: row.toggle?.on,
              mark: row.toggle === undefined ? undefined : MENU_ITEM_MARK.SWITCH,
              opens: row.submenu !== undefined,
            }}
            steered={{
              id: footRowId(index),
              highlighted: index === footAt,
              expanded: index === footAt && beside !== undefined,
              onHover: () => hoverFoot(row, index),
            }}
            onChoose={() => pressFoot(row, index)}
          />
        );
        const branch = (
          <div className={BRANCH}>
            {item}
            {index === footAt && beside !== undefined ? submenuSurface(beside) : null}
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
      {props.planNote === undefined ? null : <FootNote words={props.planNote} aligned />}
    </div>
  ) : null;

  // Note that the sheet hears no blur for its owner's `onLeave`, because its
  // dialog stands outside the owner's box, so every focus moving inside it
  // would read as leaving; it traps the focus, and is put away by `onClose`.
  if (sheet) {
    return (
      <MenuSheetFrame
        id={props.id}
        open={!leaving}
        initialFocus={list}
        hold={ownerRef}
        name={open?.label ?? props.label}
        detail={open === undefined ? undefined : props.label}
        back={open === undefined ? undefined : { label: props.label, onBack: closeSubmenu }}
        field={open === undefined ? searchField : undefined}
        onAway={props.onClose}
        onKeyDown={onKey}
      >
        {open === undefined ? (
          <>
            {rowList}
            {footRows}
          </>
        ) : (
          submenuBody(open)
        )}
      </MenuSheetFrame>
    );
  }

  const menu = (
    <MenuSurface
      ref={holdSurface}
      id={props.id}
      className={MENU}
      inset={MENU_SURFACE_INSET.NONE}
      role="dialog"
      aria-label={props.label}
      leaving={leaving}
      onKeyDown={onKey}
      onBlur={(event) => props.onLeave(event.relatedTarget)}
    >
      {searchField}
      {rowList}
      {open === undefined || footAt >= 0 || rowBox === undefined ? null : (
        <div className={ROW_BRANCH} style={{ top: rowBox.top, height: rowBox.height }}>
          {submenuSurface(open)}
        </div>
      )}
      {footRows}
    </MenuSurface>
  );
  if (props.layer === SEARCHABLE_MENU_LAYER.EMBEDDED) return menu;
  return (
    <AnchoredPopover
      open={!leaving}
      align={props.align}
      bounds={props.bounds}
      width={props.width ?? POPOVER_WIDTH.REGULAR}
    >
      {menu}
    </AnchoredPopover>
  );
}
