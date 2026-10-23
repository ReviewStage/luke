import {
  automationOwner,
  automationRunStanding,
  automationTriggerText,
} from "@luke/features/automation-list-model";
import { AUTOMATION_SCOPE, type AutomationSummary } from "@luke/features/automation-wire";
import { LINK_PLACE, linkOf } from "@luke/features/luke-link";
import type { TaskSummary } from "@luke/features/task-wire";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { SETTINGS_SECTION, SETTINGS_VIEW } from "@luke/settings/settings-views";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BUTTON_VARIANT,
  Button,
  DetailPage,
  ErrorState,
  FILL_ELEMENT,
  Fill,
  IconButton,
  List,
  ListRow,
  OneLine,
  PAGE_FRAME,
  RowHint,
  RowHintOptions,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Time,
  Tooltip,
  useMenu,
  useMinute,
} from "@luke/ui";
import {
  ACTOR_KIND,
  type Actor,
  actorName,
  personActor,
  ROLE_WORDS,
  SOMEONE_REASON,
} from "@luke/ui/actor-model";
import {
  agentStarter,
  PERSON_TASKS_SHOWN,
  type PersonAgent,
  personPage,
  personPageEmpty,
  personRef,
} from "@luke/ui/person-page-model";
import { EllipsisIcon, LinkIcon, ListFilterIcon, MailIcon, UsersIcon } from "lucide-react";
import { type ReactNode, useCallback, useRef } from "react";
import { ACTOR_SIZE, ActorMark, AutomationCard, automationActor, YouBadge } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { LINK_COPY, useCopyToast } from "../copy-feedback.js";
import { MemberDirectory, useMemberDirectory } from "../member-directory.js";
import { NOT_FOUND_THING, NotFound } from "../not-found.js";
import { useOpenSettings } from "../open-settings.js";
import { stateEndMark } from "../state-glyph.js";
import { AgentCard, lineSubject } from "../tasks/agent-ref.js";
import { InboxItemRow, InboxListSkeleton } from "../tasks/inbox-list.js";
import { INBOX_HOLDER, type InboxListed, inboxWaitsOn } from "../tasks/inbox-model.js";
import { agentEndMark } from "../tasks/tab-look.js";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab.js";
import { useWaitingItems } from "../tasks/use-waiting-items.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import { STANDING_GLYPH } from "./automation-runs-panel.js";
import { automationNextText } from "./automation-words.js";
import {
  PersonHeadFrame,
  PersonHeadSkeleton,
  PersonNameSkeleton,
  PersonSectionFrame,
  PersonToolbar,
  PersonTop,
  PROFILE,
  RowsSkeleton,
  SectionSkeleton,
} from "./person-frame.js";
import { RecentRow } from "./recent-row.js";
import { useTaskListView } from "./task-list-view.js";
import type { TaskHeadBack } from "./task-pane-switcher.js";
import { useAutomations } from "./use-automations.js";

/**
 * person-page.tsx -- one person's page in the listed workspace: who they are there, and what of theirs the window already holds.
 *
 * It stands in the plan's place as an agent's page does, opened from
 * wherever the window names a member, the reader among them, or someone
 * who left. Its head is their face at the page's size, their name, and
 * their role and email as the members read lists them, or that they left.
 * Under it stand their agents at work, the Inbox
 * items their agents wait on, the tasks assigned to them, the rest of the
 * tasks they created, and their other
 * agents, each from the listed workspace's task list and Inbox
 * (`@luke/ui/person-page-model`), and the workspace's automations they
 * made, a section with nothing in it left out.
 * Until the members, the task list, the Inbox, and the automations are read,
 * placeholders stand where what each names will, and a read that failed
 * says that and offers Retry, so a page names nobody as someone outside the
 * workspace, and is called empty, only once its reads have answered.
 * Nothing on it is read for it: it shows a teammate only what the sidebar,
 * the Inbox, and an agent's card already show any member, never their
 * personal workspace, their answers, or another workspace's. A press on a
 * row opens what it names, and Escape leaves the page.
 */

/** What a page's head says under a name, by who the person is to the workspace. */
function headLine(person: Actor): string | undefined {
  if (person.kind === ACTOR_KIND.PERSON) {
    const role = person.role === undefined ? undefined : ROLE_WORDS[person.role];
    return [role, person.email].filter((part) => part !== undefined).join(" · ") || undefined;
  }
  if (person.kind === ACTOR_KIND.SOMEONE && person.reason === SOMEONE_REASON.FORMER) {
    return "Former member";
  }
  return "Not in this workspace";
}

/** The name the page heads with: a member's own, never "You", since the badge says so. */
function headName(person: Actor): string {
  return person.kind === ACTOR_KIND.PERSON ? person.name : actorName(person);
}

/** A section: its name and count, then its rows. */
function PersonSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <PersonSectionFrame label={title} title={title} count={count}>
      <List label={title}>{children}</List>
    </PersonSectionFrame>
  );
}

/** One of their agents as a row: its tile, its name, the task it works on, and when it last moved; a press opens its tab. */
function AgentRow({
  each,
  tasks,
  now,
}: {
  each: PersonAgent;
  tasks: TasksControl;
  now: number;
}): React.JSX.Element {
  const { task, agent } = each;
  const subject = lineSubject(agent, tasks.agents.models, tasks.me);
  const card = <AgentCard subject={subject} models={tasks.agents.models} />;
  return (
    <RowHintOptions card={card} cardBeside>
      <ListRow
        leading={
          <span className="home-row-picture">
            <ActorMark actor={subject.tile} />
          </span>
        }
        title={subject.name}
        hint={{ Hint: RowHint, label: subject.name }}
        meta={
          <span className="home-row-meta">
            <OneLine className="home-row-context" words={task.name}>
              {task.name}
            </OneLine>
            {agentEndMark(agent, false)}
            {agent.at === undefined ? null : <Time at={agent.at} now={now} hint={false} />}
          </span>
        }
        onPress={() => tasks.onShowAgent(task.id, agent.id)}
      />
    </RowHintOptions>
  );
}

/** What the page's ⋯ is called, on its button and its menu alike. */
const MORE = "More";

/**
 * The toolbar's end: their tasks in the sidebar, where the workspace is
 * shared and so filters by who created a task; and ⋯, holding Copy email for a
 * member and the workspace's members in Settings for its owners and admins.
 */
function PersonActions({
  tasks,
  userId,
  person,
  shared,
  onShowTasks,
  phone = false,
}: {
  tasks: TasksControl;
  userId: string;
  person: Actor;
  /** Whether the workspace is shared, which alone filters the sidebar by person. */
  shared: boolean;
  onShowTasks: () => void;
  /** Whether a phone heads the page, whose one ⋯ offers the sidebar's filter too, its button not drawn. */
  phone?: boolean;
}): React.JSX.Element {
  const openSettings = useOpenSettings();
  const copy = useCopyToast();
  const menu = useMenu(tasks.shown);
  const member = person.kind === ACTOR_KIND.PERSON ? person : undefined;
  const you = member?.you === true;
  const { workspace } = tasks;
  // Only a member the members read lists has a row there to manage; someone who left has none.
  const manages =
    member?.role !== undefined &&
    workspace !== undefined &&
    (workspace.role === WORKSPACE_ROLE.OWNER || workspace.role === WORKSPACE_ROLE.ADMIN);
  const email = member?.email;
  // Their link names the workspace their page stands in, by its slug where it has one.
  const homeId = tasks.personView.workspaceId ?? workspace?.id;
  const home = tasks.workspaces.find((each) => each.id === homeId);
  // A page whose workspace is not known has no link, rather than one naming no workspace.
  const slug = home?.slug ?? homeId;
  const link = slug === undefined ? undefined : linkOf({ kind: LINK_PLACE.PERSON, userId }, slug);
  const showTasks = you ? "My tasks in sidebar" : "Their tasks in sidebar";
  const actions: MenuAction[][] = [
    ...(phone && shared
      ? [[{ label: showTasks, icon: <ListFilterIcon />, onSelect: onShowTasks }]]
      : []),
    ...(link === undefined
      ? []
      : [
          [
            {
              label: LINK_COPY.LABEL,
              icon: <LinkIcon />,
              onSelect: () => copy(link, LINK_COPY.COPIED),
            },
          ],
        ]),
    ...(email === undefined
      ? []
      : [
          [
            {
              label: "Copy email",
              icon: <MailIcon />,
              onSelect: () => copy(email, "Email copied"),
            },
          ],
        ]),
    ...(workspace === undefined || !manages
      ? []
      : [
          [
            {
              label: "Manage in workspace settings",
              icon: <UsersIcon />,
              onSelect: () =>
                openSettings({
                  page: SETTINGS_VIEW.WORKSPACE,
                  workspaceId: workspace.id,
                  section: SETTINGS_SECTION.MEMBERS,
                }),
            },
          ],
        ]),
  ];
  const more =
    actions.length === 0 ? null : (
      <>
        <Tooltip label={MORE}>
          <IconButton icon={<EllipsisIcon />} label={MORE} {...menu.trigger()} />
        </Tooltip>
        {menu.drawn === undefined ? null : (
          <ActionMenu label={MORE} menu={menu.drawn} groups={actions} onClose={menu.close} />
        )}
      </>
    );
  if (phone) return <>{more}</>;
  return (
    <div className="desktop-toolbar-actions">
      {shared ? (
        <Button variant={BUTTON_VARIANT.OUTLINE} icon={<ListFilterIcon />} onClick={onShowTasks}>
          {showTasks}
        </Button>
      ) : null}
      {actions.length === 0 ? null : (
        <>
          <Tooltip label={MORE}>
            <IconButton icon={<EllipsisIcon />} label={MORE} {...menu.trigger()} />
          </Tooltip>
          {menu.drawn === undefined ? null : (
            <ActionMenu label={MORE} menu={menu.drawn} groups={actions} onClose={menu.close} />
          )}
        </>
      )}
    </div>
  );
}

/** The workspace's automations a person made, as read: whether the list is still being read or could not be, and its Retry. */
interface PersonAutomations {
  readonly automations: readonly AutomationSummary[];
  readonly reading: boolean;
  readonly failed: boolean;
  readonly onRetry: () => void;
}

/**
 * The workspace's automations the person made: the workspace's alone,
 * never their personal ones, which only they read. None while the list is read or where
 * it could not be, which the page says rather than pass for a person with none.
 */
function usePersonAutomations(workspaceId: string | undefined, userId: string): PersonAutomations {
  const { read, reload } = useAutomations(workspaceId);
  const none = { automations: [], reading: false, failed: false, onRetry: reload };
  if (workspaceId === undefined) return none;
  if (read === undefined) return { ...none, reading: true };
  if ("failure" in read) return { ...none, failed: true };
  const automations = read.automations.filter(
    (automation) =>
      automation.creatorId === userId && automationOwner(automation) === AUTOMATION_SCOPE.WORKSPACE,
  );
  return { ...none, automations };
}

/** One of their automations as a row: its clock wearing how its newest run went, its name, and what fires it, then a failure's mark and when it runs next, hanging its card; a press opens it. */
function AutomationRow({
  automation,
  workspaceName,
  now,
  onOpen,
}: {
  automation: AutomationSummary;
  workspaceName: string | undefined;
  now: number;
  onOpen: () => void;
}): React.JSX.Element {
  const trigger = automationTriggerText(automation.trigger, automation.repositories ?? []);
  const state = STANDING_GLYPH[automationRunStanding(automation.lastRun)];
  const item = useRef<HTMLElement | null>(null);
  // Note that the row's item is its press's parent, which its card counts as its control.
  const hold = useCallback((press: HTMLElement | null) => {
    item.current = press?.parentElement ?? null;
  }, []);
  return (
    <RowHintOptions
      card={<AutomationCard automation={automation} workspaceName={workspaceName} />}
      cardBeside
      cardRegion={item}
    >
      <ListRow
        ref={hold}
        leading={
          <span className="home-row-picture">
            <ActorMark actor={automationActor(automation)} />
          </span>
        }
        title={automation.name}
        meta={
          <span className="home-row-meta">
            <OneLine className="home-row-context" words={trigger}>
              {trigger}
            </OneLine>
            {stateEndMark(state, true)}
            <Text
              as={TEXT_ELEMENT.SPAN}
              variant={TEXT_VARIANT.CAPTION}
              tone={TEXT_TONE.MUTED}
              truncate
            >
              {automationNextText(automation, now)}
            </Text>
          </span>
        }
        hint={{ Hint: RowHint, label: automation.name }}
        onPress={onOpen}
      />
    </RowHintOptions>
  );
}

/** The page's head: their face, their name and You where it is the reader, and who they are here. */
function PersonHead({ person }: { person: Actor }): React.JSX.Element {
  const line = headLine(person);
  return (
    <PersonHeadFrame
      face={<ActorMark actor={person} size={ACTOR_SIZE.PAGE} />}
      name={
        <>
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.TITLE}>
            {headName(person)}
          </Text>
          {person.kind === ACTOR_KIND.PERSON && person.you ? <YouBadge /> : null}
        </>
      }
      line={
        line === undefined ? null : (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {line}
          </Text>
        )
      }
    />
  );
}

/**
 * One section of a person's tasks, the first `PERSON_TASKS_SHOWN` of them,
 * newest first, wearing no face, since the page's head says whose they
 * are; and under it, where it leaves some out and the sidebar filters by
 * person, Show all, which lists every one there (`onShowAll`).
 */
function PersonTasks({
  title,
  listed,
  tasks,
  now,
  onShowAll,
}: {
  title: string;
  listed: readonly TaskSummary[];
  tasks: TasksControl;
  now: number;
  onShowAll: (() => void) | undefined;
}): React.JSX.Element | null {
  if (listed.length === 0) return null;
  return (
    <>
      <PersonSection title={title} count={listed.length}>
        {listed.slice(0, PERSON_TASKS_SHOWN).map((task) => (
          <RecentRow
            key={task.id}
            tasks={tasks}
            task={task}
            now={now}
            face={false}
            onOpen={() => tasks.onSelect(task.id)}
          />
        ))}
      </PersonSection>
      {listed.length > PERSON_TASKS_SHOWN && onShowAll !== undefined ? (
        <p className="person-section-foot">
          <Button onClick={onShowAll}>{`Show all ${listed.length} in sidebar`}</Button>
        </p>
      ) : null}
    </>
  );
}

/** The page inside the workspace's member directory, which names the person. */
function PersonColumn({
  tasks,
  userId,
  name: opened,
  staged,
  away,
}: {
  tasks: TasksControl;
  userId: string;
  name: string | undefined;
  staged: boolean;
  away: TaskHeadBack | undefined;
}): React.JSX.Element {
  const now = useMinute();
  const listed = tasks.listed.tasks;
  // Named as the list names them, else as the members read does, else by the name the page was opened with, else as the former members read does; nobody's name where none does.
  const { members, readerId, former, refused, retry } = useMemberDirectory();
  const member = members?.find((each) => each.userId === userId);
  const known = opened === undefined ? undefined : { userId, name: opened };
  // Note that someone who left having only revised or answered is named by the former members read alone, since a link to them opens with no name.
  const left = former?.find((each) => each.userId === userId);
  const ref = personRef(userId, listed) ?? member ?? known ?? left;
  const person = personActor(ref, members, readerId, former);
  // The sidebar's own view, so their tasks are listed there as its Assigned to lists them, whoever created them, and those they created as its Created by does.
  const taskView = useTaskListView(tasks.workspace?.id, staged);
  const memberCount = tasks.workspace?.memberCount;
  const shared = memberCount === undefined ? (members?.length ?? 0) > 1 : memberCount > 1;
  const showTasks = () => taskView.onAssignedToAlone(userId);
  const showCreated = () => taskView.onCreatedByAlone(userId);
  const page = personPage(userId, listed);
  const you = userId === tasks.me;
  const theirAutomations = usePersonAutomations(tasks.workspace?.id, userId);
  const { automations } = theirAutomations;
  const read = useWaitingItems(tasks);
  // An item on a task is theirs where it waits on them (`inboxWaitsOn`), its task's assignee or else its agent's starter, by the task's row from a service that names neither.
  const waiting = read.items.filter(
    ({ holder, item }) =>
      holder.kind === INBOX_HOLDER.TASK &&
      (inboxWaitsOn(item)?.userId ?? agentStarter(holder.task, item.agentId)) === userId,
  );
  const { inboxView } = tasks;
  const openItem = ({ holder, item }: InboxListed) => {
    inboxView.onOpen();
    inboxView.onChoose(
      holder.kind === INBOX_HOLDER.TASK
        ? { taskId: holder.task.id, itemId: item.id }
        : { agentId: item.agentId, itemId: item.id },
    );
  };
  // Nobody the workspace's members or those who left name, as a link to someone outside it opens, is not found here; until both are read, nobody is.
  const unnamed = person.kind === ACTOR_KIND.SOMEONE && person.reason === SOMEONE_REASON.UNNAMED;
  if (unnamed && members !== undefined && former !== undefined) {
    return (
      <Fill as={FILL_ELEMENT.SECTION} className="automations-view" aria-label={PROFILE}>
        <NotFound thing={NOT_FOUND_THING.PERSON} />
      </Fill>
    );
  }
  // Note that someone nothing names yet is drawn as a placeholder, because only settled reads may say they are not in the workspace.
  const name = unnamed ? undefined : headName(person);
  const theirs = you ? "your" : "their";
  // A refused read will not name them, so the head says so and offers Retry rather than wait.
  const head = !unnamed ? (
    <PersonHead person={person} />
  ) : refused ? (
    <div className="home-note">
      <ErrorState
        onRetry={retry}
      >{`${you ? "Your" : "Their"} profile could not be read.`}</ErrorState>
    </div>
  ) : (
    <PersonHeadSkeleton />
  );
  return (
    <DetailPage
      frame={PAGE_FRAME.TOOLBAR}
      label={name ?? PROFILE}
      toolbar={
        <PersonToolbar
          name={name ?? (refused ? PROFILE : <PersonNameSkeleton />)}
          words={name}
          phoneBack={away}
        >
          <PersonActions
            tasks={tasks}
            userId={userId}
            person={person}
            shared={shared}
            onShowTasks={showTasks}
            phone={away !== undefined}
          />
        </PersonToolbar>
      }
    >
      <PersonTop>{head}</PersonTop>
      {tasks.listFailed ? (
        <div className="home-note">
          <ErrorState onRetry={tasks.onRetryList}>
            {`${you ? "Your" : "Their"} tasks could not be read.`}
          </ErrorState>
        </div>
      ) : !tasks.listRead && personPageEmpty(page) ? (
        <RowsSkeleton label={`Reading ${theirs} tasks…`} />
      ) : null}
      {page.working.length === 0 ? null : (
        <PersonSection title="Working now" count={page.working.length}>
          {page.working.map((each) => (
            <AgentRow key={each.agent.id} each={each} tasks={tasks} now={now} />
          ))}
        </PersonSection>
      )}
      {/* Note that the Inbox's placeholder, or its failure, stands where its section will, right after Working now. */}
      {read.failed ? (
        <div className="home-note">
          <ErrorState onRetry={read.onRetry}>Some Inbox items could not be read.</ErrorState>
        </div>
      ) : waiting.length === 0 && read.reading ? (
        <SectionSkeleton>
          <InboxListSkeleton />
        </SectionSkeleton>
      ) : null}
      {waiting.length === 0 ? null : (
        <PersonSection
          title={you ? "Waiting on you" : "Waiting on their answer"}
          count={waiting.length}
        >
          {waiting.map((listed) => (
            <InboxItemRow
              key={listed.item.id}
              listed={listed}
              chosen={false}
              now={now}
              models={tasks.agents.models}
              readerId={tasks.me}
              chip
              onChoose={openItem}
            />
          ))}
        </PersonSection>
      )}
      <PersonTasks
        title={you ? "Assigned to you" : "Assigned"}
        listed={page.assigned}
        tasks={tasks}
        now={now}
        onShowAll={shared ? showTasks : undefined}
      />
      <PersonTasks
        title={you ? "Created by you" : "Created"}
        listed={page.created}
        tasks={tasks}
        now={now}
        onShowAll={shared ? showCreated : undefined}
      />
      {page.agents.length === 0 ? null : (
        <PersonSection title="Agents" count={page.agents.length}>
          {page.agents.map((each) => (
            <AgentRow key={each.agent.id} each={each} tasks={tasks} now={now} />
          ))}
        </PersonSection>
      )}
      {automations.length === 0 ? null : (
        <PersonSection title="Automations" count={automations.length}>
          {automations.map((automation) => (
            <AutomationRow
              key={automation.id}
              automation={automation}
              workspaceName={tasks.workspace?.name}
              now={now}
              onOpen={() =>
                tasks.automationsView.onOpen({
                  kind: AUTOMATIONS_PAGE.EDIT,
                  automationId: automation.id,
                })
              }
            />
          ))}
        </PersonSection>
      )}
      {theirAutomations.failed ? (
        <div className="home-note">
          <ErrorState onRetry={theirAutomations.onRetry}>
            {`${you ? "Your" : "Their"} automations could not be read.`}
          </ErrorState>
        </div>
      ) : theirAutomations.reading ? (
        <RowsSkeleton label={`Reading ${theirs} automations…`} />
      ) : null}
      {/* Note that the page is said to be empty only once it names someone and the task list, the Inbox, and the automations have answered, since any may yet name something, or nobody may be found. */}
      {unnamed ||
      !tasks.listRead ||
      read.failed ||
      read.reading ||
      theirAutomations.failed ||
      theirAutomations.reading ? null : personPageEmpty(page) &&
        waiting.length === 0 &&
        automations.length === 0 ? (
        <div className="home-note">
          <Text tone={TEXT_TONE.MUTED}>
            {you ? "Nothing of yours here yet." : "Nothing of theirs here yet."}
          </Text>
        </div>
      ) : null}
    </DetailPage>
  );
}

/** A person's page, in the plan's place, read against the listed workspace's members. */
export function PersonPage({
  tasks,
  userId,
  name,
  staged = false,
  away,
}: {
  tasks: TasksControl;
  userId: string;
  /** The name the place that opened the page knew them by: someone who left, whom only an edit names. */
  name?: string | undefined;
  /** Whether the run is a fixture's, whose sidebar view is kept nowhere. */
  staged?: boolean;
  /** A phone's way back out of the page (`WindowHistory`'s `onLeave`), which heads it as a phone's page; none elsewhere. */
  away?: TaskHeadBack | undefined;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_PERSON_PAGE, tasks.personView.onClose);
  return (
    <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
      <PersonColumn tasks={tasks} userId={userId} name={name} staged={staged} away={away} />
    </MemberDirectory>
  );
}
