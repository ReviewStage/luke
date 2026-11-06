import { SELECTION_WORDS } from "@repo/features/words";
import {
  type ComponentType,
  type CSSProperties,
  createContext,
  type FocusEventHandler,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEventHandler,
  type ReactElement,
  type ReactNode,
  type RefCallback,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
} from "react";
import { cssCustomProperties } from "../../css.js";
import { ChevronRightIcon, FoldChevronIcon } from "../../face/glyphs.js";
import { PRESS_PULSE, pulsePress } from "../../press-pulse.js";
import { ReplayWords } from "../../session-replay-marks.js";
import { useClipped } from "../../use-clipped.js";
import { BUTTON_SIZE } from "../button/button.js";
import { motionKey, motionRows } from "../list-motion/list-motion.js";
import { useLinkAddress } from "../menu/link-address.js";
import { withContextMenu } from "../menu/menu.js";
import { rovingItem, useRovingKeys } from "../roving-keys/roving-keys.js";
import { type ListRowMenu, useRowMenu } from "../row-menu/row-menu.js";
import {
  holdRun,
  type ListSelection,
  ListSelectionContext,
  selectableRow,
  selectionRoot,
  useListSelection,
} from "../selection/list-selection.js";
import { SELECT_BOX_PLACE, SelectBox } from "../selection/select-box.js";
import {
  reachInRun,
  VIRTUAL_ROWS_ANCHOR,
  type VirtualRowPlace,
  VirtualRows,
  type VirtualRowsHandle,
} from "../virtual-rows/virtual-rows.js";
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";

export type { ListRowMenu } from "../row-menu/row-menu.js";
export type { ListSelection } from "../selection/list-selection.js";

export const LIST_ROW_CURRENT = {
  PAGE: "page",
  ITEM: "true",
} as const;

export type ListRowCurrent = (typeof LIST_ROW_CURRENT)[keyof typeof LIST_ROW_CURRENT];

export const LIST_ROW_CURRENT_LOOK = {
  SHEET: "sheet",
  TINT: "tint",
} as const;

export type ListRowCurrentLook = (typeof LIST_ROW_CURRENT_LOOK)[keyof typeof LIST_ROW_CURRENT_LOOK];

export const LIST_ROW_META = {
  MIDDLE: "middle",
  TITLE: "title",
  LAST: "last",
} as const;

export type ListRowMeta = (typeof LIST_ROW_META)[keyof typeof LIST_ROW_META];

export const LIST_ROW_TITLE_LINES = {
  ONE: "one",
  TWO: "two",
} as const;

export type ListRowTitleLines = (typeof LIST_ROW_TITLE_LINES)[keyof typeof LIST_ROW_TITLE_LINES];

export const LIST_ROW_CHEVRON = {
  ROOM: "room",
  META: "meta",
} as const;

export type ListRowChevron = (typeof LIST_ROW_CHEVRON)[keyof typeof LIST_ROW_CHEVRON];

export const LIST_ROW_ACTIONS = {
  ALWAYS: "always",
  HOVER: "hover",
} as const;

export type ListRowActions = (typeof LIST_ROW_ACTIONS)[keyof typeof LIST_ROW_ACTIONS];

export const LIST_ROW_LEAD = {
  DESCRIPTION: "description",
  INLINE: "inline",
  ABOVE: "above",
} as const;

export type ListRowLeadAt = (typeof LIST_ROW_LEAD)[keyof typeof LIST_ROW_LEAD];

export interface ListRowLead {
  readonly icon: ReactNode;
  readonly label: ReactNode;
}

interface ListRowHintProps {
  "aria-describedby"?: string | undefined;
  "aria-keyshortcuts"?: string | undefined;
  onPointerEnter?: PointerEventHandler<HTMLElement> | undefined;
  onPointerLeave?: PointerEventHandler<HTMLElement> | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  onFocus?: FocusEventHandler<HTMLElement> | undefined;
  onBlur?: FocusEventHandler<HTMLElement> | undefined;
}

export type ListRowHint = ComponentType<{
  label: string | undefined;
  row: RefObject<HTMLElement | null>;
  children: ReactElement<ListRowHintProps>;
}>;

export interface ListRowFold {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly label: string;
}

export interface ListRowNest {
  readonly position: number;
  readonly size: number;
}

export function nestedItem(
  depth: number,
  nest: ListRowNest | undefined,
): { "aria-level"?: number; "aria-posinset"?: number; "aria-setsize"?: number } {
  if (nest === undefined) return depth === 0 ? {} : { "aria-level": depth + 1 };
  return { "aria-level": depth + 1, "aria-posinset": nest.position, "aria-setsize": nest.size };
}

export const LIST_VARIANT = {
  PLAIN: "plain",
  CARD: "card",
} as const;

export type ListVariant = (typeof LIST_VARIANT)[keyof typeof LIST_VARIANT];

export const LIST_DENSITY = {
  REGULAR: "regular",
  COMPACT: "compact",
  DENSE: "dense",
} as const;

export type ListDensity = (typeof LIST_DENSITY)[keyof typeof LIST_DENSITY];

export const LIST_ROW_INK = {
  TEXT: "text",
  SIDEBAR: "sidebar",
} as const;

export type ListRowInk = (typeof LIST_ROW_INK)[keyof typeof LIST_ROW_INK];

const LIST_CLASS =
  "ui-list flex list-none flex-col gap-list-gap p-0 data-[variant=card]:gap-0 data-[variant=card]:overflow-hidden data-[variant=card]:rounded-control data-[variant=card]:border data-[variant=card]:border-border data-[variant=card]:bg-surface";

const ROW_CLASS =
  "ui-list-row group/list-row grid min-w-0 grid-cols-list-row items-center ms-list-row-nest font-sans text-foreground transition-[background-color] duration-(--ui-duration-hover) ease-plain";

const FOLD_CLASS =
  "ui-list-row-fold col-[leading] row-1 z-1 grid min-h-control-icon min-w-control-icon cursor-press place-items-center rounded-control border-0 bg-transparent p-0 text-muted-foreground";

const FOLD_KEY_OPENS: Readonly<Record<string, boolean>> = { ArrowRight: true, ArrowLeft: false };

const MAIN_CLASS =
  "ui-list-row-main col-[leading-start/end-end] row-1 m-0 grid min-w-0 grid-cols-subgrid items-center border-0 bg-transparent text-start text-inherit [font:inherit]";

const MAIN_BUTTON_CLASS = `${MAIN_CLASS} cursor-press disabled:cursor-default`;

const LEADING_CLASS =
  "ui-list-row-leading col-[leading] me-icon-gap inline-flex text-muted-foreground [&>.ui-provider-mark]:text-foreground [&>svg]:size-control-icon";

const END_CLASS =
  "ui-list-row-end col-[end] ms-icon-gap flex min-w-0 items-center justify-self-end gap-icon-gap";

const CHEVRON_CLASS =
  "ui-list-row-chevron inline-flex flex-none text-muted-foreground transition-opacity duration-(--ui-duration-hover) ease-plain [&>svg]:size-ui-12";

const LEAD_CLASS = {
  [LIST_ROW_LEAD.DESCRIPTION]:
    "ui-list-row-lead me-ui-4 inline-flex max-w-list-row-lead items-center gap-ui-2 rounded-ui-6 bg-fill-strong px-ui-4 py-0 align-bottom text-muted-foreground",
  [LIST_ROW_LEAD.INLINE]:
    "ui-list-row-lead inline-flex max-w-full items-center gap-ui-4 align-bottom text-muted-foreground",
  [LIST_ROW_LEAD.ABOVE]: "ui-list-row-lead flex min-w-0 items-center gap-ui-6",
} as const satisfies Record<ListRowLeadAt, string>;

const LEAD_SEPARATOR = " · ";

function preventFocusMove(event: MouseEvent<HTMLElement>): void {
  event.preventDefault();
}

function plainWords(words: ReactNode): string | undefined {
  return typeof words === "string" ? words : undefined;
}

const ListDensityContext = createContext<ListDensity>(LIST_DENSITY.REGULAR);

const ListVariantContext = createContext<ListVariant>(LIST_VARIANT.PLAIN);

function rowProperties(depth: number): CSSProperties | undefined {
  return depth === 0 ? undefined : cssCustomProperties({ "--ui-list-row-depth": depth });
}

function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

export interface ListRun {
  readonly scroller: RefObject<HTMLElement | null>;
  readonly shiftedBy?: RefObject<HTMLElement | null> | undefined;
  readonly keys: readonly string[];
  readonly estimate: number;
  readonly gap?: number | undefined;
  readonly overscan?: number | undefined;
  readonly handle?: RefObject<VirtualRowsHandle | null> | undefined;
  readonly row: (index: number, place: VirtualRowPlace) => ReactNode;
}

export function List({
  id,
  label,
  variant = LIST_VARIANT.PLAIN,
  density = LIST_DENSITY.REGULAR,
  fingerTall = false,
  moves = false,
  joinsWalk = false,
  selection,
  onPointerDown,
  run,
  children,
}: {
  id?: string | undefined;
  label: string;
  variant?: ListVariant;
  density?: ListDensity;
  fingerTall?: boolean | undefined;
  moves?: boolean;
  joinsWalk?: boolean;
  selection?: ListSelection | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  run?: ListRun | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  const own = useRef<VirtualRowsHandle>(null);
  const handle = run?.handle ?? own;
  const keys = run?.keys;
  const bringIn = useCallback(
    (key: string, then: () => void) => handle.current?.bringIn(key, then) ?? false,
    [handle],
  );
  const roving = useRovingKeys<HTMLElement>({
    reach: keys === undefined ? undefined : reachInRun(handle),
  });
  const order = useMemo(() => (keys === undefined ? undefined : [keys]), [keys]);
  const chooser = useListSelection(selection, order, keys === undefined ? undefined : bringIn);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!chooser.onKeyDown(event) && !joinsWalk) roving.onKeyDown(event);
  };
  const contexts = (rows: ReactNode) => (
    <ListVariantContext.Provider value={variant}>
      <ListDensityContext.Provider value={density}>
        <ListSelectionContext.Provider value={chooser.selecting}>
          {rows}
        </ListSelectionContext.Provider>
      </ListDensityContext.Provider>
    </ListVariantContext.Provider>
  );
  if (run !== undefined) {
    return contexts(
      <VirtualRows
        scroller={run.scroller}
        shiftedBy={run.shiftedBy}
        keys={run.keys}
        estimate={run.estimate}
        gap={run.gap ?? 0}
        overscan={run.overscan}
        anchor={VIRTUAL_ROWS_ANCHOR.START}
        listItems
        moves={moves}
        holdsFocus
        className={LIST_CLASS}
        aria-label={label}
        onPointerDown={onPointerDown}
        handle={handle}
        block={{
          ...(joinsWalk ? {} : roving),
          id,
          onKeyDown,
          ...selectionRoot(),
          "data-variant": variant,
          "data-density": density,
          "data-finger-tall": fingerTall ? "true" : undefined,
        }}
      >
        {run.row}
      </VirtualRows>,
    );
  }
  return (
    <ul
      {...(joinsWalk ? {} : roving)}
      onKeyDown={onKeyDown}
      id={id}
      className={LIST_CLASS}
      {...selectionRoot()}
      data-variant={variant}
      data-density={density}
      data-finger-tall={fingerTall ? "true" : undefined}
      aria-label={label}
      onPointerDown={onPointerDown}
      {...(moves ? motionRows() : {})}
    >
      {contexts(children)}
    </ul>
  );
}

export function ListRow({
  leading,
  title,
  titleReplayMasked = false,
  description,
  descriptionReplayMasked = false,
  lead,
  leadAt = LIST_ROW_LEAD.DESCRIPTION,
  attachments,
  attachmentsOpen = false,
  meta,
  metaAt = LIST_ROW_META.MIDDLE,
  titleLines = LIST_ROW_TITLE_LINES.ONE,
  actions,
  actionsAt = LIST_ROW_ACTIONS.ALWAYS,
  onPress,
  linkHref,
  current,
  unread,
  muted,
  latent = false,
  hint,
  density,
  ink = LIST_ROW_INK.TEXT,
  currentLook = LIST_ROW_CURRENT_LOOK.SHEET,
  menuOpen = false,
  chevron = false,
  chevronAt = LIST_ROW_CHEVRON.ROOM,
  keepFocus = false,
  disabled = false,
  tabbable,
  onTitleClipped,
  id,
  selectKey,
  selectBox = false,
  motionKey: followedBy,
  ref,
  onKeyDown,
  menu,
  more = true,
  depth = 0,
  nest,
  fold,
  describedAs,
  unreadWords,
  place,
}: {
  leading?: ReactNode;
  title: ReactNode;
  titleReplayMasked?: boolean | undefined;
  description?: ReactNode;
  descriptionReplayMasked?: boolean | undefined;
  lead?: ListRowLead | undefined;
  leadAt?: ListRowLeadAt | undefined;
  attachments?: ReactNode;
  attachmentsOpen?: boolean | undefined;
  meta?: ReactNode;
  metaAt?: ListRowMeta;
  titleLines?: ListRowTitleLines;
  actions?: ReactNode;
  actionsAt?: ListRowActions;
  onPress?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  linkHref?: string | undefined;
  current?: ListRowCurrent | undefined;
  unread?: boolean | undefined;
  muted?: boolean | undefined;
  latent?: boolean | undefined;
  hint?: { readonly Hint: ListRowHint; readonly label: string } | undefined;
  density?: ListDensity | undefined;
  ink?: ListRowInk | undefined;
  currentLook?: ListRowCurrentLook | undefined;
  menuOpen?: boolean | undefined;
  chevron?: boolean | undefined;
  chevronAt?: ListRowChevron | undefined;
  keepFocus?: boolean | undefined;
  disabled?: boolean | undefined;
  tabbable?: boolean | undefined;
  onTitleClipped?: ((clipped: boolean) => void) | undefined;
  id?: string | undefined;
  selectKey?: string | undefined;
  selectBox?: boolean | undefined;
  motionKey?: string | undefined;
  ref?: RefCallback<HTMLElement> | undefined;
  onKeyDown?: ((event: KeyboardEvent<HTMLElement>) => void) | undefined;
  menu?: ListRowMenu | undefined;
  more?: boolean | undefined;
  depth?: number | undefined;
  nest?: ListRowNest | undefined;
  fold?: ListRowFold | undefined;
  describedAs?: string | undefined;
  unreadWords?: string | undefined;
  place?: VirtualRowPlace | undefined;
}): React.JSX.Element {
  const linkAddress = useLinkAddress(linkHref);
  const pressElement = useRef<HTMLButtonElement | null>(null);
  const rowElement = useRef<HTMLElement | null>(null);
  const pressRef = useCallback(
    (element: HTMLButtonElement | null) => {
      pressElement.current = element;
      rowElement.current = element?.parentElement ?? null;
      ref?.(element);
      linkAddress(element);
    },
    [ref, linkAddress],
  );
  const titleId = useId();
  const leadId = useId();
  const metaId = useId();
  const describedId = useId();
  const foldKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (fold === undefined) return;
    const asked = FOLD_KEY_OPENS[event.key];
    if (asked === undefined || asked === fold.open) return;
    event.preventDefault();
    fold.onOpenChange(asked);
  };
  const named = plainWords(title);
  const subject =
    menu?.subject ??
    (named === undefined
      ? undefined
      : { mark: leading, name: named, detail: plainWords(description) ?? plainWords(lead?.label) });
  const rowMenu = useRowMenu(menu === undefined ? undefined : { ...menu, subject }, {
    disabled,
    opener: onPress ? pressElement : undefined,
  });
  const offered = rowMenu.offered;
  const moreDrawn = offered && (more || onPress === undefined);
  const [titleMeasured, titleClipped] = useClipped(plainWords(title));
  useEffect(() => {
    onTitleClipped?.(titleClipped);
  }, [onTitleClipped, titleClipped]);
  const [descriptionMeasured, descriptionClipped] = useClipped(plainWords(description));
  const listDensity = useContext(ListDensityContext);
  const pressPulse =
    useContext(ListVariantContext) === LIST_VARIANT.CARD ? PRESS_PULSE.FLUSH : PRESS_PULSE.QUIET;
  const selecting = useContext(ListSelectionContext);
  const choosable = selecting !== undefined && selectKey !== undefined;
  const chosen = choosable && selecting.selected.has(selectKey);
  const boxed = choosable && selectBox && !disabled ? selecting : undefined;
  const [leadMeasured, leadClipped] = useClipped(plainWords(lead?.label));
  const heading = (
    <span
      ref={titleMeasured}
      id={moreDrawn || said(actions) || describedAs !== undefined ? titleId : undefined}
      className="ui-list-row-title"
      data-overflow={String(titleClipped)}
      data-lines={titleLines === LIST_ROW_TITLE_LINES.ONE ? undefined : titleLines}
    >
      {unread === true && unreadWords !== undefined ? (
        <VisuallyHidden>{unreadWords}</VisuallyHidden>
      ) : null}
      <ReplayWords masked={titleReplayMasked}>{title}</ReplayWords>
    </span>
  );
  const end =
    said(meta) || chevron ? (
      <span className={END_CLASS} data-chevron={chevron ? chevronAt : undefined}>
        {said(meta) ? (
          <span id={metaId} className="ui-list-row-meta">
            {meta}
          </span>
        ) : null}
        {chevron ? (
          <span className={CHEVRON_CLASS} aria-hidden="true">
            <ChevronRightIcon />
          </span>
        ) : null}
      </span>
    ) : null;
  const leadMark =
    lead === undefined ? null : (
      <span className={LEAD_CLASS[leadAt]} data-at={leadAt}>
        <span
          className="ui-list-row-lead-icon inline-flex flex-none text-muted-foreground [&>svg]:size-words-glyph"
          aria-hidden="true"
        >
          {lead.icon}
        </span>
        <span
          ref={leadMeasured}
          id={leadId}
          className="ui-list-row-lead-label min-w-0 overflow-hidden whitespace-nowrap"
          data-overflow={String(leadClipped)}
        >
          {lead.label}
        </span>
      </span>
    );
  const above = leadAt === LIST_ROW_LEAD.ABOVE && lead !== undefined;
  const firstLine = above ? leadMark : heading;
  const metaPlace =
    metaAt === LIST_ROW_META.TITLE &&
    titleLines === LIST_ROW_TITLE_LINES.ONE &&
    !said(description) &&
    lead === undefined &&
    !said(attachments)
      ? LIST_ROW_META.MIDDLE
      : metaAt;
  const namedBy =
    describedAs === undefined
      ? undefined
      : [
          above ? leadId : undefined,
          titleId,
          lead !== undefined && !above ? leadId : undefined,
          said(meta) ? metaId : undefined,
        ]
          .filter((each) => each !== undefined)
          .join(" ");
  const face = (
    <>
      {said(leading) ? (
        <span className={LEADING_CLASS} aria-hidden="true">
          {leading}
        </span>
      ) : null}
      <span className="ui-list-row-text col-[text] min-w-0">
        {said(attachments) ? (
          <span
            className="ui-list-row-attachments flex gap-ui-6 overflow-hidden"
            aria-hidden={attachmentsOpen ? undefined : "true"}
          >
            {attachments}
          </span>
        ) : null}
        {metaPlace === LIST_ROW_META.TITLE ? (
          <span className="ui-list-row-head">
            {firstLine}
            {end}
          </span>
        ) : (
          firstLine
        )}
        {above ? heading : null}
        {said(description) || (!above && lead !== undefined) ? (
          <span
            ref={descriptionMeasured}
            className="ui-list-row-description"
            data-overflow={String(descriptionClipped)}
          >
            {above ? null : leadMark}
            {leadAt === LIST_ROW_LEAD.INLINE && lead !== undefined && said(description)
              ? LEAD_SEPARATOR
              : null}
            <ReplayWords masked={descriptionReplayMasked}>{description}</ReplayWords>
          </span>
        ) : null}
        {metaPlace === LIST_ROW_META.LAST ? end : null}
      </span>
      {metaPlace === LIST_ROW_META.MIDDLE ? end : null}
    </>
  );
  const press = onPress ? (
    <button
      ref={pressRef}
      type="button"
      className={MAIN_BUTTON_CLASS}
      aria-current={current}
      aria-labelledby={namedBy}
      aria-describedby={describedAs === undefined ? undefined : describedId}
      aria-description={chosen && describedAs === undefined ? SELECTION_WORDS.SELECTED : undefined}
      disabled={disabled}
      tabIndex={tabbable === false ? -1 : undefined}
      {...(tabbable === undefined ? rovingItem() : {})}
      {...(choosable ? selectableRow(selectKey) : {})}
      onMouseDown={keepFocus ? preventFocusMove : choosable ? holdRun : undefined}
      onClick={(event) => {
        const row = event.currentTarget.closest<HTMLElement>(".ui-list-row");
        pulsePress(row ?? event.currentTarget, pressPulse);
        if (rowMenu.open) rowMenu.close(false);
        if (choosable && selecting.press(selectKey, event)) return;
        onPress(event);
      }}
      onKeyDown={(event) => {
        foldKeys(event);
        onKeyDown?.(event);
      }}
    >
      {face}
    </button>
  ) : undefined;
  const row = (
    <>
      {fold === undefined ? null : (
        <button
          type="button"
          className={FOLD_CLASS}
          aria-label={fold.label}
          aria-expanded={fold.open}
          onClick={() => fold.onOpenChange(!fold.open)}
        >
          <span className="ui-disclosure-turn" data-open={fold.open}>
            <FoldChevronIcon />
          </span>
        </button>
      )}
      {press === undefined ? (
        <div className={MAIN_CLASS} aria-current={current}>
          {face}
        </div>
      ) : hint === undefined ? (
        press
      ) : (
        <hint.Hint label={hint.label} row={rowElement}>
          {press}
        </hint.Hint>
      )}
      {press === undefined || describedAs === undefined ? null : (
        <span id={describedId} hidden>
          {chosen ? `${SELECTION_WORDS.SELECTED}, ${describedAs}` : describedAs}
        </span>
      )}
      {said(actions) ? (
        // biome-ignore lint/a11y/useSemanticElements: a row's acts are presses on its thing, not a form's fields, so they are no `<fieldset>`.
        <div
          role="group"
          aria-labelledby={titleId}
          className="ui-list-row-actions row-1 flex items-center gap-ui-4"
        >
          {actions}
        </div>
      ) : null}
      {moreDrawn ? (
        <div className="ui-list-row-more row-1 flex items-center">
          {rowMenu.button({
            size:
              (density ?? listDensity) === LIST_DENSITY.REGULAR ? undefined : BUTTON_SIZE.COMPACT,
            describedBy: titleId,
          })}
        </div>
      ) : null}
    </>
  );
  const { ref: placeRef, ...placed } = place ?? {};
  const opens = onPress !== undefined;
  const itemRef = useCallback(
    (element: HTMLLIElement | null) => {
      if (!opens) ref?.(element);
      placeRef?.(element);
    },
    [opens, ref, placeRef],
  );
  const actsOnHover = actionsAt === LIST_ROW_ACTIONS.HOVER || (moreDrawn && !said(actions));
  return (
    <>
      <li
        id={id}
        {...(followedBy === undefined ? {} : motionKey(followedBy))}
        {...placed}
        {...nestedItem(depth, nest)}
        ref={place === undefined ? (onPress ? undefined : ref) : itemRef}
        className={ROW_CLASS}
        data-meta={metaPlace === LIST_ROW_META.MIDDLE ? undefined : metaPlace}
        data-lead={above ? LIST_ROW_LEAD.ABOVE : undefined}
        data-actions={actsOnHover ? LIST_ROW_ACTIONS.HOVER : undefined}
        data-current={current === undefined ? undefined : "true"}
        data-current-look={currentLook}
        data-selected={chosen ? "true" : undefined}
        data-select-box={
          boxed === undefined ? undefined : boxed.selected.size > 0 ? "shown" : "rest"
        }
        data-unread={unread === true ? "true" : undefined}
        data-muted={muted === true ? "true" : undefined}
        data-latent={latent ? "true" : undefined}
        data-density={density}
        data-ink={ink}
        data-menu-open={menuOpen || rowMenu.open ? "true" : undefined}
        data-depth={depth === 0 ? undefined : depth}
        onKeyDown={rowMenu.onKeyDown}
        {...withContextMenu(rowMenu.doors, {})}
        style={{ ...place?.style, ...rowProperties(depth) }}
      >
        {row}
        {boxed === undefined || selectKey === undefined ? null : (
          <SelectBox selectKey={selectKey} place={SELECT_BOX_PLACE.UNREAD_GUTTER} />
        )}
      </li>
      {rowMenu.popup}
    </>
  );
}
