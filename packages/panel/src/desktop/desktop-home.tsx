import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { TaskSummary } from "@repo/features/task-wire";
import {
  DetailPage,
  ErrorState,
  List,
  NOTE_LINE_LOOK,
  NoteLine,
  PAGE_FRAME,
  Skeleton,
  STATUS_TONE,
  useRovingKeys,
} from "@repo/ui";
import { TAB_WORDS } from "@repo/ui/tab-strip-model";
import { TASK_ORDER, taskTime } from "@repo/ui/task-list-model";
import { useRef } from "react";
import { useInboxRowDrafts } from "../composer-drafts.js";
import { unreadShown } from "../failure-report.js";
import { MemberDirectory } from "../member-directory.js";
import { SetupSections } from "../onboarding/setup-sections.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { InboxItemRow, InboxListSkeleton, inboxRowDraft } from "../tasks/inbox-list.js";
import { type InboxListed, NEEDS_YOU, needsYou } from "../tasks/inbox-model.js";
import { MENTION_MENU_SIDE } from "../tasks/mention-picker.js";
import { NewTaskComposer } from "../tasks/new-task-composer.js";
import { choiceOf } from "../tasks/use-inbox-listing.js";
import { useUnreadTasks } from "../tasks/use-task-looks.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useWaitingItems } from "../tasks/use-waiting-items.js";
import { letGoOfFocus, useHomeNewTask, welcomed } from "./desktop-welcome.js";
import { PersonSectionFrame, SectionSkeleton } from "./person-frame.js";
import { RecentTasks, RecentTasksSkeleton } from "./recent-tasks.js";

/**
 * desktop-home.tsx -- Home: the page the window rests on with no task open, opening on New task's composer under a greeting and saying what waits on the developer and the tasks worked on latest.
 *
 * It is one page (`DetailPage`), as a chat app's empty page is: the
 * greeting as its title, and at the top of its content New task's composer
 * (`new-task-composer.tsx`) in place of a New task button, drawn as the
 * dialog draws it, so the page opens on a prompt box the way Codex's and
 * ChatGPT's do; then Inbox, every open item of the listed workspace waiting
 * on the reader, as the Inbox's own row draws it, a press opening the Inbox
 * on it; then Recent, the listed workspace's tasks with the latest activity,
 * each the Tasks page's row as a person's page lists it (`recent-tasks.tsx`),
 * a press opening it. Its sections are a person's page's (`person-frame.tsx`),
 * whose voice was Home's to begin with. Nothing waiting says so in the
 * Inbox's own words. An account with nothing yet is greeted as new, and
 * asked over the composer for what setup left undone (`setup-sections.tsx`).
 * Nothing here names the sidebar, which may be folded away.
 *
 * The composer starts the task in the listed workspace, as the dialog
 * would. Home is New task's page: a New task press while it stands, ⌘N's
 * and the sidebar's among them, hands the composer's words the caret
 * rather than opening the dialog over the same card; the dialog stays for
 * every other place, and only Home holds the card inline. Its words take the caret as the page
 * shows, unless the developer is typing in a field elsewhere or the room is a
 * phone's, whose places bar a field typed in puts away, and Escape
 * there with nothing in it to close takes the caret out of the words. Its
 * words and files are New task's draft in the workspace, which the dialog
 * shares, so leaving Home keeps them.
 *
 * The rows of both sections are one Tab stop that ↑ and ↓ walk from the
 * first Inbox item to the last recent task (`useRovingKeys`), and Return
 * opens the row reached, so a launch is a key or two from a task. Until the
 * task list is read the page stands in its own shape: the composer, which
 * hangs on no list, and blocks where the greeting and the sections will
 * stand. A read refused says so under Recent, with Retry.
 */

/**
 * How many tasks Recent lists in each room: a few beside the sidebar, which
 * lists them all, and more on a phone, where the sidebar is a drawer and
 * Home, the page the app opens on, is the list at hand.
 */
const RECENT_COUNT = {
  [SHELL_ROOM.WIDE]: 6,
  [SHELL_ROOM.NARROW]: 20,
} as const satisfies Record<ShellRoom, number>;

/** What Recent is called, as its heading and its list. */
const RECENT = "Recent";

/** How wide the greeting's block stands, as wide as "Welcome back" and a first name in the title's type. */
const SKELETON_GREETING = "9em";

/** What the page says where an Inbox read did not answer, as the Inbox says it. */
const ITEMS_NOT_READ = "Some inbox items could not be read.";

/** What the page says where the task list could not be read, as the sidebar says it. */
const TASKS_NOT_READ = "Your tasks could not be read.";

/** The greeting: the account's first name where it has one, welcomed back unless the account is new. */
function greeting(name: string | undefined, fresh: boolean): string {
  const first = name?.trim().split(/\s+/u)[0];
  const words = fresh ? "Welcome" : "Welcome back";
  return first === undefined || first === "" ? words : `${words}, ${first}`;
}

/** The listed workspace's tasks with the latest activity, their own saves and their agents' alike. */
function recentTasks(tasks: readonly TaskSummary[], room: ShellRoom): TaskSummary[] {
  return tasks
    .toSorted((a, b) => taskTime(b, TASK_ORDER.UPDATED) - taskTime(a, TASK_ORDER.UPDATED))
    .slice(0, RECENT_COUNT[room]);
}

/** The greeting while the task list is read: a block where it will stand. */
function GreetingSkeleton(): React.JSX.Element {
  return <Skeleton width={SKELETON_GREETING} />;
}

/**
 * Inbox: the items waiting on the reader, a teammate's left to the Inbox,
 * as the Dock's badge counts them, or what stands in their place while they
 * are read, failed, or none. A press on a row opens the Inbox on its item.
 */
function HomeInbox({ tasks }: { tasks: TasksControl }): React.JSX.Element | null {
  const read = useWaitingItems(tasks);
  const drafts = useInboxRowDrafts();
  const waiting = read.items.filter((listed) => needsYou(listed, tasks.me));
  const open = (listed: InboxListed) => tasks.inboxView.onOpenItem(choiceOf(listed));
  // Note that a refused list read says nothing here, because what waits hangs on the list, which Recent says could not be read.
  if (waiting.length === 0 && tasks.listFailed) return null;
  if (read.failed) {
    return (
      <div className="home-note my-tight-gap">
        <ErrorState failure={unreadShown(FAILURE_SURFACE.HOME_INBOX_READ)} onRetry={read.onRetry}>
          {ITEMS_NOT_READ}
        </ErrorState>
      </div>
    );
  }
  if (waiting.length === 0 && read.reading) {
    return (
      <SectionSkeleton>
        <InboxListSkeleton />
      </SectionSkeleton>
    );
  }
  return (
    <PersonSectionFrame
      label={TAB_WORDS.INBOX}
      title={TAB_WORDS.INBOX}
      count={waiting.length === 0 ? undefined : waiting.length}
      tone={STATUS_TONE.ATTENTION}
    >
      {waiting.length === 0 ? (
        <NoteLine look={NOTE_LINE_LOOK.INSET}>{NEEDS_YOU.NONE}</NoteLine>
      ) : (
        <List label={TAB_WORDS.INBOX} joinsWalk>
          {waiting.map((listed) => (
            <InboxItemRow
              key={listed.item.id}
              listed={listed}
              chosen={false}
              {...inboxRowDraft(drafts.get(listed.item.id), listed.item, false)}
              models={tasks.agents.models}
              readerId={tasks.me}
              onChoose={open}
            />
          ))}
        </List>
      )}
    </PersonSectionFrame>
  );
}

/** Recent: the tasks worked on latest, under a refused read's Retry where the list could not be read, and nothing where neither stands. */
function HomeRecent({
  tasks,
  room,
  staged,
}: {
  tasks: TasksControl;
  room: ShellRoom;
  staged: boolean;
}): React.JSX.Element | null {
  // A task's row is unread as its sidebar row is, so its weight and its menu's Mark as read agree with the sidebar's.
  const unread = useUnreadTasks({ staged });
  const recent = recentTasks(tasks.listed.tasks, room);
  if (recent.length === 0 && !tasks.listFailed) return null;
  return (
    <PersonSectionFrame label={RECENT} title={RECENT}>
      {tasks.listFailed ? (
        <div className="home-note my-tight-gap">
          <ErrorState
            failure={unreadShown(FAILURE_SURFACE.HOME_TASKS_READ)}
            onRetry={tasks.onRetryList}
          >
            {TASKS_NOT_READ}
          </ErrorState>
        </div>
      ) : null}
      {recent.length === 0 ? null : (
        <RecentTasks tasks={tasks} label={RECENT} listed={recent} unread={unread} joinsWalk />
      )}
    </PersonSectionFrame>
  );
}

/**
 * New task's composer, at the top of the page as a chat app's empty page
 * opens on its prompt box; nothing while signed out, where nothing could
 * start. An `@` or `/` list opens under the caret's line, because one risen
 * over it from the page's top is cut off under the page's head.
 */
function HomeComposer({
  tasks,
  takesFocus,
}: {
  tasks: TasksControl;
  takesFocus: boolean;
}): React.JSX.Element | null {
  const box = useRef<HTMLDivElement>(null);
  useHomeNewTask(box, tasks.newTask.homeAsks);
  if (!tasks.signedIn) return null;
  return (
    <div className="home-composer ph-no-capture mb-page-section-gap" ref={box}>
      <NewTaskComposer
        newTask={{ ...tasks.newTask, preset: undefined }}
        workspaceId={tasks.newTask.workspaceId}
        onLeave={letGoOfFocus}
        takesFocus={takesFocus}
        listSide={MENTION_MENU_SIDE.BELOW}
      />
    </div>
  );
}

/** The sections while the task list is first read, in the shape of the page an account with tasks lands on. */
function HomeSectionsSkeleton(): React.JSX.Element {
  return (
    <>
      <SectionSkeleton>
        <InboxListSkeleton />
      </SectionSkeleton>
      <RecentTasksSkeleton label="Reading your tasks…" />
    </>
  );
}

/** Home, in the task's place while no task is open, with a new account's Finish setting up over its composer. */
export function DesktopHome({
  tasks,
  room = SHELL_ROOM.WIDE,
  accountName,
  staged,
}: {
  tasks: TasksControl;
  /** The room the panel's stage gives, which says how many tasks Recent lists; wide where left out. */
  room?: ShellRoom | undefined;
  /** The signed-in account's name, which greets it. */
  accountName: string | undefined;
  /** Whether a fixture stages the window, whose tasks' looks are its own rather than kept (`useUnreadTasks`). */
  staged: boolean;
}): React.JSX.Element {
  // The rows of both sections, one walk for ↑ and ↓ from the first Inbox item to the last task.
  const roving = useRovingKeys<HTMLDivElement>();
  // Note that on a phone the words leave the caret alone, because a field typed in puts the places bar away (`mobile-bar.tsx`).
  const takesFocus = room !== SHELL_ROOM.NARROW;
  const reading = !tasks.listRead && !tasks.listFailed;
  return (
    <DetailPage
      frame={PAGE_FRAME.PAGE}
      title={reading ? <GreetingSkeleton /> : greeting(accountName, welcomed(tasks))}
    >
      {/* A new account is asked here for what setup left undone, above the box that starts its first task. */}
      {welcomed(tasks) ? <SetupSections tasks={tasks} /> : null}
      <HomeComposer tasks={tasks} takesFocus={takesFocus} />
      {/* Note that the box lays nothing out: it only hears the arrows its rows walk by. */}
      <div className="home-rows contents" {...roving}>
        {reading ? (
          <HomeSectionsSkeleton />
        ) : (
          // The Inbox's rows name who started each agent, and Recent's who is on each task, read against the listed workspace's members.
          <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
            <HomeInbox tasks={tasks} />
            <HomeRecent tasks={tasks} room={room} staged={staged} />
          </MemberDirectory>
        )}
      </div>
    </DetailPage>
  );
}
