import { AGENT_BOUNDS } from "@repo/features/agent-wire";
import {
  automationOwner,
  automationRunStanding,
  automationTriggerText,
} from "@repo/features/automation-list-model";
import { AUTOMATION_SCOPE, type AutomationSummary } from "@repo/features/automation-wire";
import { inboxWaitsOn } from "@repo/features/inbox-wire";
import { LINK_PLACE, linkOf } from "@repo/features/link-grammar";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { TaskSummary } from "@repo/features/task-wire";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { SETTINGS_SECTION, SETTINGS_VIEW } from "@repo/settings/settings-views";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import {
  BUTTON_VARIANT,
  Button,
  DetailPage,
  ErrorState,
  Fill,
  GAP,
  InlineEdit,
  List,
  ListRow,
  type ListRun,
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
  STATUS_TONE,
  Stack,
  type StatusTone,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Time,
  type ToolbarPickUp,
  useLeaving,
  useMenu,
  useMinute,
  usePageScroll,
} from "@repo/ui";
import {
  ACTOR_KIND,
  type Actor,
  actorName,
  personActor,
  ROLE_WORDS,
  SOMEONE_REASON,
} from "@repo/ui/actor-model";
import {
  agentStarter,
  PERSON_TASKS_SHOWN,
  type PersonAgent,
  personPage,
  personPageEmpty,
  personRef,
} from "@repo/ui/person-page-model";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { ASSIGNED_TO } from "@repo/ui/task-list-model";
import type { VirtualRowPlace } from "@repo/ui/virtual-rows";
import { useQueryClient } from "@tanstack/react-query";
import { ListFilterIcon, MailIcon, UsersIcon } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { ACTOR_SIZE, ActorMark, AutomationCard, automationActor, YouBadge } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { useCoarsePointer } from "../coarse-pointer.js";
import { useInboxRowDrafts } from "../composer-drafts.js";
import { useCopyToast } from "../copy-feedback.js";
import {
  copyLinkItem,
  LinkWorkspaceProvider,
  useChordLinks,
  useCopyLinkItem,
} from "../copy-link-item.js";
import { unreadShown } from "../failure-report.js";
import { useFindOpen } from "../find-in-tab.js";
import { MemberDirectory, useMemberDirectory } from "../member-directory.js";
import { useOpenSettings } from "../open-settings.js";
import { stateEndMark } from "../state-glyph.js";
import { RENAME_FAILED } from "../tasks/agent-model.js";
import { AgentCard, lineSubject } from "../tasks/agent-ref.js";
import { HOME_ROW_CONTEXT, HOME_ROW_META, HOME_ROW_PICTURE } from "../tasks/home-row.js";
import { InboxItemRow, InboxListSkeleton, inboxRowDraft } from "../tasks/inbox-list.js";
import { INBOX_HOLDER, type InboxListed, NEEDS_YOU } from "../tasks/inbox-model.js";
import { agentEndMark } from "../tasks/tab-look.js";
import { readAgentById } from "../tasks/use-agents.js";
import { choiceOf } from "../tasks/use-inbox-listing.js";
import { useUnreadTasks } from "../tasks/use-task-looks.js";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab.js";
import { useWaitingItems } from "../tasks/use-waiting-items.js";
import { useRefocusAfterEdit } from "../use-refocus-after-edit.js";
import { ActionMenu, type MenuAction, rowMenu } from "./action-menu.js";
import { agentMenuGroups, rowDoors, useAgentActions } from "./agent-actions.js";
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
import { PhoneBack, PhoneHead, phoneBar, phoneFindGroups } from "./phone-head.js";
import { RecentTasks, RecentTasksSkeleton } from "./recent-tasks.js";
import { useTaskListView } from "./task-list-view.js";
import type { TaskHeadBack } from "./task-pane-switcher.js";
import { useAutomations } from "./use-automations.js";

function headLine(person: Actor): ReactNode {
  if (person.kind === ACTOR_KIND.PERSON) {
    const role = person.role === undefined ? undefined : ROLE_WORDS[person.role];
    const email =
      person.email === undefined || person.email === "" ? undefined : (
        <ReplayMask>{person.email}</ReplayMask>
      );
    if (role !== undefined && email !== undefined) {
      return (
        <>
          {role} · {email}
        </>
      );
    }
    return role ?? email;
  }
  if (person.kind === ACTOR_KIND.SOMEONE && person.reason === SOMEONE_REASON.FORMER) {
    return "Former member";
  }
  return "Not in this workspace";
}

function headName(person: Actor): string {
  return person.kind === ACTOR_KIND.PERSON ? person.name : actorName(person);
}

function PersonSection({
  title,
  count,
  tone,
  rowsMasked = false,
  run,
  children,
}: {
  title: string;
  count: number;
  tone?: StatusTone | undefined;
  rowsMasked?: boolean | undefined;
  run?: ListRun | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  const list = (
    <List label={title} moves run={run}>
      {children}
    </List>
  );
  return (
    <PersonSectionFrame label={title} title={title} count={count} tone={tone}>
      {rowsMasked ? <ReplayMask>{list}</ReplayMask> : list}
    </PersonSectionFrame>
  );
}

const ITEMS_NOT_READ = "Some inbox items could not be read.";

const AGENT_THING = "Agent";

const AUTOMATION_THING = "Automation";

function AgentRow({
  each,
  tasks,
  now,
  place,
}: {
  each: PersonAgent;
  tasks: TasksControl;
  now: number;
  place: VirtualRowPlace;
}): React.JSX.Element {
  const { task, agent } = each;
  const subject = lineSubject(agent, tasks.agents.models, tasks.me);
  const card = <AgentCard subject={subject} models={tasks.agents.models} />;
  const queryClient = useQueryClient();
  const control = {
    ...tasks.agents,
    readAgent: (agentId: string) => readAgentById(queryClient, agentId),
  };
  const actions = useAgentActions({ ...agent, planId: task.id }, control, {
    label: subject.name,
    shown: tasks.shown,
    terminals: { onOpenTerminal: undefined },
  });
  const row = useRef<HTMLElement | null>(null);
  const hold = useCallback((element: HTMLElement | null) => {
    row.current = element;
  }, []);
  const { rename } = actions;
  const editing = rename?.editing === true;
  const endedByKey = useRefocusAfterEdit(editing, row);
  const coarse = useCoarsePointer();
  return (
    <>
      <RowHintOptions card={card}>
        <ListRow
          ref={hold}
          motionKey={agent.id}
          place={place}
          leading={
            <span className={HOME_ROW_PICTURE}>
              <ActorMark actor={subject.tile} />
            </span>
          }
          title={
            editing && rename !== undefined ? (
              <InlineEdit
                value={rename.asked ?? subject.name}
                label="Agent name"
                maxLength={AGENT_BOUNDS.MAX_TITLE_CHARS}
                editing
                onEnd={(edit) => {
                  endedByKey(edit.byKey);
                  rename.end(edit.value);
                }}
              />
            ) : (
              subject.name
            )
          }
          titleReplayMasked
          description={rename?.refused === true ? <span>{RENAME_FAILED}</span> : undefined}
          hint={editing ? undefined : { Hint: RowHint, label: subject.name }}
          meta={
            editing ? null : (
              <span className={HOME_ROW_META}>
                <OneLine className={HOME_ROW_CONTEXT} words={task.name}>
                  <ReplayMask>{task.name}</ReplayMask>
                </OneLine>
                {agentEndMark(agent, false)}
                {agent.at === undefined ? null : <Time at={agent.at} now={now} hint={false} />}
              </span>
            )
          }
          onPress={editing ? undefined : () => tasks.onShowAgent(task.id, agent.id)}
          menu={
            editing
              ? undefined
              : rowMenu(AGENT_THING, agentMenuGroups(rowDoors(actions.doors)), tasks.shown, true)
          }
          more={!coarse}
        />
      </RowHintOptions>
      {actions.dialog}
    </>
  );
}

function agentKey({ agent }: PersonAgent): string {
  return agent.id;
}

const AGENT_ROW_ESTIMATE_PX = 40;

const AGENT_ROW_GAP_PX = 2;

function PersonAgentsSection({
  title,
  agents,
  tasks,
  now,
}: {
  title: string;
  agents: readonly PersonAgent[];
  tasks: TasksControl;
  now: number;
}): React.JSX.Element {
  const drawn = useLeaving(agents, agentKey);
  const keys = useMemo(() => drawn.map(({ key }) => key), [drawn]);
  const { scroller, shiftedBy } = usePageScroll();
  const finding = useFindOpen();
  return (
    <PersonSection
      title={title}
      count={agents.length}
      run={{
        scroller,
        shiftedBy,
        keys,
        estimate: AGENT_ROW_ESTIMATE_PX,
        gap: AGENT_ROW_GAP_PX,
        overscan: finding ? keys.length : undefined,
        row: (index, at) => {
          const entry = drawn[index];
          return entry === undefined ? null : (
            <AgentRow each={entry.value} tasks={tasks} now={now} place={at} />
          );
        },
      }}
    />
  );
}

const PERSON = "Person";

function linkWorkspaceOf(tasks: TasksControl): string | undefined {
  const homeId = tasks.personView.workspaceId ?? tasks.workspace?.id;
  const home = tasks.workspaces.find((each) => each.id === homeId);
  return home?.slug ?? homeId;
}

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
  shared: boolean;
  onShowTasks: () => void;
  phone?: boolean;
}): React.JSX.Element {
  const openSettings = useOpenSettings();
  const copy = useCopyToast();
  const chord = useChordLinks();
  const menu = useMenu(tasks.shown);
  const member = person.kind === ACTOR_KIND.PERSON ? person : undefined;
  const you = member?.you === true;
  const { workspace } = tasks;
  const manages =
    member?.role !== undefined &&
    workspace !== undefined &&
    (workspace.role === WORKSPACE_ROLE.OWNER || workspace.role === WORKSPACE_ROLE.ADMIN);
  const email = member?.email;
  const slug = linkWorkspaceOf(tasks);
  const link = slug === undefined ? undefined : linkOf({ kind: LINK_PLACE.PERSON, userId }, slug);
  const showTasks = you ? "Show my tasks in the sidebar" : "Show their tasks in the sidebar";
  const copies = [
    ...(link === undefined ? [] : [copyLinkItem(copy, link, chord)]),
    ...(email === undefined
      ? []
      : [{ label: "Copy email", icon: <MailIcon />, onSelect: () => copy(email, "Email copied") }]),
  ];
  const actions: MenuAction[][] = [
    ...(copies.length === 0 ? [] : [copies]),
    ...(phone && shared
      ? [[{ label: showTasks, icon: <ListFilterIcon />, onSelect: onShowTasks }]]
      : []),
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
        <Button variant={BUTTON_VARIANT.QUIET} icon={<ListFilterIcon />} onClick={onShowTasks}>
          {showTasks}
        </Button>
      ) : null}
      {actions.length === 0 && !phone ? null : (
        <>
          <MoreButton thing={PERSON} {...menu.trigger()} />
          {menu.drawn === undefined ? null : (
            <ActionMenu
              label={moreLabel(PERSON)}
              replayUnmasked
              menu={menu.drawn}
              groups={phone ? [...phoneFindGroups(), ...actions] : actions}
              onClose={menu.close}
            />
          )}
        </>
      )}
    </>
  );
}

interface PersonAutomations {
  readonly automations: readonly AutomationSummary[];
  readonly reading: boolean;
  readonly failed: boolean;
  readonly onRetry: () => void;
}

function usePersonAutomations(workspaceId: string | undefined, userId: string): PersonAutomations {
  const { read, reload } = useAutomations(workspaceId);
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
  const nextWords = automationNextText(automation, now);
  const copyLink = useCopyLinkItem()({ kind: LINK_PLACE.AUTOMATION, automationId: automation.id });
  const coarse = useCoarsePointer();
  return (
    <RowHintOptions card={<AutomationCard automation={automation} workspaceName={workspaceName} />}>
      <ListRow
        motionKey={automation.id}
        leading={
          <span className={HOME_ROW_PICTURE}>
            <ActorMark actor={automationActor(automation)} />
          </span>
        }
        title={automation.name}
        titleReplayMasked
        meta={
          <span className={HOME_ROW_META}>
            <OneLine className={HOME_ROW_CONTEXT} words={trigger}>
              <ReplayMask>{trigger}</ReplayMask>
            </OneLine>
            {stateEndMark(state, true)}
            {nextWords === undefined ? null : (
              <Text
                as={TEXT_ELEMENT.SPAN}
                variant={TEXT_VARIANT.CAPTION}
                tone={TEXT_TONE.MUTED}
                truncate
              >
                <ReplayUnmask>{nextWords}</ReplayUnmask>
              </Text>
            )}
          </span>
        }
        hint={{ Hint: RowHint, label: automation.name }}
        onPress={onOpen}
        menu={
          copyLink === undefined
            ? undefined
            : rowMenu(AUTOMATION_THING, [[copyLink]], undefined, true)
        }
        more={!coarse}
      />
    </RowHintOptions>
  );
}

function automationKey({ id }: AutomationSummary): string {
  return id;
}

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

function PersonHeading({ person }: { person: Actor }): React.JSX.Element {
  return (
    <PersonTitle
      face={
        <ReplayMask>
          <ActorMark actor={person} size={ACTOR_SIZE.PAGE} />
        </ReplayMask>
      }
      name={<ReplayMask>{headName(person)}</ReplayMask>}
    />
  );
}

function PersonLine({ person }: { person: Actor }): React.ReactNode {
  const line = headLine(person);
  const you = person.kind === ACTOR_KIND.PERSON && person.you;
  if (!you) return line;
  return (
    <>
      <YouBadge />
      {line === undefined ? null : <> {line}</>}
    </>
  );
}

function PersonTasks({
  title,
  listed,
  tasks,
  unread,
  onShowAll,
}: {
  title: string;
  listed: readonly TaskSummary[];
  tasks: TasksControl;
  unread: (task: TaskSummary) => boolean;
  onShowAll?: (() => void) | undefined;
}): React.JSX.Element | null {
  if (listed.length === 0) return null;
  return (
    <Stack gap={GAP.TIGHT}>
      <PersonSectionFrame label={title} title={title} count={listed.length}>
        <PersonTaskRows title={title} listed={listed} tasks={tasks} unread={unread} />
      </PersonSectionFrame>
      {onShowAll === undefined ? null : (
        <ShowMoreRow more={listed.length - PERSON_TASKS_SHOWN} shown={false} onToggle={onShowAll} />
      )}
    </Stack>
  );
}

function taskKey({ id }: TaskSummary): string {
  return id;
}

function PersonTaskRows({
  title,
  listed,
  tasks,
  unread,
}: {
  title: string;
  listed: readonly TaskSummary[];
  tasks: TasksControl;
  unread: (task: TaskSummary) => boolean;
}): React.JSX.Element {
  const shown = useMemo(() => listed.slice(0, PERSON_TASKS_SHOWN), [listed]);
  const drawn = useLeaving(shown, taskKey);
  return (
    <ReplayMask>
      <RecentTasks
        tasks={tasks}
        label={title}
        listed={drawn.map(({ value }) => value)}
        unread={unread}
        onOpen={tasks.onSelect}
        face={false}
        moves
      />
    </ReplayMask>
  );
}

const PERSON_PHONE_PLACE = "person-page";

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
  const [pickUp, setPickUp] = useState<ToolbarPickUp>({ name: "", shown: false });
  const listed = tasks.listed.tasks;
  const { members, readerId, former, refused, retry } = useMemberDirectory();
  const member = members?.find((each) => each.userId === userId);
  const known = opened === undefined ? undefined : { userId, name: opened };
  const left = former?.find((each) => each.userId === userId);
  const ref = personRef(userId, listed) ?? member ?? known ?? left;
  const person = personActor(ref, members, readerId, former);
  const taskView = useTaskListView(tasks.workspace?.id, staged);
  const memberCount = tasks.workspace?.memberCount;
  const shared = memberCount === undefined ? (members?.length ?? 0) > 1 : memberCount > 1;
  const showTasks = () =>
    taskView.onAssignedTo(
      userId === tasks.me ? { kind: ASSIGNED_TO.ME } : { kind: ASSIGNED_TO.MEMBER, userId },
    );
  const page = useMemo(() => personPage(userId, listed), [userId, listed]);
  const unread = useUnreadTasks({ staged });
  const you = userId === tasks.me;
  const theirAutomations = usePersonAutomations(tasks.workspace?.id, userId);
  const { automations } = theirAutomations;
  const read = useWaitingItems(tasks);
  const drafts = useInboxRowDrafts();
  const waiting = read.items.filter(
    ({ holder, item }) =>
      (inboxWaitsOn(item)?.userId ??
        (holder.kind === INBOX_HOLDER.TASK
          ? agentStarter(holder.task, item.agentId)
          : undefined)) === userId,
  );
  const { inboxView } = tasks;
  const openItem = (listed: InboxListed) => inboxView.onOpenItem(choiceOf(listed));
  const unnamed = person.kind === ACTOR_KIND.SOMEONE && person.reason === SOMEONE_REASON.UNNAMED;
  if (unnamed && members !== undefined && former !== undefined) {
    return (
      <NotFound
        replayUnmasked
        thing={NOT_FOUND_THING.PERSON}
        bar={
          away === undefined
            ? {}
            : phoneBar({ place: PERSON_PHONE_PLACE, start: <PhoneBack back={away} />, end: null })
        }
      />
    );
  }
  const theirs = you ? "your" : "their";
  const note =
    refused && unnamed ? (
      <div className="home-note my-tight-gap">
        <ErrorState
          failure={unreadShown(FAILURE_SURFACE.PERSON_READ)}
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
    <ReplayUnmask>
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
        actions={away === undefined ? actions : undefined}
      >
        <PersonBody
          reading={!tasks.listRead || read.reading || theirAutomations.reading || unnamed}
        >
          <PersonTop>{note}</PersonTop>
          {tasks.listFailed ? (
            <div className="home-note my-tight-gap">
              <ErrorState
                failure={unreadShown(FAILURE_SURFACE.PERSON_TASKS_READ)}
                onRetry={tasks.onRetryList}
              >
                {`${you ? "Your" : "Their"} tasks could not be read.`}
              </ErrorState>
            </div>
          ) : !tasks.listRead && personPageEmpty(page) ? (
            <RecentTasksSkeleton label={`Reading ${theirs} tasks…`} face={false} />
          ) : null}
          {page.working.length === 0 ? null : (
            <PersonAgentsSection
              title="Working now"
              agents={page.working}
              tasks={tasks}
              now={now}
            />
          )}
          {read.failed ? (
            <div className="home-note my-tight-gap">
              <ErrorState
                failure={unreadShown(FAILURE_SURFACE.PERSON_INBOX_READ)}
                onRetry={read.onRetry}
              >
                {ITEMS_NOT_READ}
              </ErrorState>
            </div>
          ) : waiting.length === 0 && read.reading ? (
            <SectionSkeleton>
              <InboxListSkeleton />
            </SectionSkeleton>
          ) : null}
          {waiting.length === 0 ? null : (
            <PersonSection
              title={you ? NEEDS_YOU.LABEL : "Waiting on their answer"}
              count={waiting.length}
              tone={you ? STATUS_TONE.ATTENTION : undefined}
              rowsMasked
            >
              {waiting.map((listed) => (
                <InboxItemRow
                  key={listed.item.id}
                  listed={listed}
                  chosen={false}
                  {...inboxRowDraft(drafts.get(listed.item.id), listed.item, false)}
                  models={tasks.agents.models}
                  readerId={tasks.me}
                  needsYouShown={you}
                  onChoose={openItem}
                />
              ))}
            </PersonSection>
          )}
          <PersonTasks
            title={you ? "Assigned to you" : "Assigned"}
            listed={page.assigned}
            tasks={tasks}
            unread={unread}
            onShowAll={shared ? showTasks : undefined}
          />
          <PersonTasks
            title={you ? "Created by you" : "Created"}
            listed={page.created}
            tasks={tasks}
            unread={unread}
          />
          {page.agents.length === 0 ? null : (
            <PersonAgentsSection title="Agents" agents={page.agents} tasks={tasks} now={now} />
          )}
          {automations.length === 0 ? null : (
            <PersonSection title="Automations" count={automations.length}>
              <AutomationRows automations={automations} tasks={tasks} now={now} />
            </PersonSection>
          )}
          {theirAutomations.failed ? (
            <div className="home-note my-tight-gap">
              <ErrorState
                failure={unreadShown(FAILURE_SURFACE.PERSON_AUTOMATIONS_READ)}
                onRetry={theirAutomations.onRetry}
              >
                {`${you ? "Your" : "Their"} automations could not be read.`}
              </ErrorState>
            </div>
          ) : theirAutomations.reading ? (
            <RowsSkeleton label={`Reading ${theirs} automations…`} />
          ) : null}
          {unnamed ||
          !tasks.listRead ||
          read.failed ||
          read.reading ||
          theirAutomations.failed ||
          theirAutomations.reading ? null : personPageEmpty(page) &&
            waiting.length === 0 &&
            automations.length === 0 ? (
            <div className="home-note my-tight-gap">
              <NoteLine look={NOTE_LINE_LOOK.INSET}>
                {you ? "Nothing of yours here yet." : "Nothing of theirs here yet."}
              </NoteLine>
            </div>
          ) : null}
        </PersonBody>
      </DetailPage>
    </ReplayUnmask>
  );
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

export function PersonPage({
  tasks,
  userId,
  name,
  staged = false,
  away,
}: {
  tasks: TasksControl;
  userId: string;
  name?: string | undefined;
  staged?: boolean;
  away?: TaskHeadBack | undefined;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_PERSON_PAGE, tasks.personView.onClose);
  return (
    <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
      <PersonColumn tasks={tasks} userId={userId} name={name} staged={staged} away={away} />
    </MemberDirectory>
  );
}
