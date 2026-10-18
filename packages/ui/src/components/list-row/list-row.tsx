import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefCallback,
  useEffect,
} from "react";
import { ChevronRightIcon } from "../../face/glyphs.js";
import { useClipped } from "../../use-clipped.js";

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
 * A row's acts stand beside it always, or only while the pointer is on the
 * row, it holds the keyboard, or its menu is open (`ACTIONS_SHOWN.ON_HOVER`),
 * laid over its metadata's place, which steps out for them, so a column of
 * rows keeps its times until one is reached for, as a Mac's sidebar keeps
 * them. A row whose menu is open (`menuOpen`) stays lit as the pointer lights
 * it, so the menu is seen to be its. A row that goes somewhere deeper wears a
 * chevron at its end (`chevron`). A row whose press must leave the focus
 * where it is, on a search field beside the list that holds the keys, keeps
 * it (`keepFocus`), as a Button does; one of a roving list, which the
 * keyboard enters at its current row and moves through by its own keys, is
 * out of the tab order and takes the focus it is handed (`tabbable`), and
 * one a field drives names its item by `id`, the field's active row. A row unavailable (`disabled`) refuses
 * its press and leaves the tab order, as a deleting row's does. Where an
 * app hints a row's whole title only when it is cut short, the row says
 * whether it is (`onTitleClipped`), measured whenever its box resizes.
 */

/** Whether a row's acts stand beside it always, or only while it is reached for, in its metadata's place. */
export const ACTIONS_SHOWN = {
  ALWAYS: "always",
  ON_HOVER: "on-hover",
} as const;

export type ActionsShown = (typeof ACTIONS_SHOWN)[keyof typeof ACTIONS_SHOWN];

/** A pointer's press that leaves the focus where it is. */
function preventFocusMove(event: MouseEvent<HTMLElement>): void {
  event.preventDefault();
}

/** Tells `onTitleClipped` whether the title is cut short, measuring it only where someone asks. */
function useTitleClipped(
  onTitleClipped: ((clipped: boolean) => void) | undefined,
): RefCallback<HTMLElement> | undefined {
  const [measured, clipped] = useClipped();
  useEffect(() => onTitleClipped?.(clipped), [onTitleClipped, clipped]);
  return onTitleClipped === undefined ? undefined : measured;
}

/** Whether a slot says anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

/** A list of `ListRow`s, named by `label` for a reader moving between lists. */
export function List({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <ul className="luke-list" aria-label={label}>
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
  actions,
  onPress,
  current,
  actionsShown = ACTIONS_SHOWN.ALWAYS,
  menuOpen = false,
  chevron = false,
  keepFocus = false,
  disabled = false,
  tabbable = true,
  onTitleClipped,
  id,
  ref,
  onKeyDown,
  onContextMenu,
}: {
  /** A mark before the title (an avatar, a status's glyph), drawn as decoration. */
  leading?: ReactNode;
  /** What the row is, which its name opens with. */
  title: ReactNode;
  description?: ReactNode;
  /** Metadata at the row's end, before its acts ("2h ago", "Owner"). */
  meta?: ReactNode;
  /** The row's own acts (an IconButton, a Button), each a control beside the row's press. */
  actions?: ReactNode;
  /** What pressing the row does; a row without one is not a control. */
  onPress?: (() => void) | undefined;
  /** Whether the row is the one open now, drawn and announced as current. */
  current?: boolean | undefined;
  /** Whether its acts stand always, or only while the row is reached for, over its metadata. */
  actionsShown?: ActionsShown | undefined;
  /** Whether the row's own menu is open, which keeps it lit and its acts shown. */
  menuOpen?: boolean | undefined;
  /** Whether a chevron at its end says the press goes somewhere deeper. */
  chevron?: boolean | undefined;
  /** Whether a pointer's press leaves the focus where it is, as on a field beside the list that holds the keys. */
  keepFocus?: boolean | undefined;
  /** Whether its press is unavailable: refused and out of the tab order. */
  disabled?: boolean | undefined;
  /** Whether Tab stops on its press; one that is not still takes the focus a roving list hands it. */
  tabbable?: boolean | undefined;
  /** Hears whether the title is cut short, whenever that changes, so a hint can say it whole only then. */
  onTitleClipped?: ((clipped: boolean) => void) | undefined;
  /** The id of the row's item, which a field driving the list names as its active row. */
  id?: string | undefined;
  /** Handed the row's press, or its item where it opens nothing. A callback, so one list keeps each row's by its own key. */
  ref?: RefCallback<HTMLElement> | undefined;
  /** A key pressed on the row's press; a row that opens nothing hears none. */
  onKeyDown?: ((event: KeyboardEvent<HTMLElement>) => void) | undefined;
  /** A right-click, or the menu key, anywhere on the row. */
  onContextMenu?: ((event: MouseEvent<HTMLElement>) => void) | undefined;
}): React.JSX.Element {
  const titleRef = useTitleClipped(onTitleClipped);
  const face = (
    <>
      {said(leading) ? (
        <span className="luke-list-row-leading" aria-hidden="true">
          {leading}
        </span>
      ) : null}
      <span className="luke-list-row-text">
        <span ref={titleRef} className="luke-list-row-title">
          {title}
        </span>
        {said(description) ? (
          <span className="luke-list-row-description">{description}</span>
        ) : null}
      </span>
      {said(meta) ? <span className="luke-list-row-meta">{meta}</span> : null}
      {chevron ? (
        <span className="luke-list-row-chevron" aria-hidden="true">
          <ChevronRightIcon />
        </span>
      ) : null}
    </>
  );
  return (
    <li
      id={id}
      ref={onPress ? undefined : ref}
      className="luke-list-row"
      data-current={current === true ? "true" : undefined}
      data-actions={actionsShown}
      data-menu-open={menuOpen ? "true" : undefined}
      onContextMenu={onContextMenu}
    >
      {onPress ? (
        <button
          ref={ref}
          type="button"
          className="luke-list-row-main"
          aria-current={current === true ? "true" : undefined}
          disabled={disabled}
          tabIndex={tabbable ? undefined : -1}
          // Note that the focus moves as a mousedown's default, so refusing it there is what keeps it.
          onMouseDown={keepFocus ? preventFocusMove : undefined}
          onClick={onPress}
          onKeyDown={onKeyDown}
        >
          {face}
        </button>
      ) : (
        <div className="luke-list-row-main" aria-current={current === true ? "true" : undefined}>
          {face}
        </div>
      )}
      {said(actions) ? <div className="luke-list-row-actions">{actions}</div> : null}
    </li>
  );
}
