import { SELECTION_WORDS } from "@luke/features/words";
import {
  type ComponentType,
  createContext,
  type FocusEventHandler,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEventHandler,
  type ReactElement,
  type ReactNode,
  type RefCallback,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
} from "react";
import { cssCustomProperties } from "../../css.js";
import { ChevronRightIcon } from "../../face/glyphs.js";
import { PRESS_PULSE, pulseOnPress, pulsePress } from "../../press-pulse.js";
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
import { useRowSwipe } from "./use-row-swipe.js";

export type { ListRowMenu } from "../row-menu/row-menu.js";
export type { ListSelection } from "../selection/list-selection.js";

/**
 * list-row.tsx -- a List of rows, each a thing a collection holds: its title, a line under it, its metadata at the end, and the acts it offers beside it.
 *
 * A row is one line of the list: a leading mark, its title over its
 * description, and its metadata ("2h ago", "Owner") standing at the end, all
 * centred on the row's middle, and the row's own acts centred there beside
 * them, so a column of rows lines its metadata and its acts up whatever each
 * one says. A long title gives way rather than pushing either out of the row.
 *
 * A row that opens something is a button, `onPress`, named by its words in
 * the order they are drawn, title first, so a voice saying what it reads
 * presses it. Its acts are that button's siblings in the row's item, never
 * inside it, because a button holds no button: each is a control of its own,
 * reached by Tab after the row and pressed without pressing the row. A row
 * that opens nothing is no control at all. The leading mark is decoration,
 * hidden from a reader, since the title says what the row is. The row owns
 * every length in it and takes no class or style.
 *
 * A keyboard-driven list (arrows or j/k between rows, a key to act on the
 * one focused) reaches a row's press through `ref` and hears the keys
 * pressed on it through `onKeyDown`; a row that opens nothing takes no
 * focus, so its `ref` reaches its item, to scroll or measure, and it hears
 * no keys, which would only be its acts'.
 *
 * A row whose thing has acts of its own offers them as one menu (`menu`),
 * which every door to it opens alike: its ⋯ (`MoreButton`), the last of the
 * row's acts, drops it from the ⋯; a right-click or a touch's long press
 * anywhere on the row hangs it at the pointer; and the menu key or ⇧F10,
 * pressed on the row or any of its acts, hangs it under the row from its
 * start. The ⋯ is a Tab stop after the row's other acts, so the keyboard
 * reaches it as it reaches them, and named for the row's thing, "Task
 * actions", described by the row's title, so a reader hears which row's it
 * is. It keeps its place at the row's end and shows while the pointer
 * rests on the row, the row holds the keyboard, or its menu is open, and
 * always on a screen with no hover, where nothing would reveal it. Its menu
 * open rings the row; Escape hands focus back to the door it was opened
 * from: the ⋯, what held the keyboard as the menu key was pressed, or, for
 * a right-click, the row's press, or its ⋯ where it opens nothing. A row
 * that offers no acts now, its groups empty, or is unavailable, draws no ⋯
 * and opens nothing.
 * `menu` is the one way a row wires its menu: a row never opens one by a
 * right-click it wires itself.
 *
 * A list stands plain, its rows apart on the ground, each lit on its own;
 * or as a card (`LIST_VARIANT.CARD`), its rows edge to edge on the card's
 * ground with a hairline between each and the next, as a settings section's
 * card holds its rows. A dense column, a narrow panel's history, sets its
 * rows compact (`LIST_DENSITY.COMPACT`), a few pixels shorter and closer to
 * their edges, the words unchanged; a sidebar's column sets them dense
 * (`LIST_DENSITY.DENSE`), each one line a control's height, its title in the
 * body's type with its description after it on the same line, as a Mac's
 * sidebar lists. A row standing in a list of the app's own, one whose rows
 * the app drags, takes its density itself. A sidebar's row rests its title
 * in the sidebar's quieter ink (`LIST_ROW_INK.SIDEBAR`), lifted to the
 * text's own while the row is hovered, open, unread, or its menu is open.
 *
 * Acts offered only to the row in hand also stand while its menu is open,
 * and a row that offers none keeps its metadata in their place. A row whose menu is open (`menuOpen`) is ringed, as Finder rings
 * the row a right-click is about, so the menu is plainly about it. A row that goes somewhere deeper wears a
 * chevron at its end (`chevron`). A row whose press must leave the focus
 * where it is, on a search field beside the list that holds the keys, keeps
 * it (`keepFocus`), as a Button does. A `List`'s rows are one Tab stop, the
 * arrows walking them; one whose list steers it by keys of its own says
 * whether it is a Tab stop itself (`tabbable`), takes the focus it is
 * handed, and is left out of the arrows' walk, and
 * one a field drives names its item by `id`, the field's active row. A row
 * unavailable (`disabled`) refuses its press and leaves the tab order, as a
 * deleting row's does. Where an app hints a row's whole title only when it
 * is cut short, the row says whether it is (`onTitleClipped`), measured
 * whenever its box resizes.
 *
 * The open row is current in one of two ways (`LIST_ROW_CURRENT`): the page
 * shown beside the list, as an Inbox's item is, or the one item chosen in
 * its set. An unread row's title stands in the heavier weight, and its
 * description in the body's ink, until it is read, as a mail app's unread
 * thread does. A row whose thing is done with stands back (`muted`), as a
 * done to-do grays: its words in the palette's quieter inks, still legible,
 * and only its marks faded, its fill as the row's own. A row that opens
 * something may hang the app's hint from its press
 * (`hint`), as a Button's hint hangs: the app's own tooltip, handed the
 * words to raise and the press it wraps, whose pointer and focus handlers
 * land on the press itself.
 *
 * A row may carry attachments (`attachments`), what its thing holds drawn
 * small on a line of their own under its description, as a mail app shows
 * a thread's pictures under its preview; they are decoration, the row's
 * words saying what it is.
 *
 * A row's metadata stands at its middle, or, in a list read as a mail
 * app's is (`LIST_ROW_META.TITLE`), at the end of its title's line, the
 * description running the row's whole width under both and its leading
 * mark level with the title. A row's acts stand beside it, or, in a list
 * that offers them only to the row in hand (`LIST_ROW_ACTIONS.HOVER`), in
 * its metadata's place while the pointer rests on it or it holds the
 * keyboard, the metadata stepping aside as a sidebar row's time does for
 * Pin and Archive. While they stand, the row makes room for them beside its
 * words, so they cover nothing and the press keeps its ring; at rest, where
 * there is a hover, they take none, so the title runs to the metadata and
 * is cut anew before them as they come, and the row's ⋯ comes with them, in
 * the metadata's place, keeping no room of its own. A row with a ⋯ and no
 * acts offers its ⋯ the same way, so its metadata ends where its
 * neighbours' does.
 *
 * A title cut short, there or anywhere, fades out over its last few pixels
 * instead of ending in an ellipsis, as a browser's tab does; one drawn
 * whole ends on its last letter. A dense
 * row's description, a label beside its title, fades the same way, and so
 * does the name of what a row belongs to (`lead`), while a fuller row's
 * description, a preview's prose, and its metadata end in an ellipsis.
 *
 * A row may lead its description with what it belongs to (`lead`), a
 * thread's task, say, in a list grouped by something else: a small chip
 * of a glyph and a name, cut short at a short name's width, the
 * description's words following it on the same line, as a mail app tags a
 * thread with its mailbox. A fuller row may stand it on a line of its own
 * instead (`LIST_ROW_LEAD.LINE`), between its title and its description,
 * its glyph and its whole name in the description's quieter ink, as a
 * mail app names a thread's sender over its preview, so neither the name
 * nor the preview is cut short to make room for the other. A fuller row
 * that keeps to two lines may lead its description with the plain words
 * instead (`LIST_ROW_LEAD.INLINE`), its glyph and its whole name in the
 * description's ink, a middle dot, then the description, as a two-line
 * row of its own kind reads its one quiet line.
 *
 * A row may be swiped right to one act (`swipe`), as a mail app's thread
 * is swiped to mark it read: a short swipe leaves it open on the act's
 * button, a long one does the act on release (`use-row-swipe.ts`). The
 * swipe is the pointer's and the trackpad's alone; the act it does is one
 * the row offers another way too, so the button takes no Tab stop.

 */

/** How the open row is current: the page shown beside the list, or the item chosen in its set. */
export const LIST_ROW_CURRENT = {
  PAGE: "page",
  ITEM: "true",
} as const;

export type ListRowCurrent = (typeof LIST_ROW_CURRENT)[keyof typeof LIST_ROW_CURRENT];

/** Where a row's metadata stands: at the row's middle, or at the end of its title's line. */
export const LIST_ROW_META = {
  MIDDLE: "middle",
  TITLE: "title",
} as const;

export type ListRowMeta = (typeof LIST_ROW_META)[keyof typeof LIST_ROW_META];

/** When a row's acts stand: always, beside it, or in its metadata's place only while the row is in hand. */
export const LIST_ROW_ACTIONS = {
  ALWAYS: "always",
  HOVER: "hover",
} as const;

export type ListRowActions = (typeof LIST_ROW_ACTIONS)[keyof typeof LIST_ROW_ACTIONS];

/** Where what a row belongs to stands: a chip leading its description's line, its plain words leading that line, or a line of its own over the description. */
export const LIST_ROW_LEAD = {
  DESCRIPTION: "description",
  INLINE: "inline",
  LINE: "line",
} as const;

export type ListRowLeadAt = (typeof LIST_ROW_LEAD)[keyof typeof LIST_ROW_LEAD];

/** A row's one swipe: what its act is called, its glyph, and the act. */
export interface ListRowSwipe {
  readonly label: string;
  readonly icon: ReactNode;
  readonly onAct: () => void;
}

/** What a row belongs to, as the chip before its description names it: its glyph and its name. */
export interface ListRowLead {
  readonly icon: ReactNode;
  readonly label: string;
}

/** What a hint hands the press it wraps: when to show and go, and what it says of the press. */
interface ListRowHintProps {
  "aria-describedby"?: string | undefined;
  "aria-keyshortcuts"?: string | undefined;
  onPointerEnter?: PointerEventHandler<HTMLElement> | undefined;
  onPointerLeave?: PointerEventHandler<HTMLElement> | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  onFocus?: FocusEventHandler<HTMLElement> | undefined;
  onBlur?: FocusEventHandler<HTMLElement> | undefined;
}

/** The app's hint a row's press hangs: its words, and the press it wraps. */
export type ListRowHint = ComponentType<{
  label: string | undefined;
  children: ReactElement<ListRowHintProps>;
}>;

/** How a list stands: its rows apart on the ground, or edge to edge in a card. */
export const LIST_VARIANT = {
  PLAIN: "plain",
  CARD: "card",
} as const;

export type ListVariant = (typeof LIST_VARIANT)[keyof typeof LIST_VARIANT];

/** How much room a list's rows keep around their words. */
export const LIST_DENSITY = {
  REGULAR: "regular",
  COMPACT: "compact",
  DENSE: "dense",
} as const;

export type ListDensity = (typeof LIST_DENSITY)[keyof typeof LIST_DENSITY];

/** The ink a row's title rests in: the text's own, or a sidebar's quieter one, lifted to the text's while the row is reached for, open, or unread. */
export const LIST_ROW_INK = {
  TEXT: "text",
  SIDEBAR: "sidebar",
} as const;

export type ListRowInk = (typeof LIST_ROW_INK)[keyof typeof LIST_ROW_INK];

/**
 * A list's and a row's own boxes, in utilities over the theme. What its
 * state restyles stays in `list-row.css`: the row's fill and ring, the
 * press's insets and height, which a variant, a density, or the acts beside
 * it set, the words' type and ink, the hover acts' crossfade and the room
 * they take, the swipe's slide, and every reveal the pointer, the keyboard,
 * or a menu makes, through `:has()` and the pointer's media. Each part keeps
 * its `luke-list-row-*` class, which that sheet, the panel's, and the tests
 * find it by.
 */
const LIST_CLASS =
  "luke-list flex list-none flex-col gap-list-gap p-0 data-[variant=card]:gap-0 data-[variant=card]:overflow-hidden data-[variant=card]:rounded-control data-[variant=card]:border data-[variant=card]:border-border data-[variant=card]:bg-surface";

/** The row: a grid of five tracks, its parts centred on its middle, in the text's ink. */
const ROW_CLASS =
  "luke-list-row grid min-w-0 grid-cols-list-row items-center font-sans text-foreground transition-[background-color] duration-(--luke-duration-hover) ease-plain";

/** The press spans the mark, the words, and the end, its parts standing in the row's own tracks. */
const MAIN_CLASS =
  "luke-list-row-main col-[leading-start/end-end] row-1 m-0 grid min-w-0 grid-cols-subgrid items-center rounded-inherit border-0 bg-transparent text-start text-inherit [font:inherit]";

/** A press that is a button, pressed as a Mac's list is on the desktop, without the web's pointing hand. */
const MAIN_BUTTON_CLASS = `${MAIN_CLASS} cursor-press disabled:cursor-default`;

/**
 * The leading mark, muted, a glyph at a control's glyph size and an avatar
 * at its own; a provider's mark keeps the text's colour, a brand mark being
 * the provider's identity, not a muted glyph.
 */
const LEADING_CLASS =
  "luke-list-row-leading col-[leading] me-icon-gap inline-flex text-muted-foreground [&>.luke-provider-mark]:text-foreground [&>svg]:size-control-icon";

/** The row's end, its metadata and its chevron, at the end of its track, so it lines up with the acts that share it. */
const END_CLASS =
  "luke-list-row-end col-[end] ms-icon-gap flex min-w-0 items-center justify-self-end gap-icon-gap";

/** A chevron at the end of a row that goes deeper, its room kept so nothing moves as it shows. */
const CHEVRON_CLASS =
  "luke-list-row-chevron inline-flex flex-none text-muted-foreground transition-opacity duration-(--luke-duration-hover) ease-plain [&>svg]:size-luke-12";

/**
 * What a row belongs to: a small chip of a glyph and a name cut short at a
 * short name's width leading its description, the glyph and the name bare
 * leading it, or a line of its own between
 * its title and its description, its glyph and its whole name in the
 * description's quieter ink, with no chip round it.
 */
const LEAD_CLASS = {
  [LIST_ROW_LEAD.DESCRIPTION]:
    "luke-list-row-lead me-luke-4 inline-flex max-w-list-row-lead items-center gap-luke-2 rounded-luke-6 bg-fill-strong px-luke-4 py-0 align-bottom text-muted-foreground",
  [LIST_ROW_LEAD.INLINE]:
    "luke-list-row-lead inline-flex max-w-full items-center gap-luke-4 align-bottom text-muted-foreground",
  [LIST_ROW_LEAD.LINE]:
    "luke-list-row-lead flex items-center gap-luke-4 text-caption text-muted-foreground",
} as const satisfies Record<ListRowLeadAt, string>;

/** What stands between a lead's plain words and the description they lead. */
const LEAD_SEPARATOR = " · ";

/** The parts of a row swiped to its one act: the act's button under the face, its press, and the label riding the face's edge. */
const SWIPE_CLASS = "luke-list-row-swipe absolute inset-0 rounded-inherit";
const SWIPE_ACT_CLASS =
  "luke-list-row-swipe-act absolute inset-0 m-0 border-0 bg-transparent p-0 text-on-accent [font:inherit]";
const SWIPE_LABEL_CLASS =
  "luke-list-row-swipe-label absolute inset-y-0 start-0 flex w-swipe-label flex-col items-center justify-center gap-luke-2 text-tag-size font-tag [&>svg]:size-control-icon";
const SLIDE_CLASS =
  "luke-list-row-slide relative col-span-full row-1 grid min-w-0 grid-cols-subgrid items-center rounded-inherit";

/** A pointer's press that leaves the focus where it is. */
function preventFocusMove(event: MouseEvent<HTMLElement>): void {
  event.preventDefault();
}

/**
 * The words a slot is measured by, where they are a plain string: a box whose
 * words are a tree is watched for any change under it instead, which a long
 * list of rows would pay for once a row.
 */
function plainWords(words: ReactNode): string | undefined {
  // A slot is handed over as a loose ReactNode, and a string is the one form
  // whose words can be compared from render to render; this check is the boundary.
  return typeof words === "string" ? words : undefined;
}

/**
 * The density of the `List` a row stands in, which its rows take as the
 * stylesheet does, so a row knows it is dense in the render that draws it
 * rather than by reading where it stands once drawn.
 */
const ListDensityContext = createContext<ListDensity>(LIST_DENSITY.REGULAR);

/**
 * How the `List` a row stands in stands, so a row in a card, edge to edge
 * on the card's ground, answers a press inside its fill rather than pulling
 * that fill back from the card's edges.
 */
const ListVariantContext = createContext<ListVariant>(LIST_VARIANT.PLAIN);

/** The act of a row that offers no swipe. */
const NO_ACT = (): void => undefined;

/** Whether a slot says anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

/**
 * A list of `ListRow`s, named by `label` for a reader moving between lists.
 * One whose rows a finger opens (`fingerTall`) stands each a finger's press
 * tall on a coarse pointer, its words centred in it, as a call's line does
 * of its own; a mouse keeps the row's own height.
 *
 * The list is one Tab stop (`useRovingKeys`): Tab enters it at the row last
 * focused, or its first, ↑↓ walk its rows, wrapping at the ends, Home and
 * End go to the first and the last, and an unavailable row is passed over.
 * A row whose list steers it from elsewhere, a field holding the keys, says
 * whether it is a Tab stop itself (`tabbable`) and stays out of the walk.
 * A list standing among others under group heads, a rail's, may instead
 * join the walk of a box around them all (`joinsWalk`), so the rows of
 * every group are one Tab stop the arrows walk from first to last.
 *
 * A list asked to (`selection`) chooses rows at once, as a Mac's list does
 * (`list-selection.ts`): ⌘-click one in or out, ⇧-click a run from the
 * last one pressed, ⇧↑↓ grow the run from the row in hand, ⌘A every row,
 * and Esc none, while a plain press still opens its row. Each row takes
 * part by its key (`selectKey`), and one chosen is filled and described as
 * selected. A list not asked chooses nothing.
 */
export function List({
  id,
  label,
  variant = LIST_VARIANT.PLAIN,
  density = LIST_DENSITY.REGULAR,
  fingerTall = false,
  moves = false,
  joinsWalk = false,
  selection,
  children,
}: {
  /** The id of the list, which a `SelectionBar` over it names to hand it the focus back. */
  id?: string | undefined;
  label: string;
  variant?: ListVariant;
  density?: ListDensity;
  /** Whether each row stands a finger's press tall on a coarse pointer. */
  fingerTall?: boolean | undefined;
  /** Whether its rows move as they arrive, leave, and change places, under a `ListMotion` (`motionRows`). */
  moves?: boolean;
  /** Whether its rows join the walk of a `useRovingKeys` box around it, with the rows of the lists beside it, rather than walk alone. */
  joinsWalk?: boolean;
  /** Which rows are chosen and what hears the next set, where the list chooses rows at all. */
  selection?: ListSelection | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const roving = useRovingKeys<HTMLUListElement>();
  const chooser = useListSelection(selection);
  return (
    <ul
      {...(joinsWalk ? {} : roving)}
      onKeyDown={(event) => {
        if (!chooser.onKeyDown(event) && !joinsWalk) roving.onKeyDown(event);
      }}
      id={id}
      className={LIST_CLASS}
      {...selectionRoot()}
      data-variant={variant}
      data-density={density}
      data-finger-tall={fingerTall ? "true" : undefined}
      aria-label={label}
      {...(moves ? motionRows() : {})}
    >
      <ListVariantContext.Provider value={variant}>
        <ListDensityContext.Provider value={density}>
          <ListSelectionContext.Provider value={chooser.selecting}>
            {children}
          </ListSelectionContext.Provider>
        </ListDensityContext.Provider>
      </ListVariantContext.Provider>
    </ul>
  );
}

/** One row of a `List`: `title` over `description`, `meta` at its end, `actions` beside it. */
export function ListRow({
  leading,
  title,
  description,
  lead,
  leadAt = LIST_ROW_LEAD.DESCRIPTION,
  attachments,
  meta,
  metaAt = LIST_ROW_META.MIDDLE,
  actions,
  actionsAt = LIST_ROW_ACTIONS.ALWAYS,
  onPress,
  linkHref,
  current,
  unread,
  muted,
  hint,
  density,
  ink = LIST_ROW_INK.TEXT,
  menuOpen = false,
  chevron = false,
  keepFocus = false,
  disabled = false,
  tabbable,
  onTitleClipped,
  id,
  selectKey,
  motionKey: followedBy,
  ref,
  onKeyDown,
  menu,
  swipe,
}: {
  /** A mark before the title (an avatar, a status's glyph), drawn as decoration. */
  leading?: ReactNode;
  /** What the row is, which its name opens with. */
  title: ReactNode;
  description?: ReactNode;
  /** What the row belongs to, drawn as a chip of its glyph and its name before the description, on its line. */
  lead?: ListRowLead | undefined;
  /** Where the lead stands: a chip before the description, on its line, or a line of its own between the title and the description. */
  leadAt?: ListRowLeadAt | undefined;
  /** What the row's thing carries, its pictures or pages drawn small, on a line of their own under the description; decoration, since its words say what it is. */
  attachments?: ReactNode;
  /** Metadata at the row's end, before its acts ("2h ago", "Owner"). */
  meta?: ReactNode;
  /** Where the metadata stands: at the row's middle, or at the end of the title's line. */
  metaAt?: ListRowMeta;
  /** The row's own acts (an IconButton, a Button), each a control beside the row's press. */
  actions?: ReactNode;
  /** When the acts stand: always, beside the row, or over its metadata's end while the row is hovered or holds the keyboard. */
  actionsAt?: ListRowActions;
  /** What pressing the row does, handed the press, whose modifiers it may read; a row without one is not a control. */
  onPress?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  /** The address its press opens, where it opens one, which a right-click offers as a link's (`useLinkAddress`). */
  linkHref?: string | undefined;
  /** How the row is the one open now, drawn and announced as current; nothing where it is not. */
  current?: ListRowCurrent | undefined;
  /** Whether what the row stands for has not been seen, its title in the heavier weight. */
  unread?: boolean | undefined;
  /** Whether what the row stands for is done with, so the row stands back, its words in quieter inks and its marks faded, its fill and acts as they are. */
  muted?: boolean | undefined;
  /** The app's hint hung from the row's press and the words it raises; a row that opens nothing raises none. */
  hint?: { readonly Hint: ListRowHint; readonly label: string } | undefined;
  /** Its density where it stands in a list of the app's own rather than a `List`, which sets its rows'. */
  density?: ListDensity | undefined;
  /** The ink its title rests in. */
  ink?: ListRowInk | undefined;
  /** Whether the row's own menu is open, which rings it and keeps its acts shown. */
  menuOpen?: boolean | undefined;
  /** Whether a chevron at its end says the press goes somewhere deeper. */
  chevron?: boolean | undefined;
  /** Whether a pointer's press leaves the focus where it is, as on a field beside the list that holds the keys. */
  keepFocus?: boolean | undefined;
  /** Whether its press is unavailable: refused and out of the tab order. */
  disabled?: boolean | undefined;
  /** Whether Tab stops on its press, said where something other than its `List` steers its rows, which leaves it out of the list's arrows; one that is not still takes the focus it is handed. Left out, its `List` keeps one row a Tab stop and walks the rest with the arrows. */
  tabbable?: boolean | undefined;
  /** Hears whether the title is cut short, whenever that changes, so a hint can say it whole only then. */
  onTitleClipped?: ((clipped: boolean) => void) | undefined;
  /** The id of the row's item, which a field driving the list names as its active row. */
  id?: string | undefined;
  /** What the row is chosen by in a `List` that chooses rows (`selection`); a row with none is never chosen. */
  selectKey?: string | undefined;
  /** The key a `ListMotion` follows the row by, out of one list and into another (`motionKey`). */
  motionKey?: string | undefined;
  /** Handed the row's press, or its item where it opens nothing. A callback, so one list keeps each row's by its own key. */
  ref?: RefCallback<HTMLElement> | undefined;
  /** A key pressed on the row's press; a row that opens nothing hears none. */
  onKeyDown?: ((event: KeyboardEvent<HTMLElement>) => void) | undefined;
  /** The menu of the row's thing's acts, opened alike by its ⋯, a right-click, a long press, and the menu key; it takes `menuOpen`'s place. */
  menu?: ListRowMenu | undefined;
  /** The row's one swipe right; none where it offers none. */
  swipe?: ListRowSwipe | undefined;
}): React.JSX.Element {
  const swiped = useRowSwipe(swipe?.label, swipe?.onAct ?? NO_ACT);
  // The press hands the row's ref its element, and the link menu the address it opens.
  const linkAddress = useLinkAddress(linkHref);
  const pressElement = useRef<HTMLButtonElement | null>(null);
  const pressRef = useCallback(
    (element: HTMLButtonElement | null) => {
      pressElement.current = element;
      ref?.(element);
      linkAddress(element);
    },
    [ref, linkAddress],
  );
  const titleId = useId();
  const rowMenu = useRowMenu(menu, { disabled, opener: onPress ? pressElement : undefined });
  const offered = rowMenu.offered;
  const [titleMeasured, titleClipped] = useClipped(plainWords(title));
  useEffect(() => {
    onTitleClipped?.(titleClipped);
  }, [onTitleClipped, titleClipped]);
  const [descriptionMeasured, descriptionClipped] = useClipped(plainWords(description));
  // Note that only a dense row's description fades, so a fuller row's prose
  // is never measured; the row is dense by its own density, else its list's,
  // as the stylesheet reads it, so a list made dense or regular again
  // measures its rows' descriptions or lets them go.
  const listDensity = useContext(ListDensityContext);
  const pressPulse =
    useContext(ListVariantContext) === LIST_VARIANT.CARD ? PRESS_PULSE.FLUSH : PRESS_PULSE.QUIET;
  const describedDense = (density ?? listDensity) === LIST_DENSITY.DENSE;
  const selecting = useContext(ListSelectionContext);
  const choosable = selecting !== undefined && selectKey !== undefined;
  const chosen = choosable && selecting.selected.has(selectKey);
  const described = useCallback(
    (element: HTMLElement | null) => {
      if (element === null || !describedDense) return undefined;
      return descriptionMeasured(element);
    },
    [descriptionMeasured, describedDense],
  );
  const [leadMeasured, leadClipped] = useClipped(lead?.label);
  const heading = (
    <span
      ref={titleMeasured}
      id={offered ? titleId : undefined}
      className="luke-list-row-title"
      data-overflow={String(titleClipped)}
    >
      {title}
    </span>
  );
  // Note that the metadata and the chevron stand together at the row's end,
  // the place a hover row's acts step into.
  const end =
    said(meta) || chevron ? (
      <span className={END_CLASS}>
        {said(meta) ? <span className="luke-list-row-meta">{meta}</span> : null}
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
          className="luke-list-row-lead-icon inline-flex flex-none [&>svg]:size-caption-glyph"
          aria-hidden="true"
        >
          {lead.icon}
        </span>
        <span
          ref={leadMeasured}
          className="luke-list-row-lead-label min-w-0 overflow-hidden whitespace-nowrap"
          data-overflow={String(leadClipped)}
        >
          {lead.label}
        </span>
      </span>
    );
  const face = (
    <>
      {said(leading) ? (
        <span className={LEADING_CLASS} aria-hidden="true">
          {leading}
        </span>
      ) : null}
      <span className="luke-list-row-text col-[text] min-w-0">
        {metaAt === LIST_ROW_META.TITLE ? (
          <span className="luke-list-row-head">
            {heading}
            {end}
          </span>
        ) : (
          heading
        )}
        {leadAt === LIST_ROW_LEAD.LINE ? leadMark : null}
        {said(description) || (leadAt !== LIST_ROW_LEAD.LINE && lead !== undefined) ? (
          <span
            ref={described}
            className="luke-list-row-description"
            data-overflow={describedDense ? String(descriptionClipped) : undefined}
          >
            {leadAt === LIST_ROW_LEAD.LINE ? null : leadMark}
            {leadAt === LIST_ROW_LEAD.INLINE && lead !== undefined && said(description)
              ? LEAD_SEPARATOR
              : null}
            {description}
          </span>
        ) : null}
        {said(attachments) ? (
          <span
            className="luke-list-row-attachments flex gap-luke-6 overflow-hidden"
            aria-hidden="true"
          >
            {attachments}
          </span>
        ) : null}
      </span>
      {metaAt === LIST_ROW_META.TITLE ? null : end}
    </>
  );
  const press = onPress ? (
    <button
      ref={pressRef}
      type="button"
      className={MAIN_BUTTON_CLASS}
      aria-current={current}
      aria-description={chosen ? SELECTION_WORDS.SELECTED : undefined}
      disabled={disabled}
      tabIndex={tabbable === false ? -1 : undefined}
      {...(tabbable === undefined ? rovingItem() : {})}
      {...(choosable ? selectableRow(selectKey) : {})}
      // Note that the focus moves as a mousedown's default, so refusing it there is what keeps it.
      onMouseDown={keepFocus ? preventFocusMove : choosable ? holdRun : undefined}
      onClick={(event) => {
        // Note that the row around the press is what is pressed, its fill and its actions with it.
        const row = event.currentTarget.closest<HTMLElement>(".luke-list-row");
        pulsePress(row ?? event.currentTarget, pressPulse);
        // Note that a right-click's menu holds the press as its opener, which its outside press leaves alone, so the press closes it.
        if (rowMenu.open) rowMenu.close(false);
        if (choosable && selecting.press(selectKey, event)) return;
        onPress(event);
      }}
      onKeyDown={onKeyDown}
    >
      {face}
    </button>
  ) : undefined;
  const row = (
    <>
      {press === undefined ? (
        <div className={MAIN_CLASS} aria-current={current}>
          {face}
        </div>
      ) : hint === undefined ? (
        press
      ) : (
        <hint.Hint label={hint.label}>{press}</hint.Hint>
      )}
      {said(actions) ? (
        <div className="luke-list-row-actions row-1 flex items-center gap-luke-4">{actions}</div>
      ) : null}
      {offered ? (
        <div className="luke-list-row-more row-1 flex items-center">
          {rowMenu.button({
            size:
              (density ?? listDensity) === LIST_DENSITY.REGULAR ? undefined : BUTTON_SIZE.COMPACT,
            describedBy: titleId,
          })}
        </div>
      ) : null}
    </>
  );
  const { view, item } = swiped;
  // Note that a row whose only act is its ⋯ offers it as a hover row offers its acts, so no row keeps an empty ⋯ track at rest.
  const actsOnHover = actionsAt === LIST_ROW_ACTIONS.HOVER || (offered && !said(actions));
  const hold = (element: HTMLLIElement | null) => {
    item.ref.current = element;
    if (!onPress) ref?.(element);
  };
  return (
    <>
      <li
        id={id}
        {...(followedBy === undefined ? {} : motionKey(followedBy))}
        ref={swipe === undefined ? (onPress ? undefined : ref) : hold}
        className={ROW_CLASS}
        data-meta={metaAt === LIST_ROW_META.TITLE ? metaAt : undefined}
        data-actions={actsOnHover ? LIST_ROW_ACTIONS.HOVER : undefined}
        data-current={current === undefined ? undefined : "true"}
        data-selected={chosen ? "true" : undefined}
        data-unread={unread === true ? "true" : undefined}
        data-muted={muted === true ? "true" : undefined}
        data-density={density}
        data-ink={ink}
        data-menu-open={menuOpen || rowMenu.open ? "true" : undefined}
        data-swipe={swipe === undefined ? undefined : view.state}
        data-armed={view.armed ? "true" : undefined}
        onKeyDown={rowMenu.onKeyDown}
        {...withContextMenu(
          rowMenu.doors,
          swipe === undefined ? {} : { onPointerDown: item.onPointerDown },
        )}
        {...(swipe === undefined
          ? undefined
          : {
              onPointerMove: item.onPointerMove,
              onPointerUp: item.onPointerUp,
              onPointerCancel: item.onPointerCancel,
              onClickCapture: item.onClickCapture,
              style: cssCustomProperties({
                "--luke-list-row-swipe": `${view.offset}px`,
                "--luke-list-row-swipe-label": `${view.label.offset}px`,
                "--luke-list-row-swipe-shown": view.label.opacity,
              }),
            })}
      >
        {swipe === undefined ? (
          row
        ) : (
          <>
            <div className={SWIPE_CLASS}>
              <button
                type="button"
                className={SWIPE_ACT_CLASS}
                tabIndex={-1}
                data-swipe-act=""
                onClick={pulseOnPress(swiped.onPress)}
              >
                <span className={SWIPE_LABEL_CLASS}>
                  {swipe.icon}
                  <span>{swipe.label}</span>
                </span>
              </button>
            </div>
            <div className={SLIDE_CLASS}>{row}</div>
          </>
        )}
      </li>
      {/* Note that the menu stands beside the row rather than in it, because a
          press or a key in the menu's portal would otherwise reach the row's
          own handlers, a long press on an item opening the menu again. */}
      {rowMenu.popup}
    </>
  );
}
