import type { ButtonHTMLAttributes, KeyboardEvent, MouseEvent, ReactNode, Ref } from "react";
import { ChevronRightIcon } from "../../face/glyphs.js";

/**
 * nav-item.tsx -- a place in a column of places: its glyph, its name, and what stands at its end, a count, a mark, or its chord.
 *
 * A NavItem is a press that goes somewhere, or folds what stands under it,
 * in the sidebar's voice: no ground at rest, the column's hover fill under
 * the pointer, and the stronger fill on the place shown (`current`), which
 * is announced as the page (`aria-current="page"`), or as the spot within
 * one (`location`) for a search's result. Three looks, by what it is:
 *
 * - `row`, a place: a page, a channel, a way back. One control's height,
 *   its glyph and its name in the body's voice and the sidebar's ink, a
 *   step under the primary, as the task rows it heads are, until it is
 *   hovered or shown.
 * - `head`, a fold's head over a group of rows, in the headings' quieter
 *   voice and with no fill of its own, since its group's container draws
 *   one around it and its actions. Where it has a glyph and folds
 *   (`expanded`), the glyph gives way to the fold's chevron while it is
 *   hovered or has the keyboard, pointing down open and right folded.
 * - `identity`, who or where: an account's picture and name, a
 *   workspace's tile and who shares it, a row tall enough for a face.
 *
 * Its end holds, at rest, a `mark` (a failed run's glyph, a pin) and a
 * `count`, read with its noun ("3 waiting on you") and left out at none,
 * muted, or in the accent's ink where it counts what waits on the reader;
 * a fold's count can stand only while the head is hovered. Its `shortcut`,
 * the chord the app draws, stands there while it is hovered or has the
 * keyboard and takes the count's and the mark's place then, so showing it
 * moves nothing. A row's `detail`, the words after its name, steps back and
 * gives way first, so the name stays whole. An `unread` row reads in the
 * heavier weight and the primary ink until it is looked at.
 *
 * A NavItemLink is a row's look on a link, for a place with an address of
 * its own: the browser follows it, so a modified click opens it in a new tab
 * as any link does, and its caller's `onClick` may take a plain one instead.
 *
 * A row that drops a menu takes the props `useMenu().trigger()` hands out
 * (`menu`), and is lit while its menu stands. It takes an app's hint's
 * handlers and chord as a Button does, and keeps the focus where it is
 * under a pointer's press (`keepFocus`) as a Button does too. It takes no
 * class or style; its outer spacing is its column's.
 */

/** What a nav item is: a place, a fold's head, or who or where. */
export const NAV_ITEM_VARIANT = {
  ROW: "row",
  HEAD: "head",
  IDENTITY: "identity",
} as const;

export type NavItemVariant = (typeof NAV_ITEM_VARIANT)[keyof typeof NAV_ITEM_VARIANT];

/** Which place a current item is: the page on show, or the spot within one a search found. */
export const NAV_CURRENT = {
  PAGE: "page",
  LOCATION: "location",
} as const;

export type NavCurrent = (typeof NAV_CURRENT)[keyof typeof NAV_CURRENT];

/** When a count stands: always, or only while the item is hovered or has the keyboard. */
export const NAV_COUNT_SHOWN = {
  ALWAYS: "always",
  ON_HOVER: "on-hover",
} as const;

export type NavCountShown = (typeof NAV_COUNT_SHOWN)[keyof typeof NAV_COUNT_SHOWN];

/** A count's ink: muted, as a group's tally, or the accent's, for what waits on the reader. */
export const NAV_COUNT_TONE = {
  MUTED: "muted",
  ACCENT: "accent",
} as const;

export type NavCountTone = (typeof NAV_COUNT_TONE)[keyof typeof NAV_COUNT_TONE];

/** A count at the item's end: its figure, what it counts as a reader hears it, when it stands, and its ink. */
export interface NavCount {
  readonly value: number;
  /** Said after the figure to a reader, "waiting on you", "tasks"; the figure alone where absent. */
  readonly noun?: string | undefined;
  readonly shown?: NavCountShown | undefined;
  /** Muted where absent. */
  readonly tone?: NavCountTone | undefined;
}

/** What `useMenu().trigger()` hands the button its menu drops from. */
export interface NavMenuTrigger {
  readonly "aria-haspopup": "menu";
  readonly "aria-expanded": boolean;
  readonly onClick: (event: MouseEvent<HTMLElement>) => void;
}

/** What an app's hint hands the item it wraps: when to show and go, and the chord it names. */
type HintProps = Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onPointerEnter" | "onPointerLeave" | "onPointerDown" | "onFocus" | "onBlur" | "aria-keyshortcuts"
>;

export type NavItemProps = HintProps & {
  variant?: NavItemVariant | undefined;
  /** The glyph before its name, decoration a reader is not told. */
  icon?: ReactNode;
  /** Its name. */
  children: ReactNode;
  /** Quieter words after its name, which give way first. */
  detail?: ReactNode;
  /** Whether, and as what, it is the place shown. */
  current?: NavCurrent | undefined;
  /** Whether something arrived in it the developer has not looked at. */
  unread?: boolean | undefined;
  /** Whether what it folds stands open; absent where it folds nothing. */
  expanded?: boolean | undefined;
  /** The count at its end, left out at none. */
  count?: NavCount | undefined;
  /** A mark at its end at rest: a failed run's glyph, a pin. */
  mark?: ReactNode;
  /** The chord the app draws, shown at its end while it is hovered or has the keyboard. */
  shortcut?: ReactNode;
  /** The menu it drops, from `useMenu().trigger()`, in place of `onClick`. */
  menu?: NavMenuTrigger | undefined;
  onClick?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  onContextMenu?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  onKeyDown?: ((event: KeyboardEvent<HTMLButtonElement>) => void) | undefined;
  disabled?: boolean | undefined;
  /** Whether a pointer's press leaves the focus where it is. */
  keepFocus?: boolean | undefined;
  id?: string | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
  /** Its name, where the words drawn do not say the whole of it. */
  "aria-label"?: string | undefined;
  /** The id of the words that say more of it, as an app's hint names its own. */
  "aria-describedby"?: string | undefined;
};

/** A pointer's press that leaves the focus where it is. */
function preventFocusMove(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

/** Whether a slot says anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}

/** The glyph's cell: the glyph alone, or, on a fold's head, the glyph and the chevron it gives way to. */
function Glyph({ icon, folds }: { icon: ReactNode; folds: boolean }): React.JSX.Element {
  return (
    <span className="luke-nav-item-glyph" aria-hidden="true">
      <span className="luke-nav-item-icon">{icon}</span>
      {folds ? (
        <span className="luke-nav-item-chevron">
          <ChevronRightIcon />
        </span>
      ) : null}
    </span>
  );
}

/** What stands at rest: the mark, then the count, read with its noun. */
function AtRest({ mark, count }: { mark: ReactNode; count: NavCount | undefined }) {
  const counted = count !== undefined && count.value > 0;
  if (!said(mark) && !counted) return null;
  return (
    <span className="luke-nav-item-rest">
      {said(mark) ? <span className="luke-nav-item-mark">{mark}</span> : null}
      {counted ? (
        <span
          className="luke-nav-item-count"
          data-shown={count.shown ?? NAV_COUNT_SHOWN.ALWAYS}
          data-tone={count.tone ?? NAV_COUNT_TONE.MUTED}
        >
          {count.value}
          {count.noun === undefined ? null : (
            <span className="luke-visually-hidden"> {count.noun}</span>
          )}
        </span>
      ) : null}
    </span>
  );
}

/** A place in a column at an address: `icon` and its name, going to `href` when pressed. */
export function NavItemLink({
  href,
  icon,
  children,
  current,
  title,
  onClick,
  ...props
}: {
  href: string;
  /** The glyph before its name, decoration a reader is not told. */
  icon?: ReactNode;
  /** Its name. */
  children: ReactNode;
  /** Whether, and as what, it is the place shown. */
  current?: NavCurrent | undefined;
  /** Its name as a pointer's hint, where its words are not drawn whole. */
  title?: string | undefined;
  /** Called as the press leaves, before the browser follows the link. */
  onClick?: ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined;
  /** Its name, where the words drawn do not say the whole of it. */
  "aria-label"?: string | undefined;
}): React.JSX.Element {
  return (
    <a
      className="luke-nav-item"
      data-variant={NAV_ITEM_VARIANT.ROW}
      href={href}
      title={title}
      aria-label={props["aria-label"]}
      aria-current={current}
      onClick={onClick}
    >
      {said(icon) ? <Glyph icon={icon} folds={false} /> : null}
      <span className="luke-nav-item-name">{children}</span>
    </a>
  );
}

/** A place in a column: `icon`, its name, and its end, going there or folding on a press. */
export function NavItem({
  variant = NAV_ITEM_VARIANT.ROW,
  icon,
  children,
  detail,
  current,
  unread,
  expanded,
  count,
  mark,
  shortcut,
  menu,
  onClick,
  keepFocus,
  ...props
}: NavItemProps): React.JSX.Element {
  const folds = variant === NAV_ITEM_VARIANT.HEAD && expanded !== undefined;
  return (
    <button
      type="button"
      className="luke-nav-item"
      data-variant={variant}
      data-unread={unread === true ? "true" : undefined}
      id={props.id}
      ref={props.ref}
      disabled={props.disabled}
      aria-label={props["aria-label"]}
      aria-describedby={props["aria-describedby"]}
      aria-current={current}
      aria-expanded={menu?.["aria-expanded"] ?? expanded}
      aria-haspopup={menu?.["aria-haspopup"]}
      aria-keyshortcuts={props["aria-keyshortcuts"]}
      onPointerEnter={props.onPointerEnter}
      onPointerLeave={props.onPointerLeave}
      onPointerDown={props.onPointerDown}
      // Note that the focus moves as a mousedown's default, so refusing it there is what keeps it.
      onMouseDown={keepFocus === true ? preventFocusMove : undefined}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
      onClick={menu?.onClick ?? onClick}
      onContextMenu={props.onContextMenu}
      onKeyDown={props.onKeyDown}
    >
      {said(icon) ? <Glyph icon={icon} folds={folds} /> : null}
      <span className="luke-nav-item-name">{children}</span>
      {said(detail) ? <span className="luke-nav-item-detail">{detail}</span> : null}
      <AtRest mark={mark} count={count} />
      {said(shortcut) ? <span className="luke-nav-item-shortcut">{shortcut}</span> : null}
    </button>
  );
}
