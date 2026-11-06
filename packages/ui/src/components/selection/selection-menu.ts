import type { MenuAction, MenuEntry } from "../menu/menu.js";
import type { SelectionAct } from "./selection-bar.js";

function selectionEntry(act: SelectionAct): MenuEntry {
  const head = act.icon === undefined ? { label: act.label } : { label: act.label, icon: act.icon };
  if (act.menu === undefined) {
    return act.danger === true
      ? { ...head, onSelect: act.onAct, danger: true }
      : { ...head, onSelect: act.onAct };
  }
  const items: readonly MenuAction[] = act.menu.flat();
  return { ...head, items };
}

export function selectionMenu(acts: readonly SelectionAct[]): readonly (readonly MenuEntry[])[] {
  const kept = acts.filter((act) => act.danger !== true).map(selectionEntry);
  const lost = acts.filter((act) => act.danger === true).map(selectionEntry);
  return [kept, lost].filter((group) => group.length > 0);
}
