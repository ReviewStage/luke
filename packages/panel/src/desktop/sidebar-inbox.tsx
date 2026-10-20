import { AutomationDirectory } from "../automation-directory.js";
import { INBOX_COLUMNS, useInboxRowPresses } from "../tasks/inbox-columns.js";
import { INBOX_LIST_PLACEMENT, InboxList, InboxListNote } from "../tasks/inbox-list.js";
import { anyUnread, type InboxListed, listedItems } from "../tasks/inbox-model.js";
import { choiceOf, type InboxListing } from "../tasks/use-inbox-listing.js";
import type { InboxChoice, TasksControl } from "../tasks/use-tasks-tab.js";

/**
 * sidebar-inbox.tsx -- the inbox-first sidebar's list: the window's Inbox in
 * the sidebar, under its places and its pins, where its task list stood.
 *
 * It lists what the shell read once (`use-inbox-listing.ts`), under the view
 * the Inbox's own page chooses, its tabs, its view's menu, and its folds
 * alike, so the two never list apart. A press on a row opens the Inbox on
 * that item in the plan's place, which shows the item alone while the list
 * stands here; the row of the item shown is the sidebar's current row. Where
 * nothing needs the reader it says so in the Inbox's own words, and no task
 * stands in its place, since the tasks are a page of their own now
 * (`tasks-page.tsx`).
 */

/** The window's Inbox as the sidebar lists it; see the module's head. */
export function SidebarInbox({
  tasks,
  listing,
  shown,
  onOpen,
}: {
  tasks: TasksControl;
  listing: InboxListing;
  /** Whether the sidebar is in sight, for the view's menu not to outlive it. */
  shown: boolean;
  /** Opens the Inbox on an item, from wherever the window stands. */
  onOpen: (choice: InboxChoice) => void;
}): React.JSX.Element {
  const rows = useInboxRowPresses();
  const {
    choices,
    folds,
    counts,
    standing,
    list,
    chosen,
    marks,
    closeItem,
    named,
    reading,
    filteredOut,
    read,
    archivedRead,
    taskless,
    showArchived,
    onRetry,
    openAutomation,
  } = listing;
  // Note that only the item the Inbox shows is the sidebar's current row; while another place stands, none is.
  const shownItem = tasks.inboxView.open ? chosen?.item.id : undefined;
  return (
    <AutomationDirectory workspace={tasks.workspace} wanted onOpen={openAutomation}>
      <InboxList
        placement={INBOX_LIST_PLACEMENT.SIDEBAR}
        view={list}
        chosen={shownItem}
        columns={INBOX_COLUMNS.BOTH}
        rows={rows}
        head={{
          shown,
          show: choices,
          counts,
          view: { choices, folds },
          readAll: {
            unread: anyUnread(standing),
            onMarkAll: () => marks.onMarkAll(standing.flatMap(({ items }) => items)),
          },
        }}
        models={named.models}
        readerId={tasks.me}
        note={
          <InboxListNote
            failed={showArchived ? archivedRead.failed : read.failed || taskless.failed}
            reading={reading}
            empty={listedItems(list).length === 0}
            alone={false}
            filteredOut={filteredOut ? choices : undefined}
            counts={counts}
            onList={() => undefined}
            onRetry={onRetry}
          />
        }
        onChoose={(listed: InboxListed) => onOpen(choiceOf(listed))}
        onMark={(listed, unread) => marks.onMark(listed.item, unread)}
        onClose={closeItem}
      />
    </AutomationDirectory>
  );
}
