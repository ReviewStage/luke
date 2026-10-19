import {
  type ContextMenuProps,
  DIALOG_TONE,
  type DialogQuestion,
  NAV_COUNT_SHOWN,
  NAV_ITEM_VARIANT,
  NavItem,
} from "@luke/ui";
import type { ReactNode } from "react";
import { Tooltip } from "../tooltip.js";

/**
 * sidebar-group-header.tsx -- the header a group of rows folds under: the sidebar's repositories and creators, the Inbox's plans, and the summary's archived agents alike.
 *
 * It is a row with the task rows' own hover, in the headings' voice: the
 * group's glyph, which gives way to the fold's chevron while the header is
 * hovered or reached from the keyboard, pointing down while the group is
 * open and right while it is folded, then the group's name and whatever
 * the group says after it, a repository's pin. Folded, it counts what the
 * group holds after its name, shown with the chevron and read as "n tasks",
 * so a header at rest says nothing but its name. A group with no glyph,
 * a section of the account's own made without an icon, draws its name
 * alone, with no cell held for a glyph or the chevron, so nothing stands
 * empty before it. A steady count, the
 * Inbox's of what needs the developer, stands at rest too, as a mail app's
 * folder counts its unread mail, and is left out at none.
 *
 * A group with actions, a repository's ⋯ and +, stands them at the header's
 * end beside the fold rather than inside it, so pressing one folds nothing,
 * shown while the header is hovered or holds focus; a right-click anywhere
 * on the header is the ⋯'s second door, and the header stays ringed while
 * the menu it opened stands. The fold lands at once, as a sidebar's does,
 * so whatever a header folds is drawn or not in the render that pressed it.
 * A header naming something with a card of its own, the Inbox's group of an
 * automation's agents, hangs that card while the pointer rests on it.
 */

/** What a folded group's count is read as, one and many. */
export interface CountNoun {
  readonly one: string;
  readonly many: string;
}

const TASK_NOUN: CountNoun = { one: "task", many: "tasks" };

/** What a group's Archive tasks asks, a repository's or a section's, where a task in it has coding agents, which the archive stops and archives with them. */
export function archiveTasksQuestion(named: string, count: number): DialogQuestion {
  return {
    title: count === 1 ? "Archive task?" : `Archive ${count} tasks?`,
    body: `Archiving the tasks in ${named} will stop and archive all their agents. Unarchiving a task brings its agents back.`,
    verb: "Archive",
    running: "Archiving",
    tone: DIALOG_TONE.PRIMARY,
  };
}

/** A group's header, its press folding and unfolding the group. */
export function SidebarGroupHeader({
  glyph,
  name,
  folded,
  count,
  noun = TASK_NOUN,
  steady = false,
  trailing,
  actions,
  tooltip,
  card,
  menuOpen = false,
  contextMenu,
  onToggle,
}: {
  /** The group's glyph, or nothing, for a header that draws its name alone. */
  glyph: ReactNode;
  name: string;
  folded: boolean;
  count: number;
  noun?: CountNoun;
  /** Whether the folded count stands at rest rather than only under the pointer, and is left out at none. */
  steady?: boolean;
  /** Said after the name inside the fold, quietly: a pinned repository's pin. */
  trailing?: ReactNode;
  /** The group's buttons at the header's end, beside the fold rather than inside it. */
  actions?: ReactNode;
  /** The fold's hover hint, where the name alone does not say the whole of it. */
  tooltip?: string | undefined;
  /** The card the header hangs while the pointer rests on it, the Inbox's automation's, named by the group's name where no hint says more. */
  card?: React.ReactNode;
  /** Whether a menu the header opened stands, which keeps it ringed and its actions shown. */
  menuOpen?: boolean;
  /** The menu a right-click or a long press opens on the header (`useMenu`'s `contextMenu`). */
  contextMenu?: ContextMenuProps | undefined;
  onToggle: () => void;
}): React.JSX.Element {
  // Note that a steady count says nothing at none, because "0 need you" is no news.
  const counted = folded && !(steady && count === 0);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the right-click is a second door to the group's ⋯, which is the keyboard's.
    <div
      className="sidebar-repository-header"
      data-menu-open={menuOpen ? "true" : undefined}
      {...contextMenu}
    >
      <Tooltip label={tooltip ?? (card === undefined ? undefined : name)} card={card}>
        <NavItem
          variant={NAV_ITEM_VARIANT.HEAD}
          icon={glyph}
          expanded={!folded}
          mark={trailing}
          count={
            counted
              ? {
                  value: count,
                  noun: count === 1 ? noun.one : noun.many,
                  shown: steady ? NAV_COUNT_SHOWN.ALWAYS : NAV_COUNT_SHOWN.ON_HOVER,
                }
              : undefined
          }
          onClick={onToggle}
        >
          {name}
        </NavItem>
      </Tooltip>
      {actions === undefined ? null : <span className="sidebar-repository-actions">{actions}</span>}
    </div>
  );
}
