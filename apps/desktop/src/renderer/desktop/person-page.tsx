import { automationOwner, automationTriggerText } from "@luke/features/automation-list-model";
import { AUTOMATION_SCOPE, type AutomationSummary } from "@luke/features/automation-wire";
import { LINK_PLACE, linkOf } from "@luke/features/luke-link";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { EXPERIMENT } from "@luke/settings";
import { SETTINGS_SECTION, SETTINGS_VIEW } from "@luke/settings/settings-views";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BUTTON_VARIANT,
  Button,
  ErrorState,
  IconButton,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  useMenu,
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
import type { ReactNode } from "react";
import { ACTOR_SIZE, ActorMark, automationActor, YouBadge } from "../actor-ref";
import { useAppCommand } from "../app-commands";
import { LINK_COPY, useCopyToast } from "../copy-feedback";
import { MemberDirectory, useMemberDirectory } from "../member-directory";
import { NOT_FOUND_THING, NotFound } from "../not-found";
import { useOpenSettings } from "../open-settings";
import { SPINNER_SIZE, Spinner } from "../spinner";
import { lineSubject } from "../tasks/agent-ref";
import { InboxItemRow } from "../tasks/inbox-list";
import { holderName, INBOX_HOLDER, type InboxListed } from "../tasks/inbox-model";
import { RelativeTime } from "../tasks/relative-time";
import { useMinute } from "../tasks/task-time";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab";
import { useWaitingItems } from "../tasks/use-waiting-items";
import { Tooltip } from "../tooltip";
import { useExperiment } from "../use-app-state";
import { ActionMenu, type MenuAction } from "./action-menu";
import { RecentRow } from "./desktop-home";
import { useArchivedView, useTaskListView } from "./task-list-view";
import { useAutomations } from "./use-automations";

/**
 * person-page.tsx -- one person's page in the listed workspace: who they are there, and what of theirs the window already holds.
 *
 * It stands in the plan's place as an agent's page does, opened from
 * wherever the window names a member, the reader among them, or someone
 * who left. Its head is their face at the page's size, their name, and
 * their role and email as the members read lists them, or that they left.
 * Under it, in Home's own voice, stand their agents at work, the Inbox
 * items their agents wait on, the tasks they created, and their other
 * agents, each from the listed workspace's task list and Inbox
 * (`@luke/ui/person-page-model`), and the workspace's automations they
 * made, a section with nothing in it left out.
 * Until the Inbox is read the page says so, and a read that failed says
 * that and offers Retry, so a page is called empty only once it is.
 * Nothing on it is read for it: it shows a teammate only what the sidebar,
 * the Inbox, and an agent's card already show any member, never their
 * personal workspace, their answers, or another workspace's. A press on a
 * row opens what it names, as Home's do, and Escape leaves the page.
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

/** A section in Home's voice: its name and count, then its rows. */
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
    <section className="home-section" aria-label={title}>
      <header className="person-section-head">
        <Text as={TEXT_ELEMENT.H2} variant={TEXT_VARIANT.SECTION} tone={TEXT_TONE.MUTED}>
          {title}
        </Text>
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE}>
          {count}
        </Text>
      </header>
      <ul className="sidebar-tasks">{children}</ul>
    </section>
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
  const { plan: task, agent } = each;
  const subject = lineSubject(agent, tasks.agents.models, tasks.me);
  return (
    <li className="sidebar-task-item home-row">
      <button
        type="button"
        className="sidebar-task"
        onClick={() => tasks.onShowAgent(task.id, agent.id)}
      >
        <span className="sidebar-task-line">
          <span className="home-row-picture">
            <ActorMark actor={subject.tile} />
          </span>
          <span className="sidebar-task-name">{subject.name}</span>
          <span className="home-row-context">{task.name}</span>
          {agent.at === undefined ? null : (
            <span className="sidebar-task-time">
              <RelativeTime at={agent.at} now={now} />
            </span>
          )}
        </span>
      </button>
    </li>
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
}: {
  tasks: TasksControl;
  userId: string;
  person: Actor;
  /** Whether the workspace is shared, which alone filters the sidebar by creator. */
  shared: boolean;
  onShowTasks: () => void;
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
  const link = linkOf({ kind: LINK_PLACE.PERSON, userId }, home?.slug ?? homeId ?? "");
  const actions: MenuAction[][] = [
    [{ label: LINK_COPY.LABEL, icon: <LinkIcon />, onSelect: () => copy(link, LINK_COPY.COPIED) }],
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
    <div className="desktop-toolbar-actions">
      {shared ? (
        <Button variant={BUTTON_VARIANT.OUTLINE} icon={<ListFilterIcon />} onClick={onShowTasks}>
          {you ? "My tasks in sidebar" : "Their tasks in sidebar"}
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
 * The workspace's automations the person made, read while the Automations
 * page is on (`EXPERIMENT.AUTOMATIONS`): the workspace's alone, never their
 * personal ones, which only they read. None while the list is read or where
 * it could not be, which the page says rather than pass for a person with none.
 */
function usePersonAutomations(
  workspaceId: string | undefined,
  userId: string,
  on: boolean,
): PersonAutomations {
  const asked = on ? workspaceId : undefined;
  const { read, reload } = useAutomations(asked);
  const none = { automations: [], reading: false, failed: false, onRetry: reload };
  if (asked === undefined) return none;
  if (read === undefined) return { ...none, reading: true };
  if ("failure" in read) return { ...none, failed: true };
  const automations = read.automations.filter(
    (automation) =>
      automation.creatorId === userId && automationOwner(automation) === AUTOMATION_SCOPE.WORKSPACE,
  );
  return { ...none, automations };
}

/** One of their automations as a row: its clock wearing how its newest run went, its name, and what fires it; a press opens it. */
function AutomationRow({
  automation,
  onOpen,
}: {
  automation: AutomationSummary;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <li className="sidebar-task-item home-row">
      <button type="button" className="sidebar-task" onClick={onOpen}>
        <span className="sidebar-task-line">
          <span className="home-row-picture">
            <ActorMark actor={automationActor(automation)} />
          </span>
          <span className="sidebar-task-name">{automation.name}</span>
          <span className="home-row-context">
            {automationTriggerText(automation.trigger, automation.repositories ?? [])}
          </span>
        </span>
      </button>
    </li>
  );
}

/** The page's head: their face, their name and You where it is the reader, and who they are here. */
function PersonHead({ person }: { person: Actor }): React.JSX.Element {
  const line = headLine(person);
  return (
    <header className="person-head">
      <ActorMark actor={person} size={ACTOR_SIZE.PAGE} />
      <div className="person-head-copy">
        <p className="person-head-name">
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.TITLE}>
            {headName(person)}
          </Text>
          {person.kind === ACTOR_KIND.PERSON && person.you ? <YouBadge /> : null}
        </p>
        {line === undefined ? null : (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {line}
          </Text>
        )}
      </div>
    </header>
  );
}

/** The page inside the workspace's member directory, which names the person. */
function PersonColumn({
  tasks,
  userId,
  name: opened,
  staged,
}: {
  tasks: TasksControl;
  userId: string;
  name: string | undefined;
  staged: boolean;
}): React.JSX.Element {
  const now = useMinute();
  const listed = tasks.listed.tasks;
  // Named as the list names them, else as the members read does, else by the name the page was opened with, else as the former members read does; nobody's name where none does.
  const { members, readerId, former } = useMemberDirectory();
  const member = members?.find((each) => each.userId === userId);
  const known = opened === undefined ? undefined : { userId, name: opened };
  // Note that someone who left having only revised or answered is named by the former members read alone, since a link to them opens with no name.
  const left = former?.find((each) => each.userId === userId);
  const ref = personRef(userId, listed) ?? member ?? known ?? left;
  const person = personActor(ref, members, readerId, former);
  // The sidebar's own view, so their tasks are listed there as its Created by lists them.
  const taskView = useTaskListView(tasks.workspace?.id, staged);
  const archive = useArchivedView(tasks.workspace?.id, staged);
  const memberCount = tasks.workspace?.memberCount;
  const shared = memberCount === undefined ? (members?.length ?? 0) > 1 : memberCount > 1;
  // Note that the list is turned back from the archived tasks, because the page lists their open ones.
  const showTasks = () => {
    archive.onShown(false);
    taskView.onCreatedBy(userId);
  };
  const page = personPage(userId, listed);
  const you = userId === tasks.me;
  const theirAutomations = usePersonAutomations(
    tasks.workspace?.id,
    userId,
    useExperiment(EXPERIMENT.AUTOMATIONS),
  );
  const { automations } = theirAutomations;
  const read = useWaitingItems(tasks);
  // An item is theirs where its task's row says they started its agent; one with no task names no starter, so none is.
  const waiting = read.items.filter(
    ({ holder, item }) =>
      holder.kind === INBOX_HOLDER.TASK && agentStarter(holder.task, item.agentId) === userId,
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
  const name = headName(person);
  // Nobody the workspace's members or those who left name, as a link to someone outside it opens, is not found here; until both are read, nobody is.
  if (
    person.kind === ACTOR_KIND.SOMEONE &&
    person.reason === SOMEONE_REASON.UNNAMED &&
    members !== undefined &&
    former !== undefined
  ) {
    return (
      <section className="automations-view" aria-label="Profile">
        <NotFound thing={NOT_FOUND_THING.PERSON} />
      </section>
    );
  }
  return (
    <section className="automations-view" aria-label={name}>
      <header className="desktop-toolbar">
        <div className="desktop-toolbar-heading">
          <h1 className="desktop-toolbar-title">{name}</h1>
        </div>
        <PersonActions
          tasks={tasks}
          userId={userId}
          person={person}
          shared={shared}
          onShowTasks={showTasks}
        />
      </header>
      <div className="home-scroll scroll-fade-top">
        <div className="home-column person-column">
          <PersonHead person={person} />
          {page.working.length === 0 ? null : (
            <PersonSection title="Working now" count={page.working.length}>
              {page.working.map((each) => (
                <AgentRow key={each.agent.id} each={each} tasks={tasks} now={now} />
              ))}
            </PersonSection>
          )}
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
                  context={holderName(listed.holder)}
                  onChoose={openItem}
                />
              ))}
            </PersonSection>
          )}
          {page.created.length === 0 ? null : (
            <PersonSection title={you ? "Created by you" : "Created"} count={page.created.length}>
              {page.created.slice(0, PERSON_TASKS_SHOWN).map((task) => (
                <RecentRow
                  key={task.id}
                  task={task}
                  pictures={tasks.repositories.pictures}
                  now={now}
                  face={false}
                  onOpen={() => tasks.onSelect(task.id)}
                />
              ))}
            </PersonSection>
          )}
          {page.created.length > PERSON_TASKS_SHOWN && shared ? (
            <p className="person-section-foot">
              <Button onClick={showTasks}>{`Show all ${page.created.length} in sidebar`}</Button>
            </p>
          ) : null}
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
          {read.failed ? (
            <div className="home-note">
              <ErrorState onRetry={read.onRetry}>Some Inbox items could not be read.</ErrorState>
            </div>
          ) : waiting.length === 0 && read.reading ? (
            <Spinner label="Loading inbox" size={SPINNER_SIZE.INLINE} />
          ) : null}
          {theirAutomations.failed ? (
            <div className="home-note">
              <ErrorState onRetry={theirAutomations.onRetry}>
                {`${you ? "Your" : "Their"} automations could not be read.`}
              </ErrorState>
            </div>
          ) : theirAutomations.reading ? (
            <Spinner label="Loading automations" size={SPINNER_SIZE.INLINE} />
          ) : null}
          {/* Note that the page is said to be empty only once both reads have answered, since either may yet name something. */}
          {read.failed ||
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
        </div>
      </div>
    </section>
  );
}

/** A person's page, in the plan's place, read against the listed workspace's members. */
export function PersonPage({
  tasks,
  userId,
  name,
  staged = false,
}: {
  tasks: TasksControl;
  userId: string;
  /** The name the place that opened the page knew them by: someone who left, whom only an edit names. */
  name?: string | undefined;
  /** Whether the run is a fixture's, whose sidebar view is kept nowhere. */
  staged?: boolean;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_PERSON_PAGE, tasks.personView.onClose);
  return (
    <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
      <PersonColumn tasks={tasks} userId={userId} name={name} staged={staged} />
    </MemberDirectory>
  );
}
