import { APP_COMMAND, APP_SHORTCUTS } from "@luke/settings/shortcuts";
import { type KeyboardEvent, type ReactNode, type RefObject, useRef } from "react";
import type { ButtonSize } from "../button/button.js";
import {
  dropBelowStart,
  Menu,
  type MenuEntry,
  opensMenu,
  useMenu,
  withContextMenu,
} from "../menu/menu.js";
import { MoreButton, moreLabel } from "../more-button/more-button.js";
import { Shortcut } from "../shortcut/shortcut.js";
import { showDetailsFrom } from "../tooltip/hint.js";

/**
 * row-menu.tsx -- a row's one menu, opened alike by its ⋯, a right-click, and the menu key: what a `ListRow` draws, for the rows that are no `ListRow`.
 *
 * A Board card, or a grid row of chips, offers its thing's acts as a
 * `ListRow` does (`ListRowMenu`), so it opens them by the same three doors:
 * its ⋯ (`more`), a right-click or a touch's long press anywhere on it, and
 * the menu key or ⇧F10 pressed on it or any control inside it. Where the
 * row's control hangs a hover card, the menu offers Show details, which
 * opens that card with focus inside it, as ⌥↓ on the control does, so what
 * the card holds is reached without a pointer. The owner
 * spreads `props` on the box that is the row, draws `more` where its ⋯
 * stands and `popup` beside the row, and a `ListRow` takes the same pieces
 * from here. A row unavailable, or whose thing offers no acts now, offers
 * no door at all.
 */

/** A row's menu of its thing's acts: what the thing is, which names its ⋯ and the menu, and the menu's items. */
export interface ListRowMenu {
  /** What the row is, as a sentence opens with it: "Task" names its ⋯ and its menu "Task actions". */
  readonly thing: string;
  /** The menu's items in groups, a rule between each group; none at all offers no menu. */
  readonly groups: readonly (readonly MenuEntry[])[];
  /** A muted line over the items, saying what they act on where the row's words do not. */
  readonly heading?: ReactNode;
  /** A muted line under the items, as who made the thing. */
  readonly footer?: ReactNode;
  /** Whether the surface the row stands on is shown; its menu closes once it is not, and stands while it is where unsaid. */
  readonly shown?: boolean | undefined;
}

/** The chord Show details names, which opens the card from the control itself. */
const DETAILS_CHORD = APP_SHORTCUTS[APP_COMMAND.SHOW_DETAILS].chord;

/**
 * The row's groups with Show details among them, in a group of its own
 * before the last, so the row's own first act stays first and what ends or
 * removes the thing, which a row's menu sets last and alone, stays last; or
 * after the one group a menu holds.
 */
function withDetails(
  groups: readonly (readonly MenuEntry[])[],
  details: () => void,
): readonly (readonly MenuEntry[])[] {
  const item: MenuEntry = {
    label: APP_SHORTCUTS[APP_COMMAND.SHOW_DETAILS].label,
    hint: <Shortcut chord={DETAILS_CHORD} />,
    onSelect: details,
  };
  const filled = groups.filter((group) => group.length > 0);
  if (filled.length < 2) return [...filled, [item]];
  return [...filled.slice(0, -1), [item], ...filled.slice(-1)];
}

/** What a row's ⋯ is drawn with beyond its menu: a size where the row is dense, and the words naming which row it is. */
interface RowMoreOptions {
  readonly size?: ButtonSize | undefined;
  /** The id of the words naming the row, which the ⋯ is described by, so a reader hears whose it is. */
  readonly describedBy?: string | undefined;
}

/**
 * One row's menu and the doors that open it. `opener` is the control the
 * keyboard reaches the row by, which a right-click hands focus back to; the
 * ⋯ where the row has none.
 */
export function useRowMenu(
  menu: ListRowMenu | undefined,
  options: {
    /** Whether the row is unavailable now, as one being deleted is, so it offers no menu. */
    readonly disabled?: boolean | undefined;
    readonly opener?: RefObject<HTMLElement | null> | undefined;
  } = {},
) {
  const { disabled = false, opener } = options;
  const state = useMenu(menu?.shown ?? true);
  const moreElement = useRef<HTMLButtonElement | null>(null);
  // Note that a row unavailable, or whose thing offers no acts now, opens no menu by any door.
  const live =
    menu !== undefined && !disabled && menu.groups.some((group) => group.length > 0)
      ? menu
      : undefined;
  const offered = live !== undefined;
  // The menu key, on the row's press or any of its acts, hangs the menu
  // under the row from its start, and hands focus back to what held it.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || !opensMenu(event)) return;
    event.preventDefault();
    const held = event.target instanceof HTMLElement ? event.target : event.currentTarget;
    state.show(dropBelowStart(event.currentTarget), held);
  };
  const doors = offered ? state.contextMenu(opener ?? moreElement) : undefined;
  const open = state.open !== undefined;
  const button = ({ size, describedBy }: RowMoreOptions = {}): ReactNode =>
    live !== undefined ? (
      <MoreButton
        ref={moreElement}
        thing={live.thing}
        size={size}
        aria-describedby={describedBy}
        {...state.trigger()}
      />
    ) : null;
  // Note that the card is looked for from the row's control first, because the ⋯ that opened the menu stands beside it rather than in it.
  const details =
    state.drawn === undefined
      ? undefined
      : (showDetailsFrom(opener?.current) ??
        showDetailsFrom(
          state.drawn.opener.closest<HTMLElement>("[data-row-menu]") ?? state.drawn.opener,
        ));
  const popup: ReactNode =
    live !== undefined && state.drawn !== undefined ? (
      <Menu
        label={moreLabel(live.thing)}
        menu={state.drawn}
        heading={live.heading}
        footer={live.footer}
        groups={details === undefined ? live.groups : withDetails(live.groups, details)}
        onClose={state.close}
      />
    ) : null;
  return {
    /** Whether the row offers its menu now. */
    offered,
    /** Whether the menu stands open, which rings the row. */
    open,
    /** Closes the menu, handing focus back to its opener where asked. */
    close: state.close,
    /** The right-click's props, for a row that wears its own handlers beside them (`withContextMenu`); none where the row offers no menu. */
    doors,
    /** The menu key's handler; none where the row offers no menu. */
    onKeyDown: offered ? onKeyDown : undefined,
    /** The ⋯ alone, drawn into the row's own box for it. */
    button,
    /** The ⋯ as a revealed end of the row (`row-menu.css`): shown as the row is reached for, its room kept. */
    more: (moreOptions?: RowMoreOptions): ReactNode =>
      offered ? <span className="luke-row-more">{button(moreOptions)}</span> : null,
    /** What a row that is no `ListRow` spreads on its box: the three doors, and the marks its ⋯'s reveal and its ring read. */
    props: {
      ...withContextMenu<HTMLElement>(doors, {}),
      onKeyDown: offered ? onKeyDown : undefined,
      "data-row-menu": offered ? "" : undefined,
      "data-menu-open": open ? "true" : undefined,
    },
    /** The menu, drawn beside the row rather than in it, so a press or a key in its portal never reaches the row's own handlers. */
    popup,
  };
}
