import type { ButtonHTMLAttributes, KeyboardEvent, MouseEvent, ReactNode, Ref } from "react";
import { PRESS_PULSE, pulseOnPress } from "../../press-pulse.js";
import { STATUS_TONE, type StatusTone } from "../../status-tone.js";
import { type ContextMenuProps, withContextMenu } from "../menu/menu.js";
import { ClippedLine, ONE_LINE_ELEMENT, ONE_LINE_END } from "../one-line/clipped-line.js";
import { rovingItem } from "../roving-keys/roving-keys.js";
import { Skeleton } from "../skeleton/skeleton.js";

/**
 * nav-item.tsx -- a place in a column of places: its glyph, its name, and what stands at its end, a count, a mark, or its chord.
 *
 * A NavItem is a press that goes somewhere,
 * in the sidebar's voice: no ground at rest, the column's hover fill under
 * the pointer, and the stronger fill on the place shown (`current`), which
 * is announced as the page (`aria-current="page"`), or as the spot within
 * one (`location`) for a search's result. Two looks, by what it is:
 *
 * - `row`, a place: a page, a channel, a way back. One control's height,
 *   its glyph and its name in the body's voice and the sidebar's ink, a
 *   step under the primary, as the task rows it heads are, until it is
 *   hovered or shown.
 * - `identity`, who or where: an account's picture and name, a
 *   workspace's tile and who shares it, a row tall enough for a face.
 *
 * Its end holds, at rest, a `mark` (a failed run's glyph, a pin) and a
 * `count`, read with its noun ("3 waiting on you") and left out at none,
 * muted, or in the needs-you tone (`STATUS_TONE.ATTENTION`) where it counts
 * what waits on the reader. Its `shortcut`, the chord the app draws, stands there while it is
 * hovered or has the keyboard and takes the count's and the mark's place
 * then, so showing it moves nothing. A row's `detail`, the words after its name, steps back and
 * gives way first, so the name stays whole. An `unread` row reads in the
 * heavier weight and the primary ink until it is looked at.
 *
 * A NavItemLink is a row's look on a link, for a place with an address of
 * its own: the browser follows it, so a modified click opens it in a new tab
 * as any link does, and its caller's `onClick` may take a plain one instead.
 * One that leaves the page (`newTab`) opens in a tab of its own, which
 * reaches nothing of this one.
 *
 * A row that drops a menu takes the props `useMenu().trigger()` hands out
 * (`menu`), and is lit while its menu stands. It takes an app's hint's
 * handlers and chord as a Button does, and keeps the focus where it is
 * under a pointer's press (`keepFocus`) as a Button does too. It takes no
 * class or style; its outer spacing is its column's.
 *
 * A NavItemSkeleton stands a row while the places it lists are read: the
 * row's own box, its glyph's cell holding the glyph every row of the list
 * wears, and a block where its name will stand, so the rows land where the
 * blocks stood. It is no press; the region around it says what is read.
 */

/**
 * The row's box: a control tall (a face's height for who or where), its
 * glyph, name, and end a glyph's gap apart, its words in the body's size on
 * a label's line, pressed as a Mac's list is on the desktop, without the
 * web's pointing hand. Note that its inks, at rest, hovered, open, and
 * unread, stay in `nav-item.css`, which a strip's chosen tab is held to
 * (`tabs-frame.test.ts`), and so does what stands at its end, whose count
 * and chord trade places under the pointer and the keyboard.
 */
const ROW =
  "luke-nav-item group/nav m-0 flex h-control w-full min-w-0 cursor-press items-center gap-icon-gap rounded-control border-0 px-row-inset text-left font-sans text-body-size leading-label font-text no-underline transition-[background-color,color] duration-(--luke-duration-hover) ease-plain disabled:cursor-default disabled:opacity-disabled data-[variant=identity]:h-auto data-[variant=identity]:min-h-nav-identity data-[variant=identity]:py-luke-6";

/** A name cut short fades out over its last few pixels, as a browser's tab ends a long title; unread, or naming who or where, it reads in the heavier weight. */
const NAME =
  "luke-nav-item-name min-w-0 flex-initial overflow-hidden whitespace-nowrap group-data-[unread=true]/nav:font-emphasis group-data-[variant=identity]/nav:font-emphasis";

/** A menu's chevron at the end is the small, muted one a chip's is. */
const MARK =
  "luke-nav-item-mark inline-flex [&>svg.settings-chevron]:size-luke-12 [&>svg.settings-chevron]:text-muted-foreground";

/** What a nav item is: a place, or who or where. A fold's head is `GroupHeader`. */
export const NAV_ITEM_VARIANT = {
  ROW: "row",
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

/** A count at the item's end: its figure, what it counts as a reader hears it, when it stands, and its ink. */
export interface NavCount {
  readonly value: number;
  /** Said after the figure to a reader, "waiting on you", "tasks"; the figure alone where absent. */
  readonly noun?: string | undefined;
  readonly shown?: NavCountShown | undefined;
  /** Its status tone: neutral, a tally in the muted ink, where absent; attention for what needs the reader. */
  readonly tone?: StatusTone | undefined;
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
  /** The count at its end, left out at none. */
  count?: NavCount | undefined;
  /** A mark at its end at rest: a failed run's glyph, a pin. */
  mark?: ReactNode;
  /** The chord the app draws, shown at its end while it is hovered or has the keyboard. */
  shortcut?: ReactNode;
  /** The menu it drops, from `useMenu().trigger()`, in place of `onClick`. */
  menu?: NavMenuTrigger | undefined;
  onClick?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  /** The menu a right-click or a long press opens on it (`useMenu`'s `contextMenu`). */
  contextMenu?: ContextMenuProps | undefined;
  onKeyDown?: ((event: KeyboardEvent<HTMLButtonElement>) => void) | undefined;
  disabled?: boolean | undefined;
  /** Whether a pointer's press leaves the focus where it is. */
  keepFocus?: boolean | undefined;
  /** Whether it is an item of a column a `useRovingKeys` box holds, whose one Tab stop the arrows walk. */
  roving?: boolean | undefined;
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

/** The glyph's cell. */
function Glyph({ icon }: { icon: ReactNode }): React.JSX.Element {
  return (
    <span
      className="luke-nav-item-glyph grid min-h-control-icon min-w-control-icon flex-none place-items-center [&>*]:grid [&>*]:place-items-center"
      aria-hidden="true"
    >
      <span className="luke-nav-item-icon [&>svg]:size-control-icon">{icon}</span>
    </span>
  );
}

/** Its name on one line, fading out at its end while the row cuts it short, as a browser's tab does. */
function Name({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <ClippedLine className={NAME} as={ONE_LINE_ELEMENT.SPAN} end={ONE_LINE_END.FADE}>
      {children}
    </ClippedLine>
  );
}

/** What stands at rest: the mark, then the count, read with its noun. */
function AtRest({ mark, count }: { mark: ReactNode; count: NavCount | undefined }) {
  const counted = count !== undefined && count.value > 0;
  if (!said(mark) && !counted) return null;
  return (
    <span className="luke-nav-item-rest ml-auto">
      {said(mark) ? <span className={MARK}>{mark}</span> : null}
      {counted ? (
        <span
          className="luke-nav-item-count"
          data-shown={count.shown ?? NAV_COUNT_SHOWN.ALWAYS}
          data-tone={count.tone ?? STATUS_TONE.NEUTRAL}
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

/** A row's box with nothing to press, which a skeleton stands its blocks in. */
function StillRow({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className={ROW} data-variant={NAV_ITEM_VARIANT.ROW} aria-hidden="true">
      {children}
    </div>
  );
}

/** A row while its place is read: `icon`, the glyph its list's rows wear, and a block `width` wide where its name will stand. */
export function NavItemSkeleton({
  icon,
  width,
}: {
  icon?: ReactNode;
  /** How wide its name's block stands, a share of the row's room. */
  width: string;
}): React.JSX.Element {
  return (
    <StillRow>
      {said(icon) ? <Glyph icon={icon} /> : null}
      <Name>
        <Skeleton width={width} />
      </Name>
    </StillRow>
  );
}

/** A place in a column at an address: `icon` and its name, going to `href` when pressed. */
export function NavItemLink({
  href,
  icon,
  children,
  current,
  title,
  newTab,
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
  /** Whether it opens in a tab of its own rather than in this one. */
  newTab?: boolean | undefined;
  /** Called as the press leaves, before the browser follows the link. */
  onClick?: ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined;
  /** Its name, where the words drawn do not say the whole of it. */
  "aria-label"?: string | undefined;
}): React.JSX.Element {
  return (
    <a
      className={ROW}
      data-variant={NAV_ITEM_VARIANT.ROW}
      href={href}
      target={newTab === true ? "_blank" : undefined}
      rel={newTab === true ? "noopener" : undefined}
      title={title}
      aria-label={props["aria-label"]}
      aria-current={current}
      onClick={pulseOnPress(onClick, PRESS_PULSE.QUIET)}
    >
      {said(icon) ? <Glyph icon={icon} /> : null}
      <Name>{children}</Name>
    </a>
  );
}

/** A place in a column: `icon`, its name, and its end, going there on a press. */
export function NavItem({
  variant = NAV_ITEM_VARIANT.ROW,
  icon,
  children,
  detail,
  current,
  unread,
  count,
  mark,
  shortcut,
  menu,
  onClick,
  keepFocus,
  roving,
  ...props
}: NavItemProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={ROW}
      data-variant={variant}
      data-unread={unread === true ? "true" : undefined}
      id={props.id}
      ref={props.ref}
      disabled={props.disabled}
      aria-label={props["aria-label"]}
      aria-describedby={props["aria-describedby"]}
      aria-current={current}
      aria-expanded={menu?.["aria-expanded"]}
      aria-haspopup={menu?.["aria-haspopup"]}
      aria-keyshortcuts={props["aria-keyshortcuts"]}
      onPointerEnter={props.onPointerEnter}
      onPointerLeave={props.onPointerLeave}
      // Note that the focus moves as a mousedown's default, so refusing it there is what keeps it.
      onMouseDown={keepFocus === true ? preventFocusMove : undefined}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
      onClick={pulseOnPress(menu?.onClick ?? onClick, PRESS_PULSE.QUIET)}
      {...withContextMenu(props.contextMenu, { onPointerDown: props.onPointerDown })}
      onKeyDown={props.onKeyDown}
      {...(roving === true ? rovingItem() : undefined)}
    >
      {said(icon) ? <Glyph icon={icon} /> : null}
      <Name>{children}</Name>
      {said(detail) ? <span className="luke-nav-item-detail">{detail}</span> : null}
      <AtRest mark={mark} count={count} />
      {said(shortcut) ? <span className="luke-nav-item-shortcut ml-auto">{shortcut}</span> : null}
    </button>
  );
}
