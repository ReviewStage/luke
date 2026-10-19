import type { TaskSummary } from "@luke/features/task-wire";
import { ACTOR_SIZE, ActorMark, CreatorHeard } from "@luke/panel/actor-ref";
import { TaskStatusMark } from "@luke/panel/desktop/task-card";
import { useRowKeys } from "@luke/panel/desktop/use-row-keys";
import { MemberDirectory, useMemberDirectory } from "@luke/panel/member-directory";
import { RepositoryPicture } from "@luke/panel/repository-picture";
import {
  holderName,
  INBOX_HOLDER,
  type InboxListed,
  NEEDS_YOU,
  needsReader,
  waitsOnReader,
} from "@luke/panel/tasks/inbox-model";
import { NewTaskComposer } from "@luke/panel/tasks/new-task-composer";
import { RelativeTime } from "@luke/panel/tasks/relative-time";
import { useMinute } from "@luke/panel/tasks/task-time";
import type { TasksControl } from "@luke/panel/tasks/use-tasks-tab";
import { useWaitingItems } from "@luke/panel/tasks/use-waiting-items";
import {
  DetailPage,
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
import { type ReactNode, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { InboxItemRow, InboxListSkeleton } from "../tasks/inbox-list";

/**
 * desktop-home.tsx -- the home page: the column the window rests on with no task open, opening on New task's composer and saying what needs the developer and the tasks saved latest.
 *
 * It is one page (`DetailPage`), as a chat app's empty page is: a greeting
 * standing still over the scroll, and at the top of the scroll New task's
 * composer card (`new-task-composer.tsx`) in place of a New task button, so
 * the page opens on a prompt box the way Codex's and ChatGPT's do; then
 * Inbox, every open Inbox item of the workspace listed, a teammate's
 * agent's among them, as the Inbox's own row draws it, the task it is about
 * after its title, a press opening the Inbox on it; then Recent, the tasks
 * of the workspace listed saved latest, each a `ListRow` with its
 * repository at its end before its time, a press opening it. Nothing
 * waiting says so in the Inbox's own words. An account with no plan yet in
 * any workspace is welcomed instead: Luke's face, one line, and the
 * composer under them. Nothing here names the sidebar, which may be folded
 * away.
 *
 * The composer starts the task in the workspace Home lists, as the dialog
 * would: in Agent mode a task with a coding agent on the words, opened on
 * its tab, and in Plan mode the plan and a call with Luke. The dialog stays
 * for ⌘N and every other New task press; only Home holds the card inline.
 * Its words take the caret as the page shows, unless the developer is
 * typing in a field elsewhere, as an agent's box decides; a key pressed in
 * the card is the card's, and Escape there with nothing in it to close lets
 * go of the words. Note that its words, files, and issue are the card's own
 * state, kept in no draft store, so leaving Home lets them go.
 *
 * ↑ and ↓ move through its rows, a launcher's way, from the window itself
 * as well as from a row, and Return opens the row reached, so a launch is a
 * key or two from a task; a key pressed anywhere else, the composer, the
 * sidebar, or a field, is left to it. Until the task list is read the page
 * stands in its own shape: the composer, which hangs on no list, and blocks
 * where the greeting, the sections' headings, and their rows will stand.
 * The composer stands in the one place while the list is read and once it
 * lands, so the list landing keeps what was typed meanwhile. It says no
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
        <List label={TAB_WORDS.INBOX}>
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
        </List>
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

/**
 * New task's composer, at the top of the page as a chat app's empty page
 * opens on its prompt box, starting the task in the workspace Home lists;
 * nothing while signed out, where nothing could start. Note that the press
 * that opens the dialog chooses its repository for the dialog alone, so
 * this card starts on none of it. Escape with nothing in the card to close
 * lets go of the words, so ↑ and ↓ reach the rows again.
 */
function HomeComposer({ tasks }: { tasks: TasksControl }): React.JSX.Element | null {
  if (!tasks.signedIn) return null;
  return (
    <NewTaskComposer
      newTask={{ ...tasks.newTask, preset: undefined }}
      workspaceId={tasks.newTask.workspaceId}
      from={undefined}
      onLeave={letGoOfFocus}
    />
  );
}

/** Where the page lays the composer: a box of its own, which the composer's one box is moved into. */
type ComposerSlot = (slot: HTMLElement | null) => void;

/**
 * One composer for every state of the page, drawn into a box of the page's
 * own that whichever state stands, the page or the welcome, takes into its
 * place, so the list landing as a new account's welcome moves the composer
 * rather than mounting it afresh, and the words typed while it was read
 * stand, the caret in them where it was. Note that the composer is drawn after the page, so its place is
 * taken before its words decide whether to take the caret.
 */
function useComposerSlot(composer: ReactNode): readonly [ReactNode, ComposerSlot] {
  const [box] = useState(() => {
    const made = document.createElement("div");
    made.className = "home-composer ph-no-capture";
    return made;
  });
  // What held the focus inside the box as its place went, given it back in the new one.
  const held = useRef<HTMLElement | null>(null);
  const place = useCallback<ComposerSlot>(
    (slot) => {
      // Note that a place going is told before it leaves the page, while
      // what holds the focus still holds it; the page drops the focus as the
      // box leaves with it.
      if (slot === null) {
        const active = document.activeElement;
        held.current = active instanceof HTMLElement && box.contains(active) ? active : null;
        return;
      }
      if (box.parentNode !== slot) slot.append(box);
      const was = held.current;
      held.current = null;
      const unfocused = document.activeElement === null || document.activeElement === document.body;
      if (was !== null && unfocused && box.contains(was)) was.focus();
    },
    [box],
  );
  return [createPortal(composer, box), place];
}

/** Hands the focus back to the page from whatever holds it, as Escape from an agent's box does. */
function letGoOfFocus(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

/** A new account's welcome: Luke's face and the line over the composer. */
function Welcome({ place }: { place: ComposerSlot }): React.JSX.Element {
  return (
    <section className="home-welcome" aria-label="Welcome">
      <span className="home-welcome-face" aria-hidden="true">
        <WingFace />
      </span>
      <Text as={TEXT_ELEMENT.H1} variant={TEXT_VARIANT.TITLE}>
        Start your first task
      </Text>
      <div className="home-composer-slot" ref={place} />
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
 * The sections while the task list is first read, in the shape of the page
 * an account with tasks lands on: the Inbox's and Recent's heading blocks
 * over rows of blocks, so the page lands where the blocks stood.
 */
function SectionsSkeleton(): React.JSX.Element {
  return (
    <>
      <section className="home-section">
        <HeadingSkeleton width={SKELETON_HEADING.INBOX} />
        <InboxListSkeleton rows={INBOX_SKELETON_ROWS} context />
      </section>
      <section className="home-section">
        <HeadingSkeleton width={SKELETON_HEADING.RECENT} />
        <RecentSkeleton />
      </section>
    </>
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
  const [rows, setRows] = useState<HTMLDivElement | null>(null);
  useRowKeys(rows, tasks.shown);
  const reading = !tasks.listRead && !tasks.listFailed;
  // Only an account with no task in any workspace, and nothing an agent with
  // no task waits on it for, is new; a workspace of its own with none still
  // says what needs it elsewhere, while a teammate's agent's question, which
  // waits on the teammate and which Home does not list, leaves it new.
  const fresh =
    tasks.tasks.length === 0 &&
    tasks.archived.length === 0 &&
    !tasks.inboxTaskless.some((each) => waitsOnReader(each, tasks.me));
  const [composer, place] = useComposerSlot(<HomeComposer tasks={tasks} />);
  if (!reading && !tasks.listFailed && fresh) {
    return (
      <>
        <Welcome place={place} />
        {composer}
      </>
    );
  }
  // Note that the composer stands in one place while the list is read and
  // once it lands, so the list landing keeps the words typed while it was
  // read and the caret in them.
  return (
    <>
      {/* Note that the rows the arrow keys move through are found inside this box, which lays nothing out. */}
      <div className="home-rows" ref={setRows}>
        <DetailPage
          title={reading ? <Skeleton width={SKELETON_GREETING} /> : greeting(accountName)}
        >
          <div className="home-composer-slot" ref={place} />
          {reading ? (
            <SectionsSkeleton />
          ) : (
            // The Inbox's agent cards name who started each agent, and Recent's rows
            // who created each teammate's task, read against the listed workspace's members.
            <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
              <HomeInbox tasks={tasks} now={now} />
              <HomeRecent tasks={tasks} now={now} />
            </MemberDirectory>
          )}
        </DetailPage>
      </div>
      {composer}
    </>
  );
}
