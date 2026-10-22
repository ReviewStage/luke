import { dropBelow, EllipsisIcon, IconButton, useMenu } from "@luke/ui";
import { useEffect, useState } from "react";
import { Tooltip } from "../tooltip.js";
import { ActionMenu, type MenuEntry } from "./action-menu.js";

/**
 * phone-head.tsx -- a phone's page header: one control in each corner and the page's title centred between them.
 *
 * A narrow room, a phone's, heads a task and each of its places, the Inbox,
 * the Tasks page, and Chat, the one standard way: the way back, or the one
 * thing the page is for, such as New task, in the start corner; one ⋯ in the
 * end corner holding everything else the page offers; and the title of what
 * is on screen between them. The corners are one control wide each, so the
 * title's centre is the row's, and it truncates between them
 * (`.phone-head` in desktop.css).
 *
 * A menu the page already drops from a button of its own, its View options
 * or its Filter, is kept whole rather than folded into the ⋯: the ⋯ offers
 * it as one item, which closes the ⋯ and opens that menu where the ⋯ stood
 * (`MenuAsk`), so a menu of submenus is never a submenu itself.
 */

/** An ask, from a phone's ⋯, to open a menu of the page's own under it: the ⋯ it hangs from, and the ask's turn, so the same ask twice opens it twice. */
export interface MenuAsk {
  readonly opener: HTMLElement;
  readonly turn: number;
}

/** Opens `menu` under the ⋯ each time the ⋯ asks for it (`MenuAsk`). */
export function useAskedMenu(
  show: (placement: ReturnType<typeof dropBelow>, opener: HTMLElement) => void,
  ask: MenuAsk | undefined,
): void {
  useEffect(() => {
    if (ask !== undefined) show(dropBelow(ask.opener), ask.opener);
  }, [ask, show]);
}

/** A page's own menu the ⋯ opens in its place: the ask, and the door that makes one from the ⋯. */
export function useMenuAsk(): {
  ask: MenuAsk | undefined;
  onAsk: (opener: HTMLElement) => void;
} {
  const [ask, setAsk] = useState<MenuAsk | undefined>(undefined);
  return {
    ask,
    onAsk: (opener) => setAsk((was) => ({ opener, turn: (was?.turn ?? 0) + 1 })),
  };
}

/** The row; see the module's head. */
export function PhoneHead({
  place,
  start,
  title,
  end,
}: {
  /** What the row heads, which its class names, as `task-head` for a task. */
  place: string;
  /** The start corner's one control. */
  start: React.ReactNode;
  /** What is on screen, centred, or what stands in its place, such as a search's field. */
  title: React.ReactNode;
  /** The end corner's one control, the ⋯. */
  end: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className={`desktop-toolbar phone-head ${place}-head`}>
      <div className="phone-head-start">{start}</div>
      <div className="desktop-toolbar-heading">{title}</div>
      <div className="desktop-toolbar-actions">{end}</div>
    </header>
  );
}

/** What a place's ⋯ is called. */
export const MORE = "More";

/**
 * A place's ⋯ and the menu it drops: `groups`, made as the menu is drawn
 * from the ⋯ itself, so an item can hand a menu of its own the ⋯ to open
 * under (`MenuAsk`).
 */
export function PlaceMore({
  shown,
  groups,
}: {
  /** Whether the place is on screen, for the menu not to outlive it. */
  shown: boolean;
  groups: (opener: HTMLElement) => readonly (readonly MenuEntry[])[];
}): React.JSX.Element {
  const menu = useMenu(shown);
  return (
    <>
      <Tooltip label={MORE}>
        <IconButton icon={<EllipsisIcon />} label={MORE} {...menu.trigger()} />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={MORE}
          menu={menu.drawn}
          groups={groups(menu.drawn.opener)}
          onClose={menu.close}
        />
      )}
    </>
  );
}
