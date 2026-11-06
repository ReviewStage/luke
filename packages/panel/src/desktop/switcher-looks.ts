import { type StripTab, tabKey } from "@repo/ui/tab-strip-model";
import { useEffect } from "react";
import type { TabLook } from "./strip-tabs.js";

export const LOOK_STRIP = {
  COLUMN: "column",
  PANEL: "panel",
} as const;

export type LookStrip = (typeof LOOK_STRIP)[keyof typeof LOOK_STRIP];

export type HeldLook = Pick<TabLook, "icon" | "label" | "endMark">;

const held = new Map<string, Map<LookStrip, ReadonlyMap<string, HeldLook>>>();

export function heldLook(strip: LookStrip, taskId: string, tab: StripTab): HeldLook | undefined {
  return held.get(taskId)?.get(strip)?.get(tabKey(tab));
}

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
