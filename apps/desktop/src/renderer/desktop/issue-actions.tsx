import { ISSUE_PRIORITY_WORDS, ISSUE_STATUS_WORDS } from "@luke/features/issue-list-model";
import { ISSUE_STATUS_ORDER, type Issue } from "@luke/features/issue-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import { useCopyLinkItem } from "@luke/panel/copy-link-item";
import { ActionMenu, type MenuAction, type MenuEntry } from "@luke/panel/desktop/action-menu";
import { PRIORITY_ORDER, PriorityGlyph, StatusGlyph } from "@luke/panel/desktop/issue-pickers";
import type { IssueChange } from "@luke/panel/desktop/use-issues";
import { ConfirmDialog, type DialogQuestion, useConfirmDialog, type useMenu } from "@luke/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { ArchiveIcon } from "lucide-react";
import { useStartItems } from "./issue-work";

/**
 * issue-actions.tsx -- an issue's actions as its card on the board and its row in the list offer them: its status and priority changed, a task started from it, its link copied, and its archive.
 *
 * The menu is the window's own (`action-menu.tsx`), opened by a right-click
 * on the card or row, or by the menu key or ⇧F10 while it holds the
 * keyboard. Status and Priority are submenus of every choice, the current
 * one checked, as the sidebar's Group by is; a pick is handed back for the
 * page to send, so the card moves the moment the answer lands. Start task…
 * and Start agent… (`issue-work.tsx`), Copy link
 * and Archive follow as the issue's own page offers them, and Archive asks
 * first, in the words that page asks in (`issue-detail.tsx`).
 */

/** What an issue's menu is called, on its page's ⋯ and on its card's or row's right-click. */
export const ISSUE_ACTIONS_LABEL = "Issue actions";

/** What a refused archive says in the dialog that asked, which stays up to say it. */
const ARCHIVE_REFUSED = "Couldn't archive it. Try again.";

/** Archive's question, wherever it is asked from. */
export function archiveQuestion(identifier: string): DialogQuestion {
  return {
    title: `Archive ${identifier}?`,
    body: "It leaves the list. Nothing else about it changes.",
    verb: "Archive",
    running: "Archiving",
  };
}

/** Archive's item, red since it asks before it takes the issue out of the list. */
export function archiveItem(onSelect: () => void): MenuAction {
  return { label: "Archive", icon: <ArchiveIcon />, onSelect, danger: true };
}

/** An archive's answer as its dialog reads it: kept, or refused with why. */
export function archiveAnswered(archived: boolean): ActionResult {
  return archived
    ? { status: ACTION_RESULT_STATUS.ACCEPTED }
    : { status: ACTION_RESULT_STATUS.REJECTED, reason: ARCHIVE_REFUSED };
}

/** Status and Priority, each a submenu of every choice with the issue's own checked; picking the one it holds sends nothing. */
function choiceEntries(issue: Issue, onChange: (change: IssueChange) => void): MenuEntry[] {
  const statuses: MenuAction[] = ISSUE_STATUS_ORDER.map((status) => ({
    label: ISSUE_STATUS_WORDS[status],
    icon: <StatusGlyph status={status} />,
    checked: status === issue.status,
    onSelect: () => {
      if (status !== issue.status) onChange({ status });
    },
  }));
  const priorities: MenuAction[] = PRIORITY_ORDER.map((priority) => ({
    label: ISSUE_PRIORITY_WORDS[priority],
    icon: <PriorityGlyph priority={priority} />,
    checked: priority === issue.priority,
    onSelect: () => {
      if (priority !== issue.priority) onChange({ priority });
    },
  }));
  return [
    { label: "Status", icon: <StatusGlyph status={issue.status} />, items: statuses },
    { label: "Priority", icon: <PriorityGlyph priority={issue.priority} />, items: priorities },
  ];
}

/**
 * A card's or row's menu, while its owner's `menu` draws one, and Archive's
 * question. The owner holds the menu, so the card or row it hangs from
 * opens it and takes focus back; the question stands while the page does.
 */
export function IssueActions({
  issue,
  identifier,
  menu,
  shown,
  onChange,
}: {
  issue: Issue;
  identifier: string;
  menu: ReturnType<typeof useMenu>;
  /** Whether the page stands, which a question asked on it does not outlive. */
  shown: boolean;
  /** Sends a change, answering whether it was kept. */
  onChange: (change: IssueChange) => Promise<boolean>;
}): React.JSX.Element {
  const archiving = useConfirmDialog({ subject: true, surfaceOpen: shown }, () =>
    onChange({ archived: true }).then(archiveAnswered),
  );
  const copyLink = useCopyLinkItem()({ kind: LINK_PLACE.ISSUE, issueId: issue.id });
  const starts = useStartItems(issue, identifier);
  const groups: MenuEntry[][] = [
    choiceEntries(issue, (change) => void onChange(change)),
    ...(starts.length === 0 ? [] : [starts]),
    ...(copyLink === undefined ? [] : [[copyLink]]),
    [archiveItem(archiving.ask)],
  ];
  return (
    <>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={ISSUE_ACTIONS_LABEL}
          menu={menu.drawn}
          groups={groups}
          onClose={menu.close}
        />
      )}
      <ConfirmDialog confirm={archiving} question={archiveQuestion(identifier)} />
    </>
  );
}
