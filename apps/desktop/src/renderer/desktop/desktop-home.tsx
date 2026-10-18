import type { TaskSummary } from "@luke/features/task-wire";
import { APP_COMMAND, APP_SHORTCUTS } from "@luke/settings/shortcuts";
import {
  BUTTON_VARIANT,
  Button,
  ErrorState,
  FolderIcon,
  List,
  ListRow,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  WingFace,
} from "@luke/ui";
import { teammateCreator } from "@luke/ui/actor-model";
import { TAB_WORDS } from "@luke/ui/tab-strip-model";
import { orderTasks, TASK_ORDER, taskTime } from "@luke/ui/task-list-model";
import { useState } from "react";
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
 * Recent, the tasks of the workspace listed saved latest, each a `ListRow`
 * with its repository at its end before its time, a press opening it. Nothing waiting says so in the Inbox's own words. An account with no plan
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
function recentTasks(tasks: readonly TaskSummary[]): TaskSummary[] {
  return orderTasks(tasks, TASK_ORDER.UPDATED).slice(0, RECENT_COUNT);
}

/** New task, with its chord: the home page's, and the empty Factory's (`desktop-factory.tsx`). */
function NewTaskButton({ tasks }: { tasks: TasksControl }): React.JSX.Element {
  return (
    <Button
      variant={BUTTON_VARIANT.PRIMARY}
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.NEW_TASK)}
      disabled={!tasks.signedIn}
      onClick={tasks.onNewTask}
    >
      New task
      <Shortcut chord={APP_SHORTCUTS[APP_COMMAND.NEW_TASK].chord} />
    </Button>
  );
}

/** A plan as a `ListRow`: the owner's picture, the name, and at its end the repository, its creator's face where a teammate created it, and its mark and time. */
export function RecentRow({
  task,
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
  const teammate = teammateCreator(task, useMemberDirectory());
  const creator = face ? teammate : undefined;
  return (
    <ListRow
      leading={
        <span className="home-row-picture">
          {task.repository === null ? (
            <FolderIcon />
          ) : (
            <RepositoryPicture
              repository={task.repository}
              pictures={pictures}
              fallback={<FolderIcon />}
            />
          )}
        </span>
      }
      title={task.name}
      meta={
        <span className="home-row-meta">
          <span className="home-row-context">{task.repository ?? "No repository"}</span>
          {creator === undefined ? null : <CreatorHeard actor={creator} />}
          {creator === undefined ? null : <ActorMark actor={creator} size={ACTOR_SIZE.MARK} />}
          <TaskStatusMark task={task} />
          <RelativeTime at={taskTime(task, TASK_ORDER.UPDATED)} now={now} />
        </span>
      }
      onPress={onOpen}
    />
  );
}

/**
 * Inbox: the items that need the reader, a teammate's agent's left to the
 * Inbox, as the Dock's badge counts them, or what stands in their place
 * while they are read, failed, or none. It is headed by the Inbox's name,
 * the place a press on a row opens, and says it holds nothing waiting in the
 * Inbox's own words.
 */
function HomeInbox({ tasks, now }: { tasks: TasksControl; now: number }): React.JSX.Element | null {
  const read = useWaitingItems(tasks);
  const waiting = { ...read, items: read.items.filter(({ item }) => needsReader(item, tasks.me)) };
  const { inboxView } = tasks;
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
  if (empty && tasks.listFailed) return null;
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
              models={tasks.agents.models}
              readerId={tasks.me}
              context={holderName(listed.holder)}
              onChoose={open}
            />
          ))}
        </ul>
      )}
      {waiting.failed ? (
        <div className="home-note">
          <ErrorState onRetry={waiting.onRetry}>Some items could not be read.</ErrorState>
        </div>
      ) : empty && waiting.reading ? (
        <Spinner label="Loading inbox" size={SPINNER_SIZE.INLINE} />
      ) : empty ? (
        <div className="home-note">
          <Text tone={TEXT_TONE.MUTED}>{NEEDS_YOU.NONE}</Text>
        </div>
      ) : null}
    </section>
  );
}

/** Recent: the plans saved latest, under a refused read's Retry where the list could not be read, and nothing where neither stands. */
function HomeRecent({
  tasks,
  now,
}: {
  tasks: TasksControl;
  now: number;
}): React.JSX.Element | null {
  const recent = recentTasks(tasks.listed.tasks);
  if (recent.length === 0 && !tasks.listFailed) return null;
  return (
    <section className="home-section" aria-labelledby="home-recent">
      <h2 className="home-section-title" id="home-recent">
        Recent
      </h2>
      {tasks.listFailed ? (
        <div className="home-note">
          <ErrorState onRetry={tasks.onRetryList}>{UNREAD_LINE}</ErrorState>
        </div>
      ) : null}
      {recent.length === 0 ? null : (
        <List label="Recent">
          {recent.map((task) => (
            <RecentRow
              key={task.id}
              task={task}
              pictures={tasks.repositories.pictures}
              now={now}
              onOpen={() => tasks.onSelect(task.id)}
            />
          ))}
        </List>
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
      <Text as={TEXT_ELEMENT.H1} variant={TEXT_VARIANT.TITLE}>
        Start your first task
      </Text>
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
            <Text as={TEXT_ELEMENT.H1} variant={TEXT_VARIANT.TITLE}>
              {greeting(accountName)}
            </Text>
            <NewTaskButton tasks={tasks} />
          </header>
          <HomeInbox tasks={tasks} now={now} />
          <HomeRecent tasks={tasks} now={now} />
        </div>
      </div>
    </MemberDirectory>
  );
}
