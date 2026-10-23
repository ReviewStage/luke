import {
  BackIcon,
  dropBelow,
  EllipsisIcon,
  IconButton,
  Skeleton,
  Tooltip,
  useMenu,
} from "@luke/ui";
import { useEffect, useRef, useState } from "react";
import type { NavigationHistory } from "../navigation-history.js";
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
 *
 * The way back is its glyph alone (`PhoneBack`), named for where it goes,
 * since the glyph says only that it goes back: a list's own way back steps
 * the history as its door always did and pushes nothing.
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

/** Where a phone's way back goes and the door it goes through: `to` names the page, none where nothing names it. */
export interface PhoneBackDoor {
  readonly to: string | undefined;
  readonly onPress: () => void;
}

/** What the way back is called: where it goes, since its glyph alone says only that it goes back. */
function phoneBackLabel(to: string | undefined): string {
  return to === undefined ? "Back" : `Back to ${to}`;
}

/**
 * What a page's way out through the window's history goes back to, as
 * Back's list names that step; `otherwise` where no step stands behind it
 * and the page's way out goes somewhere of its own.
 */
export function backStepName(
  history: NavigationHistory,
  otherwise: string | undefined,
): string | undefined {
  if (!history.canGoBack) return otherwise;
  return history.steps.back[0]?.title?.label;
}

/** The start corner's way back: the back glyph alone, named and hinted for where it goes. */
export function PhoneBack({ back }: { back: PhoneBackDoor }): React.JSX.Element {
  const label = phoneBackLabel(back.to);
  return (
    <Tooltip label={label}>
      <IconButton icon={<BackIcon />} label={label} onClick={back.onPress} />
    </Tooltip>
  );
}

/** How wide a title stands while what it names is read: a short page name's, five controls' height across. */
const TITLE_SKELETON_WIDTH = "calc(5 * var(--luke-control-height))";

/** The row while what it heads is read: its way back, and a block where the title will stand. */
export function PhoneHeadSkeleton({
  place,
  back,
}: {
  place: string;
  back: PhoneBackDoor;
}): React.JSX.Element {
  return (
    <PhoneHead
      place={place}
      start={<PhoneBack back={back} />}
      title={<Skeleton width={TITLE_SKELETON_WIDTH} />}
      end={null}
    />
  );
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
  /** The end corner's one control, the ⋯, or nothing where the page offers nothing more. */
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
const MORE = "More";

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
