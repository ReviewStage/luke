import {
  automationOwner,
  automationRunStanding,
  automationTriggerText,
} from "@luke/features/automation-list-model";
import { AUTOMATION_SCOPE, type AutomationSummary } from "@luke/features/automation-wire";
import { LINK_PLACE, linkOf } from "@luke/features/link-grammar";
import type { TaskSummary } from "@luke/features/task-wire";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { SETTINGS_SECTION, SETTINGS_VIEW } from "@luke/settings/settings-views";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BUTTON_VARIANT,
  Button,
  DetailPage,
  ErrorState,
  Fill,
  GAP,
  List,
  ListRow,
  MoreButton,
  moreLabel,
  NOT_FOUND_THING,
  NOTE_LINE_LOOK,
  NoteLine,
  NotFound,
  OneLine,
  PAGE_FRAME,
  RowHint,
  RowHintOptions,
  ShowMoreRow,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Time,
  type ToolbarPickUp,
  useLeaving,
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
import { LinkIcon, ListFilterIcon, MailIcon, UsersIcon } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { ACTOR_SIZE, ActorMark, AutomationCard, automationActor, YouBadge } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { LINK_COPY, useCopyToast } from "../copy-feedback.js";
import { agentPlace, LinkWorkspaceProvider, useCopyLinkItem } from "../copy-link-item.js";
import { MemberDirectory, useMemberDirectory } from "../member-directory.js";
import { useOpenSettings } from "../open-settings.js";
import { stateEndMark } from "../state-glyph.js";
import { AgentCard, lineSubject } from "../tasks/agent-ref.js";
import { InboxItemRow, InboxListSkeleton } from "../tasks/inbox-list.js";
import { INBOX_HOLDER, type InboxListed, inboxWaitsOn } from "../tasks/inbox-model.js";
import { agentEndMark } from "../tasks/tab-look.js";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab.js";
import { useWaitingItems } from "../tasks/use-waiting-items.js";
import { ActionMenu, type MenuAction, rowMenu } from "./action-menu.js";
import { useAgentArchive } from "./agent-archive.js";
import { STANDING_GLYPH } from "./automation-runs-panel.js";
import { automationNextText } from "./automation-words.js";
import {
  PersonBody,
  PersonLineSkeleton,
  PersonReadingSkeleton,
  PersonSectionFrame,
  PersonTitle,
  PersonTitleSkeleton,
  PersonTop,
  PROFILE,
  RowsSkeleton,
  SectionSkeleton,
} from "./person-frame.js";
import { PhoneBack, PhoneHead, phoneBar } from "./phone-head.js";
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
 * row opens what it names, and its ⋯, a right-click, and the menu key open
 * its acts: a task's the sidebar's, an agent's Copy link and Archive, an
 * Item's and an automation's Copy link, each link written under the
 * workspace the page stands in. Its lists move: a row arriving slides in, one
 * leaving slides out, and one taken from a section into another glides
 * across. Escape leaves the page.
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
      <List label={title} moves>
        {children}
      </List>
    </PersonSectionFrame>
  );
}

/** What an agent's row is, naming its ⋯ and menu "Agent actions". */
const AGENT_THING = "Agent";

/** What an automation's row is, naming its ⋯ and menu "Automation actions". */
const AUTOMATION_THING = "Automation";

/**
 * One of their agents as a row: its tile, its name, the task it works on,
 * and when it last moved; a press opens its tab, and its ⋯, right-click and
 * menu key offer Copy link and Archive, as a task's summary offers them,
 * asking first while a teammate's agent still works.
 */
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
  const archive = useAgentArchive(agent, tasks.agents, tasks.shown);
  const copyLink = useCopyLinkItem()(agentPlace({ id: agent.id, planId: task.id }));
  return (
    <>
      <RowHintOptions card={card} cardBeside>
        <ListRow
          motionKey={agent.id}
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
          menu={rowMenu(
            AGENT_THING,
            copyLink === undefined ? [[archive.action]] : [[copyLink], [archive.action]],
            tasks.shown,
          )}
        />
      </RowHintOptions>
      {archive.dialog}
    </>
  );
}

/** An agent's key, by which its row leaves its list and glides into another (`ListMotion`). */
function agentKey({ agent }: PersonAgent): string {
  return agent.id;
}

/** A section's agents, a row no longer listed drawn on until its exit has played (`useLeaving`). */
function AgentRows({
  agents,
  tasks,
  now,
}: {
  agents: readonly PersonAgent[];
  tasks: TasksControl;
  now: number;
}): React.JSX.Element {
  const drawn = useLeaving(agents, agentKey);
  return (
    <>
      {drawn.map(({ key, value }) => (
        <AgentRow key={key} each={value} tasks={tasks} now={now} />
      ))}
    </>
  );
}

/** What the page's ⋯ is called, on its button and its menu alike. */
const PERSON = "Person";

/**
 * The workspace the page's links are written under: the one its page stands
 * in, by its slug where it has one, else by its id; none where it is not
 * known, so nothing copies a link that names no workspace.
 */
function linkWorkspaceOf(tasks: TasksControl): string | undefined {
  const homeId = tasks.personView.workspaceId ?? tasks.workspace?.id;
  const home = tasks.workspaces.find((each) => each.id === homeId);
  return home?.slug ?? homeId;
}

/**
 * The header's end: their tasks in the sidebar, where the workspace is
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
  const slug = linkWorkspaceOf(tasks);
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
  return (
    <>
      {shared && !phone ? (
        <Button variant={BUTTON_VARIANT.OUTLINE} icon={<ListFilterIcon />} onClick={onShowTasks}>
          {showTasks}
        </Button>
      ) : null}
      {actions.length === 0 ? null : (
        <>
          <MoreButton thing={PERSON} {...menu.trigger()} />
          {menu.drawn === undefined ? null : (
            <ActionMenu
              label={moreLabel(PERSON)}
              menu={menu.drawn}
              groups={actions}
              onClose={menu.close}
            />
          )}
        </>
      )}
    </>
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
  // Note that their automations keep one identity while the read stands, because the list that draws them follows it (`useLeaving`).
  const theirs = useMemo(
    () =>
      read === undefined || "failure" in read
        ? []
        : read.automations.filter(
            (automation) =>
              automation.creatorId === userId &&
              automationOwner(automation) === AUTOMATION_SCOPE.WORKSPACE,
          ),
    [read, userId],
  );
  const none = { automations: [], reading: false, failed: false, onRetry: reload };
  if (workspaceId === undefined) return none;
  if (read === undefined) return { ...none, reading: true };
  if ("failure" in read) return { ...none, failed: true };
  return { ...none, automations: theirs };
}

/** One of their automations as a row: its clock wearing how its newest run went, its name, and what fires it, then a failure's mark and when it runs next, hanging its card; a press opens it, and its ⋯, right-click and menu key offer Copy link. */
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
  const copyLink = useCopyLinkItem()({ kind: LINK_PLACE.AUTOMATION, automationId: automation.id });
  return (
    <RowHintOptions
      card={<AutomationCard automation={automation} workspaceName={workspaceName} />}
      cardBeside
      cardRegion={item}
    >
      <ListRow
        ref={hold}
        motionKey={automation.id}
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
        menu={copyLink === undefined ? undefined : rowMenu(AUTOMATION_THING, [[copyLink]])}
      />
    </RowHintOptions>
  );
}

/** An automation's key, by which its row leaves its list (`ListMotion`). */
function automationKey({ id }: AutomationSummary): string {
  return id;
}

/** Their automations' rows, a row no longer listed drawn on until its exit has played (`useLeaving`). */
function AutomationRows({
  automations,
  tasks,
  now,
}: {
  automations: readonly AutomationSummary[];
  tasks: TasksControl;
  now: number;
}): React.JSX.Element {
  const drawn = useLeaving(automations, automationKey);
  return (
    <>
      {drawn.map(({ key, value: automation }) => (
        <AutomationRow
          key={key}
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
    </>
  );
}

/** The page's title: their face beside their name, which is the page's one `h1`. */
function PersonHeading({ person }: { person: Actor }): React.JSX.Element {
  return (
    <PersonTitle
      face={<ActorMark actor={person} size={ACTOR_SIZE.PAGE} />}
      name={headName(person)}
    />
  );
}

/** The line under the title: You where it is the reader, and who they are here. */
function PersonLine({ person }: { person: Actor }): React.ReactNode {
  const line = headLine(person);
  const you = person.kind === ACTOR_KIND.PERSON && person.you;
  if (!you) return line;
  return (
    <>
      <YouBadge />
      {line === undefined ? null : ` ${line}`}
    </>
  );
}

/**
 * One section of a person's tasks, the first `PERSON_TASKS_SHOWN` of them,
 * newest first, wearing no face, since the page's head says whose they
 * are; and under it, where it leaves some out and the sidebar filters by
 * person, the foot that says how many more there are and lists every one
 * in the sidebar (`onShowAll`).
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
  // Note that the section and its foot are one block of the page, so the page's gap between sections stands above both and the foot stands close under the rows.
  return (
    <Stack gap={GAP.TIGHT}>
      <PersonSection title={title} count={listed.length}>
        <TaskRows listed={listed} tasks={tasks} now={now} />
      </PersonSection>
      {onShowAll === undefined ? null : (
        <ShowMoreRow more={listed.length - PERSON_TASKS_SHOWN} shown={false} onToggle={onShowAll} />
      )}
    </Stack>
  );
}

/** A task's key, by which its row leaves its list and glides into another (`ListMotion`). */
function taskKey({ id }: TaskSummary): string {
  return id;
}

/** A section's first `PERSON_TASKS_SHOWN` tasks, a row no longer listed drawn on until its exit has played (`useLeaving`). */
function TaskRows({
  listed,
  tasks,
  now,
}: {
  listed: readonly TaskSummary[];
  tasks: TasksControl;
  now: number;
}): React.JSX.Element {
  const shown = useMemo(() => listed.slice(0, PERSON_TASKS_SHOWN), [listed]);
  const drawn = useLeaving(shown, taskKey);
  return (
    <>
      {drawn.map(({ key, value: task }) => (
        <RecentRow
          key={key}
          tasks={tasks}
          task={task}
          now={now}
          face={false}
          onOpen={() => tasks.onSelect(task.id)}
        />
      ))}
    </>
  );
}

/** What a phone's bar over the page is named by. */
const PERSON_PHONE_PLACE = "person-page";

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
  // What a phone's bar picks up from the page's header once it scrolls away.
  const [pickUp, setPickUp] = useState<ToolbarPickUp>({ name: "", shown: false });
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
  // Note that the page keeps one identity while the list stands, because each of its lists follows its rows (`useLeaving`).
  const page = useMemo(() => personPage(userId, listed), [userId, listed]);
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
    // A phone's page still leads with its way back, the drawer and the places bar out of reach.
    return (
      <NotFound
        thing={NOT_FOUND_THING.PERSON}
        bar={
          away === undefined
            ? {}
            : phoneBar({ place: PERSON_PHONE_PLACE, start: <PhoneBack back={away} />, end: null })
        }
      />
    );
  }
  // Note that someone nothing names yet is drawn as a placeholder, because only settled reads may say they are not in the workspace.
  const theirs = you ? "your" : "their";
  // A refused read will not name them, so the page says so and offers Retry rather than wait.
  const note =
    refused && unnamed ? (
      <div className="home-note">
        <ErrorState
          onRetry={retry}
        >{`${you ? "Your" : "Their"} profile could not be read.`}</ErrorState>
      </div>
    ) : unnamed ? (
      <PersonReadingSkeleton />
    ) : null;
  const actions = (
    <PersonActions
      tasks={tasks}
      userId={userId}
      person={person}
      shared={shared}
      onShowTasks={showTasks}
      phone={away !== undefined}
    />
  );
  const detail = (
    <DetailPage
      frame={PAGE_FRAME.PAGE}
      onPickUp={away === undefined ? undefined : setPickUp}
      title={
        unnamed ? (
          refused ? (
            PROFILE
          ) : (
            <PersonTitleSkeleton name={undefined} />
          )
        ) : (
          <PersonHeading person={person} />
        )
      }
      description={
        unnamed ? refused ? undefined : <PersonLineSkeleton /> : <PersonLine person={person} />
      }
      // A phone's page offers its acts from its bar's one ⋯ instead.
      actions={away === undefined ? actions : undefined}
    >
      <PersonBody reading={!tasks.listRead || read.reading || theirAutomations.reading || unnamed}>
        <PersonTop>{note}</PersonTop>
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
            <AgentRows agents={page.working} tasks={tasks} now={now} />
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
            <AgentRows agents={page.agents} tasks={tasks} now={now} />
          </PersonSection>
        )}
        {automations.length === 0 ? null : (
          <PersonSection title="Automations" count={automations.length}>
            <AutomationRows automations={automations} tasks={tasks} now={now} />
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
            <NoteLine look={NOTE_LINE_LOOK.INSET}>
              {you ? "Nothing of yours here yet." : "Nothing of theirs here yet."}
            </NoteLine>
          </div>
        ) : null}
      </PersonBody>
    </DetailPage>
  );
  // Every link on the page, a row's Copy link among them, is written under the workspace it stands in.
  const linked = (
    <LinkWorkspaceProvider value={linkWorkspaceOf(tasks)}>{detail}</LinkWorkspaceProvider>
  );
  if (away === undefined) return linked;
  return (
    <Fill className="person-phone">
      <PhoneHead
        place={PERSON_PHONE_PLACE}
        start={<PhoneBack back={away} />}
        pickUp={pickUp}
        end={actions}
      />
      {linked}
    </Fill>
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
