import { APP_SHORTCUTS, type KeyedCommand } from "@repo/settings/shortcuts";
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cssCustomProperties } from "../../css.js";
import { type SearchSubject, searchHit } from "../../search-score.js";
import { searchTokens } from "../../search-tokens.js";
import { REPLAY_MASKED, ReplayWords } from "../../session-replay-marks.js";
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
import { BackButton, NO_BACK_KEY } from "../back-button/back-button.js";
import {
  COMBOBOX_LEAD,
  type ComboboxGroup,
  ComboboxList,
  type ComboboxOption,
  comboboxOptionId,
} from "../combobox/combobox.js";
import { useComboboxField } from "../combobox/use-combobox-field.js";
import { LIST_DENSITY, List, ListRow } from "../list-row/list-row.js";
import { MENU_ITEM_MARK, MenuItem } from "../menu/menu.js";
import { MenuReplayUnmasked } from "../menu/menu-replay.js";
import { inNarrowRoom, MenuSheetFrame, type SheetBack } from "../menu/menu-sheet.js";
import { MENU_SURFACE_INSET, MenuSurface } from "../menu/menu-surface.js";
import { useSubmenuAim } from "../menu/submenu-aim.js";
import { SEARCH_FIELD_LOOK, SearchField } from "../search-field/search-field.js";
import { SearchMatch } from "../search-match/search-match.js";
import { Shortcut } from "../shortcut/shortcut.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { RowHint, RowHintOptions, Tooltip } from "../tooltip/hint.js";

export const SEARCHABLE_MENU_LAYER = {
  ANCHORED: "anchored",
  EMBEDDED: "embedded",
} as const;

export type SearchableMenuLayer =
  (typeof SEARCHABLE_MENU_LAYER)[keyof typeof SEARCHABLE_MENU_LAYER];

type SearchableMenuPlace =
  | {
      layer?: typeof SEARCHABLE_MENU_LAYER.ANCHORED | undefined;
      align: PopoverAlign;
      bounds?: PopoverBounds | undefined;
      width?: PopoverWidth | undefined;
    }
  | { layer: typeof SEARCHABLE_MENU_LAYER.EMBEDDED };

export const MENU_ROW_WHY = {
  WORDS: "words",
  MARK: "mark",
} as const;

export type MenuRowWhy = (typeof MENU_ROW_WHY)[keyof typeof MENU_ROW_WHY];

export interface MenuRow {
  id: string;
  label: string;
  icon?: React.ReactNode;
  faces?: React.ReactNode;
  terms?: readonly string[];
  detail?: React.ReactNode;
  section?: string | undefined;
  command?: KeyedCommand | undefined;
  disabled?: string | undefined;
  why?: MenuRowWhy | undefined;
  searchOnly?: boolean | undefined;
  submenu?: Submenu | undefined;
  card?: React.ReactNode;
  end?: React.ReactNode;
  replayMasked?: boolean | undefined;
}

interface Section<Row extends MenuRow> {
  heading: string | undefined;
  rows: { row: Row; index: number }[];
}

interface Submenu {
  label: string;
  rows: readonly MenuRow[];
  value: string | undefined;
  onPick: (id: string) => void;
  note?: string | undefined;
  stays?: boolean | undefined;
}

export interface FootRow {
  id: string;
  label: string;
  icon?: React.JSX.Element;
  detail?: string | undefined;
  tag?: React.ReactNode;
  onPress?: () => void;
  submenu?: Submenu;
  toggle?: { on: boolean; onToggle: () => void };
  disabled?: string | undefined;
}

export interface MenuHead {
  words: string;
  back?: SheetBack | undefined;
}

export interface MenuLastLine {
  words: string;
  end?: React.ReactNode;
}

const SUBMENU_SIDE = {
  RIGHT: "right",
  LEFT: "left",
} as const;

type SubmenuSide = (typeof SUBMENU_SIDE)[keyof typeof SUBMENU_SIDE];

const SUBMENU_STAND = {
  DOWN: "down",
  UP: "up",
} as const;

type SubmenuStand = (typeof SUBMENU_STAND)[keyof typeof SUBMENU_STAND];

interface SubmenuPlace {
  side: SubmenuSide;
  shift: number;
  stand: SubmenuStand;
}

const SUBMENU_FIRST_PLACE: SubmenuPlace = {
  side: SUBMENU_SIDE.RIGHT,
  shift: 0,
  stand: SUBMENU_STAND.DOWN,
};

interface SheetPage {
  readonly pinned: boolean;
  readonly id: string;
}

const SUBMENU_GAP = 9;

const MENU =
  "ui-searchable-menu relative [.ui-anchored-popover>&]:max-h-popover-room [.ui-rect-float>&]:max-h-popover-room";

const FOOT = "ui-searchable-menu-foot block flex-none border-t border-border p-menu-inset";

const NOTE =
  "ui-searchable-menu-note px-row-inset pt-ui-4 pb-0 [.ui-searchable-menu-submenu>&]:pb-menu-inset";

const LAST_LINE =
  "ui-searchable-menu-last-line block flex-none border-t border-border p-menu-inset";

const LAST_LINE_BODY =
  "ui-searchable-menu-last-line-body flex items-baseline justify-between gap-ui-8 px-row-inset";

const LAST_LINE_END = "ui-searchable-menu-last-line-end flex-none whitespace-nowrap";

const HEAD =
  "ui-searchable-menu-head flex min-h-control flex-none items-center gap-icon-gap border-b border-border px-row-inset has-[.ui-folding-button]:pl-menu-inset [--ui-fold:folded]";

const HEADING = "ui-searchable-menu-heading px-row-inset pt-ui-8 pb-ui-4";

const SUBMENU =
  "ui-searchable-menu-submenu absolute top-0 left-submenu-reach z-1 w-submenu data-[side=left]:right-submenu-reach data-[side=left]:left-auto data-[stand=up]:top-auto data-[stand=up]:bottom-0";

const BRANCH = "ui-searchable-menu-branch relative";

const ROW_BRANCH =
  "ui-searchable-menu-branch ui-searchable-menu-row-branch pointer-events-none absolute right-0 left-0 [&>*]:pointer-events-auto";

function sectionsOf<Row extends MenuRow>(rows: readonly Row[]): Section<Row>[] {
  const sections: Section<Row>[] = [];
  rows.forEach((row, index) => {
    const last = sections.at(-1);
    if (last !== undefined && last.heading === row.section) last.rows.push({ row, index });
    else sections.push({ heading: row.section, rows: [{ row, index }] });
  });
  return sections;
}

function firstOpen(rows: readonly MenuRow[]): number {
  return rows.findIndex((row) => row.disabled === undefined);
}

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

function markedLabel(row: MenuRow, query: string): React.ReactNode {
  const ranges = searchHit(rowSubject(row), query)?.label ?? [];
  if (ranges.length === 0) return row.label;
  const parts: React.ReactNode[] = [];
  let from = 0;
  for (const range of ranges) {
    if (range.start > from) parts.push(row.label.slice(from, range.start));
    parts.push(
      <SearchMatch key={range.start}>{row.label.slice(range.start, range.end)}</SearchMatch>,
    );
    from = range.end;
  }
  if (from < row.label.length) parts.push(row.label.slice(from));
  return parts;
}

const NOWHERE = -1;

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

function optionGroups(
  rows: readonly MenuRow[],
  value: string | undefined,
  checked: ReadonlySet<string> | undefined,
  query: string,
  unmasked: boolean,
): ComboboxGroup[] {
  return sectionsOf(rows).map((section) => ({
    label: section.heading,
    replayUnmasked: unmasked,
    options: section.rows.map(({ row }) => ({
      id: row.id,
      label: rowWords(row, unmasked, markedLabel(row, query)),
      words: row.label,
      ...(row.faces === undefined
        ? { icon: row.icon }
        : { lead: row.faces, leadWidth: COMBOBOX_LEAD.FACES }),
      detail: rowWords(row, unmasked, row.detail),
      detailWords: typeof row.detail === "string" ? row.detail : undefined,
      hint: rowWords(row, unmasked, rowHint(row)),
      replayMasked: row.replayMasked,
      disabled: row.disabled !== undefined,
      opens: row.submenu !== undefined,
      current:
        value === undefined && checked === undefined
          ? undefined
          : row.id === value || checked?.has(row.id) === true,
      card: row.card,
    })),
  }));
}

function rowWords(row: MenuRow, unmasked: boolean, words: React.ReactNode): React.ReactNode {
  if (words === undefined || words === null || (!unmasked && row.replayMasked !== true)) {
    return words;
  }
  return (
    <ReplayWords unmasked={unmasked} masked={row.replayMasked}>
      {words}
    </ReplayWords>
  );
}

function submenuOptions(open: Submenu, unmasked: boolean): ComboboxOption[] {
  return open.rows.map((row) => ({
    id: row.id,
    label: rowWords(row, unmasked, row.label),
    icon: row.icon,
    detail: rowWords(row, unmasked, row.detail),
    detailWords: typeof row.detail === "string" ? row.detail : undefined,
    hint: rowWords(row, unmasked, rowHint(row)),
    replayMasked: row.replayMasked,
    card: row.card,
    current: row.id === open.value,
  }));
}

function Head({ head, unmasked }: { head: MenuHead; unmasked: boolean }): React.JSX.Element {
  return (
    <div className={HEAD}>
      {head.back === undefined ? null : (
        <BackButton
          label={head.back.label}
          place={head.back.label}
          command={NO_BACK_KEY}
          keepFocus
          tabbable={false}
          onBack={head.back.onBack}
        />
      )}
      <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.LABEL}>
        <ReplayWords unmasked={unmasked}>{head.words}</ReplayWords>
      </Text>
    </div>
  );
}

function FootNote({ words }: { words: React.ReactNode }): React.JSX.Element {
  return (
    <div className={NOTE}>
      <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {words}
      </Text>
    </div>
  );
}

function LastLine({ line }: { line: MenuLastLine }): React.JSX.Element {
  return (
    <div className={LAST_LINE}>
      <div className={LAST_LINE_BODY}>
        <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {line.words}
        </Text>
        {line.end === undefined ? null : (
          <span className={LAST_LINE_END}>
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {line.end}
            </Text>
          </span>
        )}
      </div>
    </div>
  );
}

function PlacedRow({
  row,
  title,
  titleMasked,
  description,
  disabled,
  onPress,
}: {
  row: MenuRow;
  title: string;
  titleMasked: boolean | undefined;
  description: React.ReactNode;
  disabled: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <RowHintOptions card={row.card}>
      <ListRow
        leading={row.faces ?? row.icon}
        title={titleMasked === true ? <ReplayWords masked>{title}</ReplayWords> : title}
        description={rowWords(row, false, description)}
        meta={rowHint(row)}
        hint={row.card === undefined ? undefined : { Hint: RowHint, label: title }}
        disabled={disabled}
        onPress={onPress}
      />
    </RowHintOptions>
  );
}

function submenuRows(row: MenuRow, submenu: Submenu): React.JSX.Element[] {
  return submenu.rows.map((choice) => (
    <PlacedRow
      key={choice.id}
      row={choice}
      title={row.label}
      titleMasked={row.replayMasked}
      description={choice.label}
      disabled={row.disabled !== undefined}
      onPress={() => submenu.onPick(choice.id)}
    />
  ));
}

export function MenuRowList({
  label,
  rows,
  onPick,
}: {
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
                        titleMasked={row.replayMasked}
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
    id: string;
    label: string;
    placeholder?: string | undefined;
    rows: readonly MenuRow[];
    value: string | undefined;
    checked?: ReadonlySet<string> | undefined;
    note?: React.ReactNode;
    noMatch: string;
    onSearch?: ((query: string) => void) | undefined;
    onPick: (id: string) => void;
    onClose: () => void;
    onLeave: (left: EventTarget | null) => void;
    foot?: readonly FootRow[] | undefined;
    head?: MenuHead | undefined;
    lastLine?: MenuLastLine | undefined;
    leaving?: boolean | undefined;
    ref?: ((element: HTMLElement | null) => void) | undefined;
    replayUnmasked?: boolean | undefined;
  } & SearchableMenuPlace,
): React.JSX.Element {
  const { rows, value, onPick } = props;
  const unmasked = props.replayUnmasked === true;
  const leaving = props.leaving === true;
  const sheeted = () => props.layer !== SEARCHABLE_MENU_LAYER.EMBEDDED && inNarrowRoom();
  const [sheet, setSheet] = useState(sheeted);
  const [query, setQuery] = useState("");
  const answered = props.onSearch !== undefined;
  const matches = answered ? rows : matchingRows(rows, query);
  const foot = props.foot ?? [];
  const [highlight, setHighlightAt] = useState<{ index: number; id: string | undefined }>();
  const setHighlight = (index: number | undefined) =>
    setHighlightAt(index === undefined ? undefined : { index, id: matches[index]?.id });
  const movedRow =
    highlight?.id === undefined ? -1 : matches.findIndex((row) => row.id === highlight.id);
  const chosen = matches.findIndex((row) => row.id === value);
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
  const [submenu, setSubmenu] = useState<{ moved: number | undefined } | undefined>(undefined);
  const [place, setPlace] = useState<SubmenuPlace>(SUBMENU_FIRST_PLACE);
  const [page, setPage] = useState<SheetPage | undefined>(undefined);
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
  const holdSurface = useCallback(
    (element: HTMLElement | null) => {
      surface.current = element;
      ownerRef?.(element);
    },
    [ownerRef],
  );
  const [rowBox, setRowBox] = useState<{ top: number; height: number } | undefined>(undefined);

  useEffect(() => {
    if (leaving) return;
    if (sheet) list.current?.focus({ preventScroll: true });
    else (field.current ?? list.current)?.focus();
  }, [leaving, sheet, page]);

  const openAt = sheet || open === undefined ? undefined : at;
  const listedAt = !sheet && open !== undefined && footAt < 0 ? at : undefined;
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
  const pickIn = (shown: Submenu, id: string) => {
    if (sheet && shown.stays === true) setPage(undefined);
    else if (sheet) props.onClose();
    shown.onPick(id);
  };

  const footed = foot.length > 0;
  const controlled =
    sheet && open !== undefined
      ? [submenuId]
      : [listId, ...(footed ? [footId] : []), ...(open === undefined ? [] : [submenuId])];
  const optionId = (index: number) => comboboxOptionId(listId, index);
  const footRowId = (index: number) => `${footId}-row-${index}`;
  const subOptionId = (index: number) => comboboxOptionId(submenuId, index);
  const listActive = at >= 0 && at < matches.length ? optionId(at) : undefined;
  const footActive = footAt >= 0 && footAt < foot.length ? footRowId(footAt) : undefined;
  const subActive = open !== undefined && subAt >= 0 ? subOptionId(subAt) : undefined;

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
  const keys = useComboboxField({
    open: true,
    active: steered,
    count: open === undefined ? matches.length + foot.length : open.rows.length,
    skipped: open === undefined ? blocked : undefined,
    controls: controlled.join(" "),
    activeId: subActive ?? listActive ?? footActive,
    onActiveChange: (index) => {
      if (!sheet) (field.current ?? list.current)?.focus();
      else if (document.activeElement !== field.current)
        list.current?.focus({ preventScroll: true });
      if (open === undefined) setHighlight(index);
      else setSubmenu({ moved: index });
    },
    onChoose: pick,
    onEnter: () => pick(steered),
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
  const onKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target === field.current || event.target === list.current) return;
    if (event.key === "Enter") return;
    keys.onKeyDown(event);
  };

  const aim = useSubmenuAim(panel, !sheet && open !== undefined);

  const hoverRow = (index: number) => {
    if (index === at && open !== undefined) return;
    if (sheet || matches[index]?.submenu === undefined) return moveTo(index);
    setHighlight(index);
    openSubmenu(index);
  };

  const hoverFoot = (row: FootRow, index: number) => {
    if (index === footAt && (sheet || open !== undefined || row.submenu === undefined)) return;
    setHighlight(matches.length + index);
    if (sheet || row.submenu === undefined) setSubmenu(undefined);
    else openSubmenu(matches.length + index);
  };

  const submenuBody = (shown: Submenu) => (
    <>
      <ComboboxList
        ref={sheet ? list : undefined}
        id={submenuId}
        label={shown.label}
        groups={[{ options: submenuOptions(shown, unmasked) }]}
        active={subAt}
        onActiveChange={(moved) => setSubmenu({ moved })}
        onChoose={(_index, option) => pickIn(shown, option.id)}
        steer={sheet ? keys : undefined}
      />
      {shown.note === undefined ? null : (
        <FootNote words={<ReplayWords unmasked={unmasked}>{shown.note}</ReplayWords>} />
      )}
    </>
  );

  const submenuSurface = (shown: Submenu) => (
    <MenuSurface
      ref={panel}
      className={SUBMENU}
      inset={MENU_SURFACE_INSET.NONE}
      data-side={place.side}
      data-stand={place.stand}
      style={cssCustomProperties({ "--ui-submenu-shift": `${place.shift}px` })}
      onMouseDown={(event) => event.preventDefault()}
    >
      {submenuBody(shown)}
    </MenuSurface>
  );

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
      groups={optionGroups(matches, value, props.checked, answered ? "" : query, unmasked)}
      active={at}
      onActiveChange={(index) => aim(() => hoverRow(index))}
      onChoose={(index) => {
        const row = matches[index];
        if (row !== undefined) chooseRow(row, index);
      }}
      steer={searching && !sheet ? undefined : keys}
      note={props.note}
      empty={props.note === undefined ? props.noMatch : undefined}
    />
  );

  const beside = sheet ? undefined : open;
  const pinnedRows = footed ? (
    <div id={footId} className={FOOT}>
      {foot.map((row, index) => {
        const item = (
          <MenuItem
            action={{
              label: row.label,
              ...(row.icon === undefined ? undefined : { icon: row.icon }),
              tag: row.tag,
              hint:
                row.detail === undefined ? undefined : (
                  <ReplayWords unmasked={unmasked}>{row.detail}</ReplayWords>
                ),
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
              onHover: () => aim(() => hoverFoot(row, index)),
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
        return row.disabled === undefined ? (
          <Fragment key={row.id}>{branch}</Fragment>
        ) : (
          <Tooltip key={row.id} label={row.disabled}>
            {branch}
          </Tooltip>
        );
      })}
    </div>
  ) : null;
  const footRows = (
    <>
      <MenuReplayUnmasked.Provider value={unmasked}>{pinnedRows}</MenuReplayUnmasked.Provider>
      {props.lastLine === undefined ? null : <LastLine line={props.lastLine} />}
    </>
  );

  if (sheet) {
    return (
      <MenuSheetFrame
        id={props.id}
        open={!leaving}
        initialFocus={list}
        hold={ownerRef}
        name={open?.label ?? props.head?.words ?? props.label}
        detail={open === undefined ? undefined : props.label}
        replayUnmasked={unmasked}
        back={open === undefined ? props.head?.back : { label: props.label, onBack: closeSubmenu }}
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
      {...REPLAY_MASKED}
      leaving={leaving}
      onKeyDown={onKey}
      onBlur={(event) => props.onLeave(event.relatedTarget)}
    >
      {props.head === undefined ? null : <Head head={props.head} unmasked={unmasked} />}
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
