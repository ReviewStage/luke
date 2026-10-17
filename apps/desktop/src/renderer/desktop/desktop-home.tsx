import type { TaskSummary } from "@luke/features/task-wire";
import { ErrorState, FolderIcon, WingFace } from "@luke/ui";
import { teammateCreator } from "@luke/ui/actor-model";
import { TAB_WORDS } from "@luke/ui/tab-strip-model";
import { orderTasks, TASK_ORDER, taskTime } from "@luke/ui/task-list-model";
import { useState } from "react";
import { APP_COMMAND, APP_SHORTCUTS } from "#shared/shortcuts";
import { ACTOR_SIZE, ActorMark, CreatorHeard } from "../actor-ref";
import { MemberDirectory, useMemberDirectory } from "../member-directory";
import { RepositoryPicture } from "../repository-picture";
import { Shortcut } from "../shortcut";
import { SPINNER_SIZE, Spinner } from "../spinner";
import { InboxItemRow } from "../tasks/inbox-list";
import {
  holderName,
  INBOX_HOLDER,
  type InboxListed,
  NEEDS_YOU,
  needsReader,
} from "../tasks/inbox-model";
import { RelativeTime } from "../tasks/relative-time";
import { useMinute } from "../tasks/task-time";
import type { TasksControl } from "../tasks/use-tasks-tab";
import { useWaitingItems } from "../tasks/use-waiting-items";
import { commandKeyshortcuts } from "../tooltip";
import { TaskStatusMark } from "./task-card";
import { useRowKeys } from "./use-row-keys";

/**
 * desktop-home.tsx -- the home page: the column the window rests on with no task open, saying what needs the developer and the tasks saved latest, and offering New task.
 *
 * It is one column at a reading measure, as a chat app's empty page is: a
 * greeting with New task beside it, then Inbox, every open Inbox item of the
 * workspace listed, a teammate's agent's among them, as the Inbox's own row draws it, the
 * task it is about after its title, a press opening the Inbox on it; then
 * Recent, the tasks of the workspace listed saved latest, each as the
 * sidebar draws a task, with its repository after its name, a press opening
 * it. Nothing waiting says so in the Inbox's own words. An account with no plan
 * yet in any workspace is welcomed instead: Luke's face, one line of what he does, and New
 * task. Nothing here names the sidebar, which may be folded away.
 *
 * ↑ and ↓ move through its rows, a launcher's way, from the window itself
 * as well as from a row, and Return opens the row reached, so a launch is a
 * key or two from a task; a key pressed anywhere else, the sidebar or a
 * field, is left to it. Until the task list is read the page draws nothing,
 * since what it says hangs on the list; a read refused says so under Recent,
 * with Retry, over whatever an earlier read listed.
 */

/** How many tasks Recent lists. */
const RECENT_COUNT = 6;

/** What Recent says where the plan list could not be read, as the sidebar says it. */
const UNREAD_LINE = "Your tasks could not be read.";

/** The greeting: the account's first name where it has one. */
function greeting(name: string | undefined): string {
  const first = name?.trim().split(/\s+/u)[0];
  return first === undefined || first === "" ? "Welcome back" : `Welcome back, ${first}`;
}

/** The workspace's plans with the latest activity, their own saves and their agents' alike, the archived left out. */
function recentTasks(plans: readonly TaskSummary[]): TaskSummary[] {
  return orderTasks(plans, TASK_ORDER.UPDATED).slice(0, RECENT_COUNT);
}

/** New task, with its chord: the home page's, and the empty Factory's (`desktop-factory.tsx`). */
function NewTaskButton({ tasks: plans }: { tasks: TasksControl }): React.JSX.Element {
  return (
    <button
      type="button"
      className="primary-button"
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.NEW_TASK)}
      disabled={!plans.signedIn}
      onClick={plans.onNewTask}
    >
      New task
      <Shortcut chord={APP_SHORTCUTS[APP_COMMAND.NEW_TASK].chord} />
    </button>
  );
}

/** A plan as the sidebar draws it, its repository after its name: the owner's picture, the name, the repository, and its mark and time, led by its creator's face where a teammate created it. */
export function RecentRow({
  task: plan,
  pictures,
  now,
  face = true,
  onOpen,
}: {
  task: TaskSummary;
  pictures: boolean;
  now: number;
  /** Whether a teammate's task wears its creator's face, which a person's own page says once in its head instead. */
  face?: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const teammate = teammateCreator(plan, useMemberDirectory());
  const creator = face ? teammate : undefined;
  return (
    <li className="sidebar-task-item home-row">
      <button type="button" className="sidebar-task" onClick={onOpen}>
        <span className="sidebar-task-line">
          <span className="home-row-picture">
            {plan.repository === null ? (
              <FolderIcon />
            ) : (
              <RepositoryPicture
                repository={plan.repository}
                pictures={pictures}
                fallback={<FolderIcon />}
              />
            )}
          </span>
          <span className="sidebar-task-name">{plan.name}</span>
          <span className="home-row-context">{plan.repository ?? "No repository"}</span>
          {creator === undefined ? null : <CreatorHeard actor={creator} />}
          <span className="sidebar-task-time">
            {creator === undefined ? null : <ActorMark actor={creator} size={ACTOR_SIZE.MARK} />}
            <TaskStatusMark task={plan} />
            <RelativeTime at={taskTime(plan, TASK_ORDER.UPDATED)} now={now} />
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * Inbox: the items that need the reader, a teammate's agent's left to the
 * Inbox, as the Dock's badge counts them, or what stands in their place
 * while they are read, failed, or none. It is headed by the Inbox's name,
 * the place a press on a row opens, and says it holds nothing waiting in the
 * Inbox's own words.
 */
function HomeInbox({
  tasks: plans,
  now,
}: {
  tasks: TasksControl;
  now: number;
}): React.JSX.Element | null {
  const read = useWaitingItems(plans);
  const waiting = { ...read, items: read.items.filter(({ item }) => needsReader(item, plans.me)) };
  const { inboxView } = plans;
  const open = ({ holder, item }: InboxListed) => {
    inboxView.onOpen();
    inboxView.onChoose(
      holder.kind === INBOX_HOLDER.TASK
        ? { taskId: holder.task.id, itemId: item.id }
        : { agentId: item.agentId, itemId: item.id },
    );
  };
  const empty = waiting.items.length === 0;
  // Note that a refused list read says nothing here, because what waits hangs on the list, which Recent says could not be read.
  if (empty && plans.listFailed) return null;
  return (
    <section className="home-section" aria-labelledby="home-inbox">
      <h2 className="home-section-title" id="home-inbox">
        {TAB_WORDS.INBOX}
        {empty ? null : <span className="home-section-count">{waiting.items.length}</span>}
      </h2>
      {empty ? null : (
        <ul className="sidebar-tasks">
          {waiting.items.map((listed) => (
            <InboxItemRow
              key={listed.item.id}
              listed={listed}
              chosen={false}
              now={now}
              models={plans.agents.models}
              readerId={plans.me}
              context={holderName(listed.holder)}
              onChoose={open}
            />
          ))}
        </ul>
      )}
      {waiting.failed ? (
        <div className="sidebar-note">
          <ErrorState onRetry={waiting.onRetry}>Some items could not be read.</ErrorState>
        </div>
      ) : empty && waiting.reading ? (
        <Spinner label="Loading inbox" size={SPINNER_SIZE.INLINE} />
      ) : empty ? (
        <p className="sidebar-note">{NEEDS_YOU.NONE}</p>
      ) : null}
    </section>
  );
}

/** Recent: the plans saved latest, under a refused read's Retry where the list could not be read, and nothing where neither stands. */
function HomeRecent({
  tasks: plans,
  now,
}: {
  tasks: TasksControl;
  now: number;
}): React.JSX.Element | null {
  const recent = recentTasks(plans.listed.tasks);
  if (recent.length === 0 && !plans.listFailed) return null;
  return (
    <section className="home-section" aria-labelledby="home-recent">
      <h2 className="home-section-title" id="home-recent">
        Recent
      </h2>
      {plans.listFailed ? (
        <div className="sidebar-note">
          <ErrorState onRetry={plans.onRetryList}>{UNREAD_LINE}</ErrorState>
        </div>
      ) : null}
      {recent.length === 0 ? null : (
        <ul className="sidebar-tasks">
          {recent.map((plan) => (
            <RecentRow
              key={plan.id}
              task={plan}
              pictures={plans.repositories.pictures}
              now={now}
              onOpen={() => plans.onSelect(plan.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** A new account's welcome: Luke's face and New task. */
function Welcome({ tasks }: { tasks: TasksControl }): React.JSX.Element {
  return (
    <section className="home-welcome" aria-label="Welcome">
      <span className="home-welcome-face" aria-hidden="true">
        <WingFace />
      </span>
      <h1 className="home-title">Start your first task</h1>
      <NewTaskButton tasks={tasks} />
    </section>
  );
}

/** The home page, in the task's place while no task is open. */
export function DesktopHome({
  tasks,
  accountName,
}: {
  tasks: TasksControl;
  /** The signed-in account's name, which greets it. */
  accountName: string | undefined;
}): React.JSX.Element | null {
  const now = useMinute();
  const [column, setColumn] = useState<HTMLDivElement | null>(null);
  useRowKeys(column, tasks.shown);
  if (!tasks.listRead && !tasks.listFailed) return null;
  // Only an account with no task in any workspace, and nothing an agent with
  // no task waits on, is new; a workspace of its own with none still says
  // what needs it elsewhere.
  const fresh =
    tasks.tasks.length === 0 && tasks.archived.length === 0 && tasks.inboxTaskless.length === 0;
  if (!tasks.listFailed && fresh) return <Welcome tasks={tasks} />;
  return (
    // The Inbox's agent cards name who started each agent, and Recent's rows
    // who created each teammate's task, read against the listed workspace's members.
    <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
      <div className="home-scroll scroll-fade-top">
        <div className="home-column" ref={setColumn}>
          <header className="home-head">
            <h1 className="home-title">{greeting(accountName)}</h1>
            <NewTaskButton tasks={tasks} />
          </header>
          <HomeInbox tasks={tasks} now={now} />
          <HomeRecent tasks={tasks} now={now} />
        </div>
      </div>
    </MemberDirectory>
  );
}
