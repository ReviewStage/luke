import type {
  ComponentType,
  FocusEventHandler,
  KeyboardEvent,
  MouseEvent,
  PointerEventHandler,
  ReactElement,
  ReactNode,
  RefCallback,
} from "react";
import { cssCustomProperties } from "../../css.js";
import { useRowSwipe } from "./use-row-swipe.js";

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
 * no keys, which would only be its acts'. `onContextMenu` hears a
 * right-click anywhere on the row, its acts included, so the app can open
 * its own menu there.
 *
 * The open row is current in one of two ways (`LIST_ROW_CURRENT`): the page
 * shown beside the list, as an Inbox's item is, or the one item chosen in
 * its set. An unread row's title stands in the heavier weight, and its
 * description in the body's ink, until it is read, as a mail app's unread
 * thread does. A row that opens something may hang the app's hint from its press
 * (`hint`), as a Button's hint hangs: the app's own tooltip, handed the
 * words to raise and the press it wraps, whose pointer and focus handlers
 * land on the press itself.
 *
 * A row's metadata stands at its middle, or, in a list read as a mail
 * app's is (`LIST_ROW_META.TITLE`), at the end of its title's line, the
 * description running the row's whole width under both and its leading
 * mark level with the title. A row's acts stand beside it, or, in a list
 * that offers them only to the row in hand (`LIST_ROW_ACTIONS.HOVER`), over
 * its metadata's end while the pointer rests on it or it holds the
 * keyboard, the metadata stepping aside as a sidebar row's time does for
 * Pin and Archive.
 *
 * A row may be swiped right to one act (`swipe`), as a mail app's thread
 * is swiped to mark it read: a short swipe leaves it open on the act's
 * button, a long one does the act on release (`use-row-swipe.ts`). The
 * swipe is the pointer's and the trackpad's alone; the act it does is one
 * the row offers another way too, so the button takes no Tab stop.
 *
 * A list stands plain, its rows apart on the ground, each lit on its own;
 * or as a card (`LIST_VARIANT.CARD`), its rows edge to edge on the card's
 * ground with a hairline between each and the next, as a settings section's
 * card holds its rows. A dense column, a narrow panel's history, sets its
 * rows compact (`LIST_DENSITY.COMPACT`), a few pixels shorter and closer to
 * their edges, the words unchanged.
 */

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
} as const;

export type ListDensity = (typeof LIST_DENSITY)[keyof typeof LIST_DENSITY];

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

/** When a row's acts stand: always, beside it, or over its metadata's end only while the row is in hand. */
export const LIST_ROW_ACTIONS = {
  ALWAYS: "always",
  HOVER: "hover",
} as const;

export type ListRowActions = (typeof LIST_ROW_ACTIONS)[keyof typeof LIST_ROW_ACTIONS];

/** A row's one swipe: what its act is called, its glyph, and the act. */
export interface ListRowSwipe {
  readonly label: string;
  readonly icon: ReactNode;
  readonly onAct: () => void;
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

/** The act of a row that offers no swipe. */
const NO_ACT = (): void => undefined;

/** Whether a slot says anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

/** A list of `ListRow`s, named by `label` for a reader moving between lists. */
export function List({
  label,
  variant = LIST_VARIANT.PLAIN,
  density = LIST_DENSITY.REGULAR,
  children,
}: {
  label: string;
  variant?: ListVariant;
  density?: ListDensity;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <ul className="luke-list" data-variant={variant} data-density={density} aria-label={label}>
      {children}
    </ul>
  );
}

/** One row of a `List`: `title` over `description`, `meta` at its end, `actions` beside it. */
export function ListRow({
  leading,
  title,
  description,
  meta,
  metaAt = LIST_ROW_META.MIDDLE,
  actions,
  actionsAt = LIST_ROW_ACTIONS.ALWAYS,
  onPress,
  current,
  unread,
  hint,
  ref,
  onKeyDown,
  onContextMenu,
  swipe,
}: {
  /** A mark before the title (an avatar, a status's glyph), drawn as decoration. */
  leading?: ReactNode;
  /** What the row is, which its name opens with. */
  title: ReactNode;
  description?: ReactNode;
  /** Metadata at the row's end, before its acts ("2h ago", "Owner"). */
  meta?: ReactNode;
  /** Where the metadata stands: at the row's middle, or at the end of the title's line. */
  metaAt?: ListRowMeta;
  /** The row's own acts (an IconButton, a Button), each a control beside the row's press. */
  actions?: ReactNode;
  /** When the acts stand: always, beside the row, or over its metadata's end while the row is hovered or holds the keyboard. */
  actionsAt?: ListRowActions;
  /** What pressing the row does; a row without one is not a control. */
  onPress?: (() => void) | undefined;
  /** How the row is the one open now, drawn and announced as current; nothing where it is not. */
  current?: ListRowCurrent | undefined;
  /** Whether what the row stands for has not been seen, its title in the heavier weight. */
  unread?: boolean | undefined;
  /** The app's hint hung from the row's press and the words it raises; a row that opens nothing raises none. */
  hint?: { readonly Hint: ListRowHint; readonly label: string } | undefined;
  /** Handed the row's press, or its item where it opens nothing. A callback, so one list keeps each row's by its own key. */
  ref?: RefCallback<HTMLElement> | undefined;
  /** A key pressed on the row's press; a row that opens nothing hears none. */
  onKeyDown?: ((event: KeyboardEvent<HTMLElement>) => void) | undefined;
  /** A right-click, or the menu key, anywhere on the row. */
  onContextMenu?: ((event: MouseEvent<HTMLElement>) => void) | undefined;
  /** The row's one swipe right; none where it offers none. */
  swipe?: ListRowSwipe | undefined;
}): React.JSX.Element {
  const swiped = useRowSwipe(swipe?.label, swipe?.onAct ?? NO_ACT);
  const heading = <span className="luke-list-row-title">{title}</span>;
  const metadata = said(meta) ? <span className="luke-list-row-meta">{meta}</span> : null;
  const face = (
    <>
      {said(leading) ? (
        <span className="luke-list-row-leading" aria-hidden="true">
          {leading}
        </span>
      ) : null}
      <span className="luke-list-row-text">
        {metaAt === LIST_ROW_META.TITLE ? (
          <span className="luke-list-row-head">
            {heading}
            {metadata}
          </span>
        ) : (
          heading
        )}
        {said(description) ? (
          <span className="luke-list-row-description">{description}</span>
        ) : null}
      </span>
      {metaAt === LIST_ROW_META.TITLE ? null : metadata}
    </>
  );
  const press = onPress ? (
    <button
      ref={ref}
      type="button"
      className="luke-list-row-main"
      aria-current={current}
      onClick={onPress}
      onKeyDown={onKeyDown}
    >
      {face}
    </button>
  ) : undefined;
  const row = (
    <>
      {press === undefined ? (
        <div className="luke-list-row-main" aria-current={current}>
          {face}
        </div>
      ) : hint === undefined ? (
        press
      ) : (
        <hint.Hint label={hint.label}>{press}</hint.Hint>
      )}
      {said(actions) ? <div className="luke-list-row-actions">{actions}</div> : null}
    </>
  );
  const { view, item } = swiped;
  const hold = (element: HTMLLIElement | null) => {
    item.ref.current = element;
    if (!onPress) ref?.(element);
  };
  return (
    <li
      ref={swipe === undefined ? (onPress ? undefined : ref) : hold}
      className="luke-list-row"
      data-meta={metaAt === LIST_ROW_META.TITLE ? metaAt : undefined}
      data-actions={actionsAt === LIST_ROW_ACTIONS.HOVER ? actionsAt : undefined}
      data-current={current === undefined ? undefined : "true"}
      data-unread={unread === true ? "true" : undefined}
      data-swipe={swipe === undefined ? undefined : view.state}
      data-armed={view.armed ? "true" : undefined}
      onContextMenu={onContextMenu}
      {...(swipe === undefined
        ? undefined
        : {
            onPointerDown: item.onPointerDown,
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
          <div className="luke-list-row-swipe">
            <button
              type="button"
              className="luke-list-row-swipe-act"
              tabIndex={-1}
              data-swipe-act=""
              onClick={swiped.onPress}
            >
              <span className="luke-list-row-swipe-label">
                {swipe.icon}
                <span>{swipe.label}</span>
              </span>
            </button>
          </div>
          <div className="luke-list-row-slide">{row}</div>
        </>
      )}
    </li>
  );
}
