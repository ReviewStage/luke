import {
  BackButton,
  dropBelow,
  MoreButton,
  moreLabel,
  NO_BACK_KEY,
  TOOLBAR_INSET,
  TOOLBAR_LOOK,
  Toolbar,
  type ToolbarPickUp,
  type ToolbarProps,
  useMenu,
} from "@luke/ui";
import { useEffect, useRef, useState } from "react";
import { ActionMenu, type MenuEntry } from "./action-menu.js";
import type { TaskHeadBack } from "./task-pane-switcher.js";

/**
 * phone-head.tsx -- a phone's page header: one control in each corner and the page's title centred between them.
 *
 * A narrow room, a phone's, heads a task and each of its places, the Inbox,
 * the Tasks page, and Chat, the one standard way: the way back, or the one
 * thing the page is for, such as New task, in the start corner; one ⋯ in the
 * end corner holding everything else the page offers; and the title of what
 * is on screen between them. The corners are one control wide each, so the
 * title's centre is the row's, and it truncates between them (`Toolbar`'s
 * phone look). A corner's control draws its glyph alone, named still, so a
 * way back (`BackButton`) is its back glyph, hinted "Back to {place}".
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

/**
 * Opens `menu` under the ⋯ each time the ⋯ asks for it (`MenuAsk`). Note
 * that an ask standing as the menu mounts is one already answered, as when
 * the page draws its menu anew on another view, so only an ask made after
 * the mount opens it.
 */
export function useAskedMenu(
  show: (placement: ReturnType<typeof dropBelow>, opener: HTMLElement) => void,
  ask: MenuAsk | undefined,
): void {
  const answered = useRef(ask);
  useEffect(() => {
    if (ask === undefined || ask === answered.current) return;
    answered.current = ask;
    show(dropBelow(ask.opener), ask.opener);
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

/** What a phone's row holds, corner by corner. */
export interface PhoneHeadSlots {
  /** What the row heads, which its class names, as `task-head` for a task. */
  place: string;
  /** The start corner's one control. */
  start: React.ReactNode;
  /** What is on screen, centred, or what stands in its place, such as a search's field; none where the page's own header names it, the row then picking that name up (`pickUp`). */
  title?: React.ReactNode;
  /** A document's name, centred once its header has scrolled away; read only where there is no `title`. */
  pickUp?: ToolbarPickUp | undefined;
  /** What names the page's state, after the title on its baseline (an experiment's mark). */
  tag?: React.ReactNode;
  /** The end corner's one control, the ⋯. */
  end: React.ReactNode;
}

/** The bar a phone's row is, as `Toolbar` takes it, for a state that draws its own bar (`NotFound`). */
export function phoneBar({ place, start, title, pickUp, tag, end }: PhoneHeadSlots): ToolbarProps {
  return {
    look: TOOLBAR_LOOK.PHONE,
    place,
    // A corner holds one control, so a way back is its glyph alone, named still.
    folded: true,
    start: TOOLBAR_INSET.COLUMN,
    end: TOOLBAR_INSET.COLUMN,
    lead: start,
    title,
    pickUp,
    tag,
    actions: end,
  };
}

/** The row; see the module's head. */
export function PhoneHead(slots: PhoneHeadSlots): React.JSX.Element {
  return <Toolbar {...phoneBar(slots)} />;
}

/**
 * A phone's way back, its start corner: the back's glyph, named by where it
 * leads. Note that it names no key, because the window's Back takes one
 * history step and this leaves the page, as the task's way back does.
 */
export function PhoneBack({ back }: { back: TaskHeadBack }): React.JSX.Element {
  return (
    <BackButton label={back.label} place={back.label} command={NO_BACK_KEY} onBack={back.onPress} />
  );
}

/** What a place's ⋯ is called. */

/**
 * A place's ⋯ and the menu it drops: `groups`, made as the menu is drawn
 * from the ⋯ itself, so an item can hand a menu of its own the ⋯ to open
 * under (`MenuAsk`).
 */
export function PlaceMore({
  thing,
  shown,
  groups,
}: {
  /** What the place is, which names its ⋯ and its menu: "Inbox" makes "Inbox actions". */
  thing: string;
  /** Whether the place is on screen, for the menu not to outlive it. */
  shown: boolean;
  groups: (opener: HTMLElement) => readonly (readonly MenuEntry[])[];
}): React.JSX.Element {
  const menu = useMenu(shown);
  return (
    <>
      <MoreButton thing={thing} {...menu.trigger()} />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={moreLabel(thing)}
          menu={menu.drawn}
          groups={groups(menu.drawn.opener)}
          onClose={menu.close}
        />
      )}
    </>
  );
}
