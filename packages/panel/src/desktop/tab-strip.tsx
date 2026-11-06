import { APP_COMMAND } from "@repo/settings/shortcuts";
import {
  TABS_FOLD,
  TABS_GROUND,
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
} from "@repo/ui";
import { createContext, useContext, useRef, useState } from "react";
import { useAppCommand } from "../app-commands.js";
import { useCoarsePointer } from "../coarse-pointer.js";
import { SHELL_ROOM } from "../shell-room.js";
import { ShellRoomContext } from "../stage-room.js";
import { ActionMenu, type MenuEnds, type MenuEntry } from "./action-menu.js";
import { ROW_RUN, withRowMoves } from "./row-moves.js";

const TabPlaceContext = createContext<((tab: HTMLElement) => TabPlace | undefined) | undefined>(
  undefined,
);

const TabTooltip: TabHint = ({ label, card, children }) => (
  <Tooltip label={label} card={card}>
    {children}
  </Tooltip>
);

export function TabStrip({
  label,
  ground,
  onMove,
  children,
}: {
  label: string;
  ground?: TabsGround | undefined;
  onMove?: TabMove | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  const controls = useRef<TabsControls | null>(null);
  const finger = useCoarsePointer();
  const room = useContext(ShellRoomContext);
  const [focused, setFocused] = useState(false);
  const stepping = onMove !== undefined && focused;
  useAppCommand(APP_COMMAND.MOVE_TAB_LEFT, stepping ? () => controls.current?.step(-1) : undefined);
  useAppCommand(APP_COMMAND.MOVE_TAB_RIGHT, stepping ? () => controls.current?.step(1) : undefined);
  const placeOf = (tab: HTMLElement) => controls.current?.placeOf(tab);
  return (
    <TabPlaceContext.Provider value={placeOf}>
      <Tabs
        label={label}
        ground={room === SHELL_ROOM.NARROW ? ground : TABS_GROUND.FRAME}
        fold={finger ? TABS_FOLD.LABEL : TABS_FOLD.GLYPH}
        onMove={onMove}
        onFocusChange={setFocused}
        controls={controls}
      >
        {children}
      </Tabs>
    </TabPlaceContext.Provider>
  );
}

export function MenuTab({
  groups,
  ends,
  ...tab
}: Omit<React.ComponentProps<typeof Tab>, "contextMenu" | "onMenu" | "menu" | "hint"> & {
  groups: (opener: HTMLElement) => MenuEntry[][];
  ends?: MenuEnds | undefined;
}): React.JSX.Element {
  const menu = useMenu(true);
  const placeOf = useContext(TabPlaceContext);
  return (
    <Tab
      {...tab}
      hint={TabTooltip}
      onSelect={() => {
        menu.close(false);
        tab.onSelect();
      }}
      contextMenu={menu.contextMenu(undefined, tabMenuPlacement)}
      onMenu={menu.show}
      menu={
        menu.drawn === undefined ? undefined : (
          <ActionMenu
            label={`${tab.label} actions`}
            menu={menu.drawn}
            subject={ends?.subject}
            footer={ends?.footer}
            groups={withRowMoves(
              groups(menu.drawn.opener),
              placeOf?.(menu.drawn.opener),
              ROW_RUN.ALONG,
            )}
            onClose={menu.close}
            replayUnmasked
          />
        )
      }
    />
  );
}
