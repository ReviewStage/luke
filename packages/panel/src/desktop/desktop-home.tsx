import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { TaskSummary } from "@repo/features/task-wire";
import {
  Arrival,
  DetailPage,
  ErrorState,
  List,
  PAGE_FRAME,
  STATUS_TONE,
  useRovingKeys,
} from "@repo/ui";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { TAB_WORDS } from "@repo/ui/tab-strip-model";
import { TASK_ORDER, taskTime } from "@repo/ui/task-list-model";
import { useRef, useState } from "react";
import { useInboxRowDrafts } from "../composer-drafts.js";
import { unreadShown } from "../failure-report.js";
import { MemberDirectory } from "../member-directory.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { NOTICE_LOOK } from "../tasks/connect-agent-banner.js";
import { InboxItemRow, inboxRowDraft } from "../tasks/inbox-list.js";
import { type InboxListed, needsYou } from "../tasks/inbox-model.js";
import { MENTION_MENU_SIDE } from "../tasks/mention-picker.js";
import { NewTaskComposer } from "../tasks/new-task-composer.js";
import { choiceOf } from "../tasks/use-inbox-listing.js";
import { useUnreadTasks } from "../tasks/use-task-looks.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useWaitingItems, type WaitingItems } from "../tasks/use-waiting-items.js";
import { letGoOfFocus, useHomeNewTask, welcomed } from "./desktop-welcome.js";
import { PersonSectionFrame } from "./person-frame.js";
import { RecentTasks } from "./recent-tasks.js";

const RECENT_COUNT = {
  [SHELL_ROOM.WIDE]: 6,
  [SHELL_ROOM.NARROW]: 20,
} as const satisfies Record<ShellRoom, number>;

const RECENT = "Recent";

const READING_TASKS = "Reading your tasks…";

const ITEMS_NOT_READ = "Some inbox items could not be read.";

const TASKS_NOT_READ = "Your tasks could not be read.";

function greeting(name: string | undefined, fresh: boolean): React.JSX.Element {
  const first = name?.trim().split(/\s+/u)[0];
  const words = fresh ? "Welcome" : "Welcome back";
  return (
    <ReplayUnmask>
      {words}
      {first === undefined || first === "" ? null : (
        <>
          , <ReplayMask>{first}</ReplayMask>
        </>
      )}
    </ReplayUnmask>
  );
}

function recentTasks(tasks: readonly TaskSummary[], room: ShellRoom): TaskSummary[] {
  return tasks
    .toSorted((a, b) => taskTime(b, TASK_ORDER.UPDATED) - taskTime(a, TASK_ORDER.UPDATED))
    .slice(0, RECENT_COUNT[room]);
}

function useArriving(tasks: TasksControl, read: WaitingItems, waiting: number): boolean {
  const reading = !tasks.listRead && !tasks.listFailed;
  const [opened] = useState(reading);
  const [heard, setHeard] = useState(false);
  const inboxOut = opened && !heard && waiting === 0 && read.reading && !tasks.listFailed;
  if (tasks.listRead && !inboxOut && !heard) setHeard(true);
  return reading || inboxOut;
}

function HomeInbox({
  tasks,
  read,
  waiting,
}: {
  tasks: TasksControl;
  read: WaitingItems;
  waiting: readonly InboxListed[];
}): React.JSX.Element | null {
  const drafts = useInboxRowDrafts();
  const open = (listed: InboxListed) => tasks.inboxView.onOpenItem(choiceOf(listed));
  if (waiting.length === 0 && (tasks.listFailed || !read.failed)) return null;
  if (read.failed) {
    return (
      <div className="home-note my-tight-gap">
        <ErrorState failure={unreadShown(FAILURE_SURFACE.HOME_INBOX_READ)} onRetry={read.onRetry}>
          {ITEMS_NOT_READ}
        </ErrorState>
      </div>
    );
  }
  return (
    <PersonSectionFrame
      label={TAB_WORDS.INBOX}
      title={TAB_WORDS.INBOX}
      count={waiting.length}
      tone={STATUS_TONE.ATTENTION}
    >
      <ReplayMask>
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
      </ReplayMask>
    </PersonSectionFrame>
  );
}

function HomeRecent({
  tasks,
  room,
  staged,
}: {
  tasks: TasksControl;
  room: ShellRoom;
  staged: boolean;
}): React.JSX.Element | null {
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
        <ReplayMask>
          <RecentTasks
            tasks={tasks}
            label={RECENT}
            listed={recent}
            unread={unread}
            onOpen={tasks.onResume}
            joinsWalk
          />
        </ReplayMask>
      )}
    </PersonSectionFrame>
  );
}

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
        notices={NOTICE_LOOK.CARD}
      />
    </div>
  );
}

export function DesktopHome({
  tasks,
  room = SHELL_ROOM.WIDE,
  accountName,
  staged,
}: {
  tasks: TasksControl;
  room?: ShellRoom | undefined;
  accountName: string | undefined;
  staged: boolean;
}): React.JSX.Element {
  const roving = useRovingKeys<HTMLDivElement>();
  const takesFocus = room !== SHELL_ROOM.NARROW;
  const read = useWaitingItems(tasks);
  const waiting = read.items.filter((listed) => needsYou(listed, tasks.me));
  const arriving = useArriving(tasks, read, waiting.length);
  return (
    <DetailPage frame={PAGE_FRAME.PAGE} title={greeting(accountName, welcomed(tasks))}>
      <HomeComposer tasks={tasks} takesFocus={takesFocus} />
      <div className="home-rows contents" {...roving}>
        <ReplayUnmask>
          <Arrival reading={arriving} label={READING_TASKS}>
            <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
              <HomeInbox tasks={tasks} read={read} waiting={waiting} />
              <HomeRecent tasks={tasks} room={room} staged={staged} />
            </MemberDirectory>
          </Arrival>
        </ReplayUnmask>
      </div>
    </DetailPage>
  );
}
