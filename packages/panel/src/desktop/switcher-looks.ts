/**
 * switcher-looks.ts -- each tab as its strip last drew it, its glyph, its name, and its end mark, which ⌃Tab's cards wear (`tab-switcher.tsx`).
 *
 * A strip draws its tabs only for the task open, from everything it reads
 * of that task's agents, files, and pages, so the switcher does not draw a
 * tab again from what it would have to read itself: each strip hands over
 * how it drew its tabs as it draws them, and a card wears that, as the tab
 * stood when it was last seen. The strip's whole set replaces the one it
 * handed last, so a tab closed is no longer held. It says only how a tab
 * looks: whether a tab still stands is its strip's own state's to say. It is
 * the window's memory alone, kept for as long as the window stands.
 */

import { type StripTab, tabKey } from "@luke/ui/tab-strip-model";
import { useEffect } from "react";
import type { TabLook } from "./strip-tabs.js";

/** The two strips a tab stands in. */
export const LOOK_STRIP = {
  COLUMN: "column",
  PANEL: "panel",
} as const;

export type LookStrip = (typeof LOOK_STRIP)[keyof typeof LOOK_STRIP];

/** How a card wears its tab: as the strip drew it. */
export type HeldLook = Pick<TabLook, "icon" | "label" | "endMark">;

/** Each task's strips, each the looks of the tabs it last drew by each tab's key. */
const held = new Map<string, Map<LookStrip, ReadonlyMap<string, HeldLook>>>();

/** How a strip drew its tab, the last time it drew it for `taskId`; none where it never did or the tab is closed. */
export function heldLook(strip: LookStrip, taskId: string, tab: StripTab): HeldLook | undefined {
  return held.get(taskId)?.get(strip)?.get(tabKey(tab));
}

/** Hands over how a strip draws its tabs for `taskId`, each time it draws them. */
export function useStripLooks(
  strip: LookStrip,
  taskId: string | undefined,
  drawn: readonly { readonly tab: StripTab; readonly look: TabLook }[],
): void {
  useEffect(() => {
    if (taskId === undefined) return;
    const looks = new Map(
      drawn.map(({ tab, look }) => [
        tabKey(tab),
        { icon: look.icon, label: look.label, endMark: look.endMark },
      ]),
    );
    const strips = held.get(taskId) ?? new Map<LookStrip, ReadonlyMap<string, HeldLook>>();
    strips.set(strip, looks);
    held.set(taskId, strips);
  });
}
