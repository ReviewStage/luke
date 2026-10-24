import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  TABS_FOLD,
  Tab,
  type TabHint,
  type TabMove,
  type TabPlace,
  Tabs,
  type TabsControls,
  type TabsGround,
  Tooltip,
  tabMenuPlacement,
  useMenu,
} from "@luke/ui";
import { createContext, useContext, useRef, useState } from "react";
import { useAppCommand } from "../app-commands.js";
import { SHELL_ROOM } from "../shell-room.js";
import { ShellRoomContext } from "../stage-room.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import { ROW_RUN, withRowMoves } from "./row-moves.js";

/**
 * tab-strip.tsx -- the window's one tab strip, `@luke/ui`'s Tabs, drawn alike across the task's column and the side panel, with what is the window's own: its chords, its hints, and each tab's menu.
 *
 * The strip itself, its keys, its drag, its scroll, and its look, is
 * `@luke/ui`'s (`components/tabs`). What the window adds: how its tabs fold
 * in the room the stage gives (`ShellRoomContext`); the focused tab
 * stepped left or right by ⇧⌘← and ⇧⌘→, as VS Code moves an editor, while
 * one of the strip's tabs has the focus; each tab's hint, this window's
 * tooltip (`TabTooltip`); and a tab's own actions on a right-click, or from
 * the keyboard on the menu key or ⇧F10, hanging where the pointer is or
 * under the tab (`MenuTab`), closing that menu handing focus back to the
 * tab.
 */

/**
 * Where a tab of the strip around it stands among the tabs that move, read
 * from the strip as the tab's menu opens, which moves it one place either
 * way (`row-moves.tsx`); none in a strip whose tabs stay put, or for the
 * tab anchored at its start.
 */
const TabPlaceContext = createContext<((tab: HTMLElement) => TabPlace | undefined) | undefined>(
  undefined,
);

/** A tab's hint: this window's tooltip, hanging its words or its card. */
const TabTooltip: TabHint = ({ label, card, children }) => (
  <Tooltip label={label} card={card}>
    {children}
  </Tooltip>
);

/**
 * The strip of tabs. `onMove`, while given, lets the tabs be moved, and
 * hears each move as the tab's place before and after it; every tab moves,
 * to any place among them all, but one anchored at the strip's start.
 */
export function TabStrip({
  label,
  ground,
  onMove,
  children,
}: {
  label: string;
  /** The ground the strip stands on: the side panel's well, or the column's own. */
  ground?: TabsGround | undefined;
  onMove?: TabMove | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  const controls = useRef<TabsControls | null>(null);
  // A narrow room's tabs keep their labels rather than turning to glyphs,
  // since a phone has no hint to name a glyph and two agents' glyphs look alike.
  const room = useContext(ShellRoomContext);
  // Whether one of the strip's tabs has focus, the one the move chords move.
  const [focused, setFocused] = useState(false);
  const stepping = onMove !== undefined && focused;
  useAppCommand(APP_COMMAND.MOVE_TAB_LEFT, stepping ? () => controls.current?.step(-1) : undefined);
  useAppCommand(APP_COMMAND.MOVE_TAB_RIGHT, stepping ? () => controls.current?.step(1) : undefined);
  const placeOf = (tab: HTMLElement) => controls.current?.placeOf(tab);
  return (
    <TabPlaceContext.Provider value={placeOf}>
      <Tabs
        label={label}
        ground={ground}
        fold={room === SHELL_ROOM.NARROW ? TABS_FOLD.LABEL : TABS_FOLD.GLYPH}
        onMove={onMove}
        onFocusChange={setFocused}
        controls={controls}
      >
        {children}
      </Tabs>
    </TabPlaceContext.Provider>
  );
}

/**
 * A tab with its own actions, in the groups a rule divides, on a right-click
 * or the keyboard's menu keys, hung where the pointer is or under the tab;
 * closing the menu hands focus back to the tab, and a press on the tab
 * closes it, as a press on a menu's own button does. Every other part is
 * `@luke/ui`'s `Tab`'s, with this window's hint.
 */
export function MenuTab({
  groups,
  ...tab
}: Omit<React.ComponentProps<typeof Tab>, "contextMenu" | "onMenu" | "hint"> & {
  groups: MenuAction[][];
}): React.JSX.Element {
  const menu = useMenu(true);
  const placeOf = useContext(TabPlaceContext);
  return (
    <>
      <Tab
        {...tab}
        hint={TabTooltip}
        onSelect={() => {
          menu.close(false);
          tab.onSelect();
        }}
        // A menu key the system turned into a right-click says no point of its own, and hangs the menu under the whole tab.
        contextMenu={menu.contextMenu(undefined, tabMenuPlacement)}
        onMenu={menu.show}
      />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={`${tab.label} actions`}
          menu={menu.drawn}
          groups={withRowMoves(groups, placeOf?.(menu.drawn.opener), ROW_RUN.ALONG)}
          onClose={menu.close}
        />
      )}
    </>
  );
}
