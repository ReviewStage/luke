import type { MenuAction, MenuEntry } from "../menu/menu.js";
import type { SelectionAct } from "./selection-bar.js";

/**
 * selection-menu.ts -- the selection bar's acts as a row's menu, so a right-click, the ⋯ or the menu key on a chosen row offers what the bar does.
 *
 * A row inside a selection of several acts on all of them, as a Mac's list
 * does, so its menu is the bar's acts rather than its own thing's: each
 * act that does its act is an item, and each that drops a menu of choices
 * (a status, a section) is a submenu of those choices, in the order the
 * bar draws them. Choosing one does what pressing the bar's button would,
 * the selection let go after it where the act lets it go.
 */

/** One act as a row's menu draws it: an item, red where it cannot be taken back, or a submenu of its choices. */
function selectionEntry(act: SelectionAct): MenuEntry {
  const head = act.icon === undefined ? { label: act.label } : { label: act.label, icon: act.icon };
  if (act.menu === undefined) {
    return act.danger === true
      ? { ...head, onSelect: act.onAct, danger: true }
      : { ...head, onSelect: act.onAct };
  }
  // Note that a submenu draws no rule between its items, so the act's groups run on as one list.
  const items: readonly MenuAction[] = act.menu.flat();
  return { ...head, items };
}

/**
 * A row's menu groups for the selection `acts` take: one group, each act an
 * item or a submenu of its choices, and after it, alone, the acts that cannot
 * be taken back, as every menu of the window ends on its delete; none where
 * there is no act.
 */
export function selectionMenu(acts: readonly SelectionAct[]): readonly (readonly MenuEntry[])[] {
  const kept = acts.filter((act) => act.danger !== true).map(selectionEntry);
  const lost = acts.filter((act) => act.danger === true).map(selectionEntry);
  return [kept, lost].filter((group) => group.length > 0);
}
