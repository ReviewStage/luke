import { type DisclosureControl, NAV_COUNT_SHOWN, type NavCount } from "@repo/ui";

export interface CountNoun {
  readonly one: string;
  readonly many: string;
}

export const SIDEBAR_SECTION_SLOT =
  "sidebar-section-slot pt-tight-gap pr-row-inset pb-item-gap pl-sidebar-slot-start";

export const TASK_NOUN: CountNoun = { one: "task", many: "tasks" };

export function groupCount(count: number, noun: CountNoun = TASK_NOUN): NavCount {
  return { value: count, noun: count === 1 ? noun.one : noun.many };
}

export function sidebarFold(folded: boolean, onToggle: () => void): DisclosureControl {
  return {
    open: !folded,
    onOpenChange: (open) => {
      if (open === folded) onToggle();
    },
  };
}

export function foldedCount(
  folded: boolean,
  count: number,
  noun: CountNoun,
  shown: NavCount["shown"] = NAV_COUNT_SHOWN.ON_HOVER,
): NavCount | undefined {
  return folded ? { value: count, noun: count === 1 ? noun.one : noun.many, shown } : undefined;
}
