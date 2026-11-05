import { createContext } from "react";

/**
 * menu-replay.ts -- whether the menu standing round an item unmasks its
 * words in a screen recording (`Menu`'s and `SearchableMenu`'s
 * `replayUnmasked`), read by each item rather than handed down, since a
 * menu's rows stand in portals of their own, as its submenus and its
 * phone's sheet do, which no mark round the menu reaches.
 */
export const MenuReplayUnmasked = createContext(false);
