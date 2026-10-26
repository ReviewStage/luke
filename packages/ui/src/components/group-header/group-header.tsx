import { type ReactNode, useId } from "react";
import { PRESS_PULSE, pulseOnPress } from "../../press-pulse.js";
import { STATUS_TONE } from "../../status-tone.js";
import {
  DisclosureChevron,
  type DisclosureControl,
  DisclosureScope,
  useDisclosureFold,
} from "../disclosure/disclosure.js";
import { FoldingSearch } from "../folding-search/folding-search.js";
import { type ContextMenuProps, withContextMenu } from "../menu/menu.js";
import { NAV_COUNT_SHOWN, type NavCount } from "../nav-item/nav-item.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * group-header.tsx -- the head over a group of rows, which may fold the group: the sidebar's repositories and sections, the Inbox's plans, the Tasks list's groups and the Board's columns, a Settings list's and the person page's sections alike.
 *
 * It is one row in the group role's type (`TEXT_VARIANT.GROUP`): the group's
 * glyph, its label, a mark said after the label (a pinned repository's pin),
 * and the count its caller hands it. The count is the caller's to give or
 * leave out, at any value, since when a group counts its rows is the
 * surface's choice, not this one's; where it stands is the surface's width
 * (`surface`): on a wide page, the Tasks list or the Board, always, and in a
 * narrow column, the Inbox's list or the channel list, only while the group is
 * folded or the head is hovered or has the keyboard, so an open group's head
 * keeps the room for its name. A count its caller gives a `shown` of its own,
 * the sidebar's, stands as given.
 *
 * A group that folds (`fold`) is pressed on its head, which says whether the
 * group stands open in `aria-expanded`. The fold is a Disclosure's
 * (`useDisclosureFold`): a press that opens unrolls the rows as they fade in,
 * a press that closes fades them out before they leave the layout, and the
 * chevron is the Disclosure's own, turning on the one turn every fold makes
 * (disclosure.css), all timed on the motion tokens reduced motion zeroes. The
 * glyph gives way to the chevron while the head is hovered or has the
 * keyboard; a head with no glyph draws its chevron at rest, so a fold always
 * says it folds. A fold its holder keeps, as the sidebar keeps which groups
 * are folded, is handed `open` and hears `onOpenChange`.
 *
 * Note that the head is a heading holding a button, beside the group's
 * actions, rather than a `details` summary holding them, because a summary
 * is read as one button and would swallow the heading and the actions in it.
 * A closed group's rows are not drawn at all, so a find in the page passes
 * them by, as a sidebar's folded rows are passed by.
 *
 * A head naming something with a card of its own, a person or an automation,
 * hangs that card while the pointer rests on it (`card`), and a head whose
 * label alone does not say the whole of it hangs a hint (`tooltip`), both
 * over the head's lead and never over the rows under it. A group that folds
 * may leave rows standing under its head while it is folded (`standing`), as
 * the sidebar leaves the open task, drawn once the fold's fade is done, and
 * out of the way while the rows it was keeping come back.
 *
 * A head may stick to the top of its scroller while its rows scroll beneath
 * it (`head`), and a group standing in a grid whose columns its rows share,
 * the Tasks list's, hands them on through its fold's body (`rows`).
 *
 * A group's actions (a repository's ⋯ and +) stand at the head's end beside
 * the fold, so pressing one folds nothing, shown while the head is hovered,
 * holds the focus, or a menu one of them dropped stands open, and at rest
 * where there is no hover; a head whose buttons are the list's own keeps
 * them standing at rest (`actionsShown`). One action may be on, a filter
 * leaving rows out (`GroupAction`): it stands at rest while the rest wait,
 * wearing a dot in the accent's ink over its corner, so a list cut down
 * never passes for the whole of it. A right-click on the head is the ⋯'s
 * second door (`contextMenu`), and the head stays ringed while the menu it
 * opened stands (`menuOpen`).
 *
 * A head that is too tight for a search of its own may offer one (`search`):
 * a magnifier after the label unfolds a field laid over the label and the
 * magnifier alone, so the actions beside it stay under the pointer as it
 * opens and folds.
 *
 * A label is words, or a placeholder block while the group is read, so a
 * skeleton draws through the head its loaded state draws.
 *
 * It is drawn in Tailwind utilities over the theme with no shadcn base,
 * since shadcn has no group head and the fold is the Disclosure's. Its
 * reveals are the head's and the lead's states, which their parts read as
 * named groups (`group/head`, `group/lead`): the pointer's stand only where
 * there is a hover, because iOS spends a first tap on a hover, and a screen
 * with no hover draws at rest what the pointer would have brought, since no
 * pointer rests on the head to bring it.
 */

/** The element a head stands in: a heading at its level in the page's outline, or none, for a head that is no heading. */
export const GROUP_HEADING = {
  H2: "h2",
  H3: "h3",
  H4: "h4",
  NONE: "div",
} as const;
export type GroupHeading = (typeof GROUP_HEADING)[keyof typeof GROUP_HEADING];

/** Whether a group's actions wait for the pointer or the keyboard, or stand at rest. */
export const GROUP_ACTIONS = {
  ON_HOVER: "on-hover",
  AT_REST: "at-rest",
} as const;
export type GroupActions = (typeof GROUP_ACTIONS)[keyof typeof GROUP_ACTIONS];

/** Whether one of a head's actions waits with the rest, or is on and stands at rest, wearing its dot. */
export const GROUP_ACTION_STATE = {
  IDLE: "idle",
  ACTIVE: "active",
} as const;
export type GroupActionState = (typeof GROUP_ACTION_STATE)[keyof typeof GROUP_ACTION_STATE];

/** How wide the surface a group stands on is, which says where its count stands: always on a wide page, only folded or under the pointer in a narrow column. */
export const GROUP_SURFACE = {
  WIDE: "wide",
  NARROW: "narrow",
} as const;
export type GroupSurface = (typeof GROUP_SURFACE)[keyof typeof GROUP_SURFACE];

/** Whether a head scrolls away with its rows or sticks to the top of its scroller while they scroll beneath it. */
export const GROUP_HEAD = {
  SCROLLS: "scrolls",
  STICKS: "sticks",
} as const;
export type GroupHead = (typeof GROUP_HEAD)[keyof typeof GROUP_HEAD];

/** How a group's rows stand: stacked in a column of their own, or as a subgrid of the grid the group stands in, so their cells line up with every other group's. */
export const GROUP_ROWS = {
  STACKED: "stacked",
  SUBGRID: "subgrid",
} as const;
export type GroupRows = (typeof GROUP_ROWS)[keyof typeof GROUP_ROWS];

/** How a group folds: open from the start or not, or as its holder keeps it. */
export type GroupFold = { readonly defaultOpen: boolean } | DisclosureControl;

/**
 * What the pointer resting on the head, or the keyboard on its lead, brings:
 * shown then, hidden at rest, and at rest on a screen with no hover.
 */
const BROUGHT =
  "opacity-0 group-hover/head:opacity-100 group-focus-visible/lead:opacity-100 [@media(hover:none)]:opacity-100";

/** A glyph that gives way to the chevron when the pointer or the keyboard brings it. */
const GIVES_WAY =
  "group-hover/head:opacity-0 group-focus-visible/lead:opacity-0 [@media(hover:none)]:opacity-0";

/** A part's fade as it is brought or put away, on the hover's settle. */
const FADE = "transition-[opacity] duration-(--luke-duration-hover) ease-plain";

/**
 * The head's parts. Note that the glyph and the chevron share one cell, only
 * one of them drawn, so the swap crossfades in place and the label never
 * moves, and that the crossfade is each seat's, so the chevron's turn inside
 * stays disclosure.css's one turn.
 */
const PART = {
  HEADING: "luke-group-header-heading m-0 flex min-w-0 [font:inherit]",
  LEAD: "luke-group-header-lead group/lead m-0 flex h-control min-w-0 flex-auto items-center gap-icon-gap rounded-control border-0 bg-transparent px-row-inset py-0 text-left font-ui text-muted-foreground",
  GLYPH:
    "luke-group-header-glyph grid min-h-control-icon min-w-control-icon flex-none place-items-center *:[grid-area:1/1]",
  ICON: `luke-group-header-icon grid place-items-center [&>svg]:size-control-icon ${FADE}`,
  CHEVRON: `luke-group-header-chevron grid place-items-center ${FADE}`,
  MARK: "luke-group-header-mark inline-flex flex-none text-muted-foreground [&>svg]:size-group-header-mark",
  COUNT: `luke-group-header-count flex-none text-caption-inline tabular-nums ${FADE}`,
  /* Each action waits for the pointer or the keyboard on its own (`group-header.css`). */
  ACTIONS: "luke-group-header-actions flex flex-none items-center",
} as const;

/** The heading's share of the head, which a search's name hands it instead where the head offers one (`folding-search.css`). */
const HEADING_SHARE = "flex-auto";

/** A head that folds is pressed as a row is, so it wears a row's hover; and it gives the one press cursor, the Mac's arrow on the desktop as a Mac's list does, the hand on the web. */
const PRESSED_AS_ROW = {
  HEAD: "[&:hover]:bg-muted",
  LEAD: "cursor-press",
} as const;

/**
 * The head: ringed while its menu is open, so the menu is plainly about this
 * group, and out of the desktop window's drag region, so a press on it is
 * the head's.
 */
const HEAD =
  "luke-group-header-head group/head flex min-w-0 items-center gap-luke-2 rounded-control pr-luke-4 transition-[background-color] duration-(--luke-duration-hover) ease-plain data-[menu-open=true]:shadow-selected-edge in-data-[luke-profile=desktop]:[-webkit-app-region:no-drag]";

/** A head that sticks stands at the top of its scroller while its rows scroll beneath it, on the page's ground so they do not show through. */
const STICKS = "sticky top-0 z-3 bg-ground";

/**
 * A group in a grid hands the grid's columns on through its root and the
 * fold's body down to its rows, so each column lines up down the whole
 * page. Note that a subgrid is a grid whose parent is one, so the body,
 * which the fold draws, must be a subgrid too.
 */
const SUBGRID = {
  ROOT: "grid col-span-full grid-cols-subgrid gap-y-luke-2",
  HEAD: "col-span-full",
  BODY: "grid col-span-full grid-cols-subgrid gap-y-luke-2 *:col-span-full",
} as const;

/** Whether a slot says anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}

/** The count after the label, read with its noun, at whatever value its caller gave. */
function Count({ count }: { count: NavCount }): React.JSX.Element {
  const shown = count.shown ?? NAV_COUNT_SHOWN.ALWAYS;
  const tone = count.tone ?? STATUS_TONE.NEUTRAL;
  // Note that a count of what waits on the reader is in its tone (`tokens/status-tone.css`).
  const ink = tone === STATUS_TONE.NEUTRAL ? "text-muted-foreground" : "text-tone-ink";
  return (
    <span
      className={`${PART.COUNT} ${ink} ${shown === NAV_COUNT_SHOWN.ON_HOVER ? BROUGHT : ""}`}
      data-shown={shown}
      data-tone={tone}
    >
      {count.value}
      {count.noun === undefined ? null : (
        <span className="luke-visually-hidden"> {count.noun}</span>
      )}
    </span>
  );
}

/** What the head's lead says: the glyph and the chevron it gives way to, the label, the mark, the count. */
function Lead({
  glyph,
  folds,
  label,
  mark,
  count,
}: {
  glyph: ReactNode;
  folds: boolean;
  label: ReactNode;
  mark: ReactNode;
  count: NavCount | undefined;
}): React.JSX.Element {
  // Note that with a glyph the chevron waits unseen in its cell, and without one it stands at rest, so a fold always says it folds.
  const swaps = said(glyph) && folds;
  return (
    <>
      {said(glyph) || folds ? (
        <span className={PART.GLYPH} aria-hidden="true">
          {said(glyph) ? (
            <span className={`${PART.ICON} ${swaps ? GIVES_WAY : ""}`}>{glyph}</span>
          ) : null}
          {folds ? (
            <span className={`${PART.CHEVRON} ${swaps ? BROUGHT : ""}`}>
              <DisclosureChevron />
            </span>
          ) : null}
        </span>
      ) : null}
      <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.GROUP} truncate>
        {label}
      </Text>
      {said(mark) ? <span className={PART.MARK}>{mark}</span> : null}
      {count === undefined ? null : <Count count={count} />}
    </>
  );
}

/**
 * One of a head's actions, the button and the menu it drops, which stands at
 * rest while it is on, a filter leaving rows out, wearing the accent's dot,
 * though the head's other actions wait for the pointer or the keyboard.
 */
export function GroupAction({
  state = GROUP_ACTION_STATE.IDLE,
  children,
}: {
  /** Whether it is on, which keeps it standing and dotted. */
  state?: GroupActionState;
  /** The action's button, and the menu it drops. */
  children: ReactNode;
}): React.JSX.Element {
  return (
    <span className="luke-group-header-action relative inline-flex" data-state={state}>
      {children}
    </span>
  );
}

/** A group's head and the rows under it, which a press on the head folds where the group folds. */
export function GroupHeader({
  label,
  glyph,
  mark,
  count,
  actions,
  actionsShown = GROUP_ACTIONS.ON_HOVER,
  search,
  fold,
  standing,
  tooltip,
  card,
  surface = GROUP_SURFACE.WIDE,
  head = GROUP_HEAD.SCROLLS,
  rows: rowsStand = GROUP_ROWS.STACKED,
  heading = GROUP_HEADING.H2,
  menuOpen = false,
  contextMenu,
  children,
}: {
  /** The group's name, or a placeholder block while it is read. */
  label: ReactNode;
  /** The group's glyph, decoration a reader is not told. */
  glyph?: ReactNode;
  /** Said after the label, quietly: a pinned repository's pin. */
  mark?: ReactNode;
  /** The count after the label, drawn as given; left out, nothing is counted. */
  count?: NavCount | undefined;
  /** The group's buttons at the head's end, beside the fold rather than inside it. */
  actions?: ReactNode;
  /** Whether the actions wait for the pointer or the keyboard, or stand at rest. */
  actionsShown?: GroupActions;
  /** A search the head offers, named `label`, which narrows the caller's list as it is typed in. */
  search?: { label: string; value: string; onChange: (value: string) => void } | undefined;
  /** How the group folds; left out, the head folds nothing and the rows always stand. */
  fold?: GroupFold | undefined;
  /** What a folded group leaves drawn under its head once its rows have faded; nothing is drawn while the group stands open. */
  standing?: ReactNode;
  /** The head's hover hint, where the label alone does not say the whole of it. */
  tooltip?: string | undefined;
  /** The card the head hangs while the pointer rests on it, named by the label where no hint says more. */
  card?: ReactNode;
  /** How wide the surface is, which says where the count stands; wide, always. */
  surface?: GroupSurface;
  /** Whether the head sticks to the top of its scroller; it scrolls away unless it says so. */
  head?: GroupHead;
  /** How the rows stand, which a group in a grid hands on as a subgrid. */
  rows?: GroupRows;
  heading?: GroupHeading;
  /** Whether a menu the head opened stands, which keeps it ringed and its actions shown. */
  menuOpen?: boolean;
  /** The menu a right-click or a long press opens on the head (`useMenu`'s `contextMenu`). */
  contextMenu?: ContextMenuProps | undefined;
  /** The group's rows. */
  children?: ReactNode;
}): React.JSX.Element {
  const rowsId = useId();
  const folds = fold !== undefined;
  const { state, details } = useDisclosureFold(
    fold !== undefined && "defaultOpen" in fold ? fold.defaultOpen : true,
    fold !== undefined && "open" in fold ? fold : undefined,
  );
  // Note that a group with no rows draws no body, so its fold names none.
  const rows = (!folds || state.drawn) && said(children);
  const Heading = heading;
  // Note that a narrow column counts an open group only under the pointer, because its head has no room to spare for a figure at rest.
  const counted =
    count === undefined
      ? undefined
      : {
          ...count,
          shown:
            count.shown ??
            (surface === GROUP_SURFACE.NARROW && state.open
              ? NAV_COUNT_SHOWN.ON_HOVER
              : NAV_COUNT_SHOWN.ALWAYS),
        };
  const lead = <Lead glyph={glyph} folds={folds} label={label} mark={mark} count={counted} />;
  const hint = tooltip ?? (card === undefined || typeof label !== "string" ? undefined : label);
  // Note that only a head with a hint or a card is wrapped, because the tooltip hands its control a click handler of its own, which a head that folds nothing must not hear.
  const control = folds ? (
    <button
      type="button"
      className={`${PART.LEAD} ${PRESSED_AS_ROW.LEAD}`}
      aria-expanded={state.open}
      aria-controls={rows ? rowsId : undefined}
      onClick={pulseOnPress(state.toggle, PRESS_PULSE.QUIET)}
    >
      {lead}
    </button>
  ) : (
    <span className={PART.LEAD}>{lead}</span>
  );
  const subgrid = rowsStand === GROUP_ROWS.SUBGRID;
  const named = (
    <Heading className={`${PART.HEADING} ${search === undefined ? HEADING_SHARE : ""}`}>
      {hint === undefined ? (
        control
      ) : (
        <Tooltip label={hint} card={card}>
          {control}
        </Tooltip>
      )}
    </Heading>
  );
  return (
    <DisclosureScope state={state}>
      <div
        className={`luke-group-header min-w-0 ${subgrid ? SUBGRID.ROOT : ""}`}
        data-folds={folds ? "true" : undefined}
        data-head={head === GROUP_HEAD.STICKS ? head : undefined}
        data-rows={subgrid ? rowsStand : undefined}
        data-disclosure={folds ? details["data-disclosure"] : undefined}
      >
        <div
          className={[
            HEAD,
            folds ? PRESSED_AS_ROW.HEAD : "",
            head === GROUP_HEAD.STICKS ? STICKS : "",
            subgrid ? SUBGRID.HEAD : "",
          ].join(" ")}
          data-menu-open={menuOpen ? "true" : undefined}
          {...withContextMenu<HTMLDivElement>(contextMenu, {})}
        >
          {search === undefined ? named : <FoldingSearch {...search}>{named}</FoldingSearch>}
          {said(actions) ? (
            <span className={PART.ACTIONS} data-shown={actionsShown}>
              {actions}
            </span>
          ) : null}
        </div>
        {/* Note that the rows are the root's own child, the body disclosure.css unrolls and fades. */}
        {rows ? (
          <div
            ref={folds ? state.body : undefined}
            id={rowsId}
            className={`luke-disclosure-body ${subgrid ? SUBGRID.BODY : ""}`}
            data-inset="none"
            inert={folds && state.leaving}
          >
            {children}
          </div>
        ) : null}
        {folds && !state.drawn && said(standing) ? standing : null}
      </div>
    </DisclosureScope>
  );
}
