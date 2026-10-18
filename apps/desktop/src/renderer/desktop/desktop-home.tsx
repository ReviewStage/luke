import type { TaskSummary } from "@luke/features/task-wire";
import { APP_COMMAND, APP_SHORTCUTS } from "@luke/settings/shortcuts";
import {
  BUTTON_VARIANT,
  Button,
  ErrorState,
  FolderIcon,
  List,
  ListRow,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
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
import { InboxItemRow, InboxListSkeleton } from "../tasks/inbox-list";
import {
  holderName,
  INBOX_HOLDER,
  type InboxListed,
  NEEDS_YOU,
  needsReader,
  waitsOnReader,
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
 * field, is left to it. Until the task list is read the page stands in its
 * own shape: New task, which the welcome offers too, and blocks where the
 * greeting, the sections' headings, and their rows will stand. It says no
 * word that hangs on the list, so a new account's welcome replaces it
 * without having claimed otherwise. A read refused says so under Recent,
 * with Retry, over whatever an earlier read listed.
 */

/** How many tasks Recent lists. */
const RECENT_COUNT = 6;

/** How many placeholder rows Home's Inbox stands while its items are read, fewer than a whole Inbox's. */
const INBOX_SKELETON_ROWS = 3;

/** What Recent's placeholder rows say to a reader while the task list is read. */
const READING_TASKS = "Reading your tasks…";

/** How wide the greeting's block stands, as wide as "Welcome back" and a first name in the title's type. */
const SKELETON_GREETING = "9em";

/** How wide each section heading's block stands, as wide as its word in the heading's type. */
const SKELETON_HEADING = { INBOX: "3em", RECENT: "3.5em" } as const;

/** How wide each of Recent's placeholder rows' names and repositories stand, one row for each task Recent lists, so the rows read as tasks of their own. */
const SKELETON_RECENT = [
  { name: "46%", repository: "5em" },
  { name: "34%", repository: "6em" },
  { name: "52%", repository: "5em" },
  { name: "40%", repository: "7em" },
  { name: "30%", repository: "5em" },
  { name: "44%", repository: "6em" },
] as const;

/** How wide a placeholder row's time stands, as wide as a short "2h". */
const SKELETON_TIME = "20px";

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
      <Shortcut chord={APP_SHORTCUTS[APP_COMMAND.NEW_TASK].chord} className="button-chord" />
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
        <InboxListSkeleton rows={INBOX_SKELETON_ROWS} context />
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

/** A section heading's block, in the heading's own type, where its word will stand. */
function HeadingSkeleton({ width }: { width: string }): React.JSX.Element {
  return (
    <div className="home-section-title">
      <Skeleton width={width} />
    </div>
  );
}

/** Recent's rows while the task list is read: blocks where each row's picture, name, repository, and time will stand. */
function RecentSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label={READING_TASKS}>
      <List label="Recent">
        {SKELETON_RECENT.map(({ name, repository }) => (
          <ListRow
            key={name}
            leading={
              <span className="home-row-picture">
                <Skeleton shape={SKELETON_SHAPE.BLOCK} />
              </span>
            }
            title={<Skeleton width={name} />}
            meta={
              <span className="home-row-meta">
                <Skeleton width={repository} />
                <Skeleton width={SKELETON_TIME} />
              </span>
            }
          />
        ))}
      </List>
    </SkeletonRegion>
  );
}

/**
 * The page while the task list is first read, in the shape of the page an
 * account with tasks lands on: the greeting's block beside New task, then
 * the Inbox's and Recent's heading blocks over rows of blocks, so the page
 * lands where the blocks stood.
 */
function HomeSkeleton({ tasks }: { tasks: TasksControl }): React.JSX.Element {
  return (
    <div className="home-scroll scroll-fade-top">
      <div className="home-column">
        <header className="home-head">
          <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.TITLE}>
            <Skeleton width={SKELETON_GREETING} />
          </Text>
          <NewTaskButton tasks={tasks} />
        </header>
        <div className="home-section">
          <HeadingSkeleton width={SKELETON_HEADING.INBOX} />
          <InboxListSkeleton rows={INBOX_SKELETON_ROWS} context />
        </div>
        <div className="home-section">
          <HeadingSkeleton width={SKELETON_HEADING.RECENT} />
          <RecentSkeleton />
        </div>
      </div>
    </div>
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
}): React.JSX.Element {
  const now = useMinute();
  const [column, setColumn] = useState<HTMLDivElement | null>(null);
  useRowKeys(column, tasks.shown);
  if (!tasks.listRead && !tasks.listFailed) return <HomeSkeleton tasks={tasks} />;
  // Only an account with no task in any workspace, and nothing an agent with
  // no task waits on it for, is new; a workspace of its own with none still
  // says what needs it elsewhere, while a teammate's agent's question, which
  // waits on the teammate and which Home does not list, leaves it new.
  const fresh =
    tasks.tasks.length === 0 &&
    tasks.archived.length === 0 &&
    !tasks.inboxTaskless.some((each) => waitsOnReader(each, tasks.me));
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
