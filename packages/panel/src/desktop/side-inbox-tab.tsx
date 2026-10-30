import type { InboxItem } from "@luke/features/inbox-wire";
import { LINK_PLACE } from "@luke/features/link-grammar";
import { FAILURE_SURFACE } from "@luke/features/shown-failure";
import { REFRESH_FAILED_WORDS } from "@luke/features/words";
import { EmptyState, ERROR_STATE_PLACEMENT, ErrorState, Toolbar } from "@luke/ui";
import { InboxIcon } from "@luke/ui/icons";
import { searchTokens } from "@luke/ui/search-tokens";
import { useEffect, useState } from "react";
import { useAct } from "../act.js";
import { useCopyLinkItem } from "../copy-link-item.js";
import { unreadShown } from "../failure-report.js";
import { useInboxCloser } from "../tasks/inbox-close.js";
import {
  INBOX_COLUMNS,
  INBOX_VIEW,
  INBOX_VIEW_ITEMS,
  useInboxColumns,
} from "../tasks/inbox-columns.js";
import {
  InboxList,
  InboxListSkeleton,
  InboxPaneEmpty,
  NOTHING_HERE,
  SearchEmpty,
} from "../tasks/inbox-list.js";
import {
  EVERYONES,
  INBOX_NOT_READ,
  INBOX_SHOW,
  type InboxHolder,
  type InboxListed,
  listedItems,
} from "../tasks/inbox-model.js";
import { inboxNext, useInboxPager } from "../tasks/inbox-pager.js";
import { InboxPane, type InboxPaneDoors } from "../tasks/inbox-pane.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import { useHeldInboxList } from "../tasks/use-held-inbox-list.js";
import { useInboxReadMarks, useNodOnOpen, useReadOnOpen } from "../tasks/use-inbox-read-marks.js";
import { useInboxItemOpenSpan } from "../tasks/use-inbox-spans.js";
import type { TaskInboxControl } from "../tasks/use-task-inbox.js";

/**
 * side-inbox-tab.tsx -- the Inbox tab of a page's side panel: a task's, gathering its agents' items, or an agent's own page's, its one agent's.
 *
 * Both read through `use-task-inbox.ts`, a task's by its plan's scope and
 * an agent's by its own (`INBOX_SCOPE_KIND.AGENT`), drawing the account's
 * feed's items in their first frame and the holder's own read as it lands,
 * and draw the window's Inbox's list and pane over what they read.
 */

/** An item asked of the task's Inbox to open: one a link names by its id, or the thread under `key` a call's row names, of the agent whose row it was, any of the task's agents' where the row names none. */
export type InboxItemAsk =
  | { readonly taskId: string; readonly itemId: string }
  | { readonly taskId: string; readonly key: string; readonly agentId: string | undefined };

/** The item an ask names among a task's items: by its id, else the latest posted where more than one agent posted under its key. */
function askedItem(items: readonly InboxItem[], ask: InboxItemAsk): InboxItem | undefined {
  if ("itemId" in ask) return items.find((item) => item.id === ask.itemId);
  const named = items.filter(
    (item) => item.key === ask.key && (ask.agentId === undefined || item.agentId === ask.agentId),
  );
  return named.reduce<InboxItem | undefined>(
    (latest, item) => (latest === undefined || item.postedAt > latest.postedAt ? item : latest),
    undefined,
  );
}

/** What a side panel's own Inbox lists: every item its holder holds, open or settled, whoever it is addressed to. */
const TAB_LISTS = { show: INBOX_SHOW.ALL, whose: EVERYONES } as const;

/**
 * A side panel's own Inbox tab: every item its holder holds, newest first, in the window's Inbox's
 * list, under the window's head with no view's menu, and no groups since they are one
 * holder's, and the chosen item read beside them in the same pane, on the
 * holder's own held read. A holder whose read holds nothing says "Nothing
 * here" under the Inbox's glyph, with no press. The pane's holder crumb opens what `doors.onOpenHolder` opens and its agent crumb
 * the agent. Too narrow for both, it shows its list, however many items
 * it holds, and an item once a row's press or a link opens it, with its way
 * back to the list, as the window's Inbox does (`inbox-columns.ts`). K and J, and the pager where the item stands alone, step
 * through the list (`inbox-pager.tsx`). Its head's magnifier searches the
 * list as the window's Inbox's does, the item shown keeping its place. A
 * call's row that names a thread, or a link to an item, asks for it, which the tab opens
 * once its read holds it, or lets go once a read holds no such item.
 */
export function SideInboxTab({
  holder,
  workspaceId,
  inbox,
  agents,
  readerId,
  shown,
  ask,
  onAsked,
  doors,
}: {
  /** What holds the items: the task, or the agent of an agent's own page. */
  holder: InboxHolder;
  /** The workspace the items are of, whose read marks a press writes. */
  workspaceId: string | undefined;
  inbox: TaskInboxControl;
  /** The holder's agents, which name an item's agent and hear what an answer woke. */
  agents: AgentsControl;
  /** The reader's account id, which says whose of the open items wait on them; none before it is known. */
  readerId: string | undefined;
  /** Whether the tab is on screen: its page shown with its panel open. */
  shown: boolean;
  /** The item a call's row or a link asked for, none where none waits to be opened. */
  ask: InboxItemAsk | undefined;
  onAsked: () => void;
  doors: Pick<InboxPaneDoors, "onOpenHolder" | "taskCard" | "onOpenAgent" | "code">;
}): React.JSX.Element {
  const [asked, setAsked] = useState<string | undefined>(undefined);
  const { act } = useAct();
  const closeItem = useInboxCloser({ act, onHeard: agents.onRetryList });
  // Note that the holder's read draws the window's own marks, answers, and messages already, as the host draws them into it (`@luke/host`'s `inbox-collections.ts`).
  const groups = [{ holder, items: [...inbox.board.open, ...inbox.board.settled] }];
  // Note that a panel's own Inbox offers no Mark all as read.
  const marks = useInboxReadMarks({ act, workspaceId });
  const items = groups.flatMap((group) => group.items);
  // The list's search, as the window's Inbox holds it, which narrows what it lists, never what it counts.
  const [query, setQuery] = useState("");
  const search = searchTokens(query);
  const searched = search.length > 0 ? query : undefined;
  const filter = { ...TAB_LISTS, search, readerId };
  // The rows hold what the filter lists and the chosen row they drew, while the steps keep the item the pane shows in its
  // place, both held still while the tab is shown (`use-held-inbox-list.ts`).
  const { list, steps, onPointing } = useHeldInboxList(groups, filter, asked, shown);
  const listed = listedItems(list);
  // Note that nothing is chosen until a row's press or a call's row chooses it, so the pane beside the list stands empty till then.
  const chosen = listedItems(steps).find(({ item }) => item.id === asked);
  const columns = useInboxColumns(chosen?.item.id, { onClear: () => setAsked(undefined) });
  // The tab's ⋯ copies the open item's link, and none while the list stands alone, since no link names a panel's Inbox whole.
  const linkItem = useCopyLinkItem();
  const link =
    chosen === undefined || columns.shown === INBOX_COLUMNS.LIST
      ? undefined
      : linkItem({
          kind: LINK_PLACE.INBOX_ITEM,
          agentId: chosen.item.agentId,
          itemId: chosen.item.id,
        });
  const choose = ({ item }: InboxListed) => setAsked(item.id);
  const timeOpen = useInboxItemOpenSpan(chosen?.item.id, inbox.read);
  // A row's press and Next's open their item alike, the keyboard following it.
  const open = (listed: InboxListed) => {
    timeOpen(listed.item.id);
    choose(listed);
    columns.onOpen(listed.item.id);
  };
  // The item a call's row asked for is opened once the read holds it, as a row's press opens it.
  const openColumn = columns.onOpen;
  const asking = ask === undefined ? undefined : askedItem(items, ask);
  const settled = ask !== undefined && (asking !== undefined || inbox.read);
  useEffect(() => {
    if (!settled) return;
    onAsked();
    if (asking === undefined) return;
    setAsked(asking.id);
    openColumn(asking.id);
  }, [settled, asking, onAsked, openColumn]);
  const opened = shown && columns.shown !== INBOX_COLUMNS.LIST ? chosen : undefined;
  useReadOnOpen({
    shown: opened?.item,
    chosen: chosen?.item,
    active: shown,
    onMark: marks.onMark,
  });
  // A notice of the reader's own is acknowledged as it opens, as the window's Inbox acknowledges it.
  useNodOnOpen({ shown: opened, readerId, control: inbox });
  // K and J choose the item above or below, the keyboard following it to its row.
  const step = (listed: InboxListed) => {
    timeOpen(listed.item.id);
    choose(listed);
    columns.onStep();
  };
  const { pager, direction } = useInboxPager(steps, list, chosen?.item.id, step, {
    shown,
  });
  const next = inboxNext(steps, chosen, { models: agents.models, readerId }, open, direction);
  return (
    <section
      ref={columns.ref}
      className={INBOX_VIEW}
      role="tabpanel"
      aria-label="Inbox"
      data-columns={columns.shown}
    >
      <InboxList
        view={list}
        chosen={chosen?.item.id}
        columns={columns.shown}
        rows={columns.rows}
        head={{
          shown,
          view: undefined,
          search: { query, onQuery: setQuery },
          tab: true,
          link,
        }}
        models={agents.models}
        readerId={readerId}
        reading={inbox.reading}
        onPointing={onPointing}
        note={
          inbox.reading ? (
            <InboxListSkeleton />
          ) : inbox.failed ? (
            // A refresh that failed over rows already held leaves them drawn, with a line at the foot.
            <ErrorState
              failure={unreadShown(FAILURE_SURFACE.INBOX_READ)}
              onRetry={inbox.onRetry}
              placement={ERROR_STATE_PLACEMENT.ROWS}
            >
              {listed.length === 0 ? INBOX_NOT_READ : REFRESH_FAILED_WORDS}
            </ErrorState>
          ) : inbox.drawn && searched !== undefined && listed.length === 0 ? (
            <SearchEmpty searched={searched} />
          ) : inbox.drawn && listed.length === 0 && columns.shown !== INBOX_COLUMNS.BOTH ? (
            // Note that the list standing alone says what the hidden pane would, as the pane says it.
            <EmptyState icon={<InboxIcon />}>{NOTHING_HERE}</EmptyState>
          ) : null
        }
        onChoose={open}
        onMark={(listed, unread, saying) => marks.onMark(listed.item, unread, saying)}
        onClose={closeItem}
      />
      {chosen === undefined ? (
        <section className={INBOX_VIEW_ITEMS} hidden={columns.shown !== INBOX_COLUMNS.BOTH}>
          {/* The empty pane keeps a bar the list's head's height, as the window's Inbox does. */}
          <Toolbar />
          {/* Note that the list says what its search left out, so the pane beside it stands bare. */}
          {inbox.drawn && searched === undefined ? (
            <InboxPaneEmpty listed={listed.length} none={NOTHING_HERE} />
          ) : null}
        </section>
      ) : (
        <InboxPane
          holder={holder}
          item={chosen.item}
          control={inbox}
          agents={agents}
          hidden={columns.shown === INBOX_COLUMNS.LIST}
          onBack={columns.onBack}
          pager={columns.shown === INBOX_COLUMNS.ITEM ? pager : undefined}
          next={next}
          doors={{ ...doors, onMark: marks.onMark, onClose: closeItem }}
        />
      )}
    </section>
  );
}
