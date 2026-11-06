import type { TaskSummary } from "@repo/features/task-wire";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { BackButton, FILL_ELEMENT, Fill, Toolbar, useMinute } from "@repo/ui";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useCallback, useMemo, useState } from "react";
import { useAppCommand } from "../app-commands.js";
import { useInboxCloser } from "../tasks/inbox-close.js";
import {
  INBOX_COLUMNS,
  INBOX_VIEW,
  INBOX_VIEW_ITEMS,
  useInboxColumns,
} from "../tasks/inbox-columns.js";
import { InboxList, InboxListNote, InboxPaneEmpty, NOTHING_HERE } from "../tasks/inbox-list.js";
import {
  EVERYONES,
  INBOX_SHOW,
  type InboxListed,
  inboxAtNow,
  inboxCounts,
  inboxGroup,
  listedItems,
  taskHolder,
} from "../tasks/inbox-model.js";
import { useInboxPager } from "../tasks/inbox-pager.js";
import { InboxPane, type InboxPaneDoors } from "../tasks/inbox-pane.js";
import { useHeldInboxList } from "../tasks/use-held-inbox-list.js";
import { useInboxReadMarks, useNodOnOpen, useReadOnOpen } from "../tasks/use-inbox-read-marks.js";
import type { TaskInboxControl } from "../tasks/use-task-inbox.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { paneDoors } from "./desktop-inbox.js";

/**
 * agent-threads.tsx -- an agent's threads inside its card in the task's column: the Inbox's list of the items it posted beside the one chosen, both the window's Inbox's own.
 *
 * The dock over the agent's box (`threads-dock.tsx`) opens them in the
 * card, on the thread it names, and they stand in the transcript's place,
 * the transcript kept drawn beneath, hidden (`AgentPane`'s `hidden`), so
 * the way back, the list head's ‹ Transcript or Escape, finds it where it
 * was. Nothing here is drawn anew: the list is the Inbox's (`inbox-list.tsx`)
 * as an Inbox narrowed to a task lists it, every item, open and settled,
 * addressed to anyone, the latest changed first, held still while it is
 * shown (`use-held-inbox-list.ts`), but of this agent alone; the thread is
 * the Inbox's pane (`inbox-pane.tsx`), answered on the task's own held read
 * as the task's page holds it, with the window's Inbox's doors
 * (`desktop-inbox.tsx`'s `paneDoors`), bar its agent's crumb, which goes
 * back to the transcript, the agent's own. Choosing a row, or K and J,
 * shows its thread; an answer keeps the list beside it. Opening an item
 * reads it, and a notice is acknowledged as it opens, as in the Inbox. Too
 * narrow for both, the card shows one at a time as the Inbox does
 * (`inbox-columns.ts`).
 *
 * Each agent keeps whether its card shows its threads, and which, for as
 * long as the task's page stands (`useAgentThreadViews`), so going to
 * another agent's tab and back finds the card as it was left.
 */

/** What the card's way back says, and the place its hint names. */
const TRANSCRIPT = { LABEL: "Transcript", PLACE: "transcript" } as const;

/** What the list lists: every item, open or settled, as an Inbox narrowed to a task does. */
const AGENT_LISTS = { show: INBOX_SHOW.ALL, whose: EVERYONES } as const;

/** What an agent's card shows in its transcript's place: its threads, on the item chosen, none while the list stands alone. */
interface AgentThreadsShown {
  readonly itemId: string | undefined;
}

/** Which agents' cards show their threads, and the presses that change it. */
export interface AgentThreadViews {
  /** What the agent's card shows in its transcript's place; none where it shows its transcript. */
  readonly shown: (agentId: string) => AgentThreadsShown | undefined;
  /** Shows the agent's threads in its card, on the item given. */
  readonly onOpen: (agentId: string, itemId: string | undefined) => void;
  /** Gives the agent's card its transcript back. */
  readonly onClose: (agentId: string) => void;
}

/**
 * The pane's doors as the window's Inbox hands them for an item of a task
 * (`paneDoors`), the panel beside the card standing for the task, but for
 * the agent's own crumb, which goes back to its transcript in this card.
 */
function agentPaneDoors(
  tasks: TasksControl,
  listed: InboxListed,
  agentId: string,
  onBack: () => void,
): InboxPaneDoors {
  const doors = paneDoors(tasks, listed.holder, {
    panelFor: tasks.activeTaskId,
    openPlace: (_place, elsewhere) => elsewhere(),
    place: undefined,
  });
  return {
    ...doors,
    onOpenAgent: (each) => (each === agentId ? onBack() : doors.onOpenAgent(each)),
  };
}

/** Each agent's card's threads, by the agent, held while the task's page stands. */
export function useAgentThreadViews(): AgentThreadViews {
  const [views, setViews] = useState<ReadonlyMap<string, AgentThreadsShown>>(() => new Map());
  const onOpen = useCallback((agentId: string, itemId: string | undefined) => {
    setViews((was) => new Map(was).set(agentId, { itemId }));
  }, []);
  const onClose = useCallback((agentId: string) => {
    setViews((was) => {
      if (!was.has(agentId)) return was;
      const next = new Map(was);
      next.delete(agentId);
      return next;
    });
  }, []);
  return useMemo(
    () => ({ shown: (agentId: string) => views.get(agentId), onOpen, onClose }),
    [views, onOpen, onClose],
  );
}

/** The agent's threads in its card: the Inbox's list of its items beside the one chosen. */
export function AgentThreads({
  agentId,
  task,
  tasks,
  inbox,
  chosen,
  shown,
  active,
  onChoose,
  onBack,
}: {
  agentId: string;
  /** The task the agent works on, as the list names it, which holds its items. */
  task: TaskSummary;
  tasks: TasksControl;
  /** The task's own held read, which the task's page holds, and which answers its items. */
  inbox: TaskInboxControl;
  /** The id of the item shown; none while the list stands alone. */
  chosen: string | undefined;
  /** Whether the card is on screen. */
  shown: boolean;
  /** Whether the card holds the keys, for K, J, and Escape, and an item opened to be read. */
  active: boolean;
  onChoose: (itemId: string | undefined) => void;
  onBack: () => void;
}): React.JSX.Element {
  const { agents, me } = tasks;
  const { open, settled } = inbox.board;
  // Note that a reminder is weighed on the window's clock, as the Inbox weighs it.
  const now = useMinute();
  const standing = useMemo(
    () =>
      inboxAtNow(
        [
          inboxGroup(
            taskHolder(task),
            [...open, ...settled].filter((item) => item.agentId === agentId),
          ),
        ],
        now,
      ),
    [task, open, settled, agentId, now],
  );
  const filter = useMemo(() => ({ ...AGENT_LISTS, readerId: me }), [me]);
  const { list, steps, onPointing } = useHeldInboxList(standing, filter, chosen, shown);
  const listedRows = useMemo(() => listedItems(list), [list]);
  const listed = useMemo(
    () => listedItems(steps).find(({ item }) => item.id === chosen),
    [steps, chosen],
  );
  const counts = useMemo(() => inboxCounts(standing, me), [standing, me]);
  // Note that the card's columns hold no item while it is off screen, so no way back of theirs takes the window's Back meanwhile.
  const columns = useInboxColumns(shown ? chosen : undefined, {
    onClear: () => onChoose(undefined),
  });
  const choose = (each: InboxListed) => {
    columns.onOpen(each.item.id);
    onChoose(each.item.id);
  };
  const step = (each: InboxListed) => {
    columns.onStep();
    onChoose(each.item.id);
  };
  const pager = useInboxPager(steps, list, chosen, step, { shown: active });
  useAppCommand(APP_COMMAND.EXIT_AGENT_THREADS, active ? onBack : undefined);
  const marks = useInboxReadMarks({ workspaceId: tasks.workspace?.id });
  const closeItem = useInboxCloser();
  // The item shown is read as it opens, as the Inbox reads it, only while the card holds the keys.
  const opened = active && columns.shown !== INBOX_COLUMNS.LIST ? listed : undefined;
  useReadOnOpen({
    shown: opened?.item,
    chosen: listed?.item,
    active,
    onMark: marks.onMark,
  });
  // Note that the task's page holds its read with its cards' drafts, so the pane takes it whole.
  useNodOnOpen({ shown: opened, readerId: me, control: inbox });
  const back = (
    <ReplayUnmask>
      <BackButton
        label={TRANSCRIPT.LABEL}
        place={TRANSCRIPT.PLACE}
        command={APP_COMMAND.EXIT_AGENT_THREADS}
        onBack={onBack}
      />
    </ReplayUnmask>
  );
  return (
    <Fill as={FILL_ELEMENT.SECTION} className="agent-threads" data-popover-room="">
      <div className={INBOX_VIEW} ref={columns.ref} data-columns={columns.shown}>
        <InboxList
          view={list}
          chosen={chosen}
          columns={columns.shown}
          rows={columns.rows}
          head={{ shown: active, view: undefined, lead: back }}
          models={agents.models}
          readerId={me}
          reading={inbox.reading}
          note={
            <InboxListNote
              failed={inbox.failed}
              reading={inbox.reading}
              empty={listedRows.length === 0}
              alone={columns.shown === INBOX_COLUMNS.LIST}
              filteredOut={undefined}
              counts={counts}
              onList={columns.onList}
              onRetry={inbox.onRetry}
              none={NOTHING_HERE}
            />
          }
          onChoose={choose}
          onMark={(each, unread, saying) => marks.onMark(each.item, unread, saying)}
          onClose={closeItem}
          onRemind={marks.onRemind}
          onPointing={onPointing}
        />
        {listed === undefined ? (
          <section className={INBOX_VIEW_ITEMS} hidden={columns.shown !== INBOX_COLUMNS.BOTH}>
            <Toolbar />
            {inbox.failed || inbox.reading ? null : (
              <InboxPaneEmpty listed={listedRows.length} none={NOTHING_HERE} />
            )}
          </section>
        ) : (
          <InboxPane
            holder={listed.holder}
            item={listed.item}
            control={inbox}
            agents={agents}
            hidden={columns.shown === INBOX_COLUMNS.LIST}
            onBack={columns.onBack}
            pager={columns.shown === INBOX_COLUMNS.ITEM ? pager : undefined}
            doors={{
              ...agentPaneDoors(tasks, listed, agentId, onBack),
              onMark: marks.onMark,
              onClose: closeItem,
              onRemind: marks.onRemind,
            }}
          />
        )}
      </div>
    </Fill>
  );
}
