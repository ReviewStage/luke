import { PULL_REQUEST_STATE, type TasklessAgent } from "@luke/features/coding-agent-wire";
import { LINK_PLACE, type LinkPlace } from "@luke/features/luke-link";
import type { TaskAgentLine, TaskPullRequestLine, TaskSummary } from "@luke/features/task-wire";
import { EXPERIMENT } from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  ArrowUpRightIcon,
  CallIcon,
  COLLECTION_STATE,
  CollectionPage,
  type CollectionState,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  List,
  ListRow,
  PAGE_FRAME,
  PAGE_WIDTH,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  useMenu,
} from "@luke/ui";
import { type Actor, personActor, teammateCreator } from "@luke/ui/actor-model";
import { TASK_ORDER, taskTime } from "@luke/ui/task-list-model";
import {
  ArrowRightIcon,
  AudioLinesIcon,
  BlocksIcon,
  FactoryIcon,
  GitMergeIcon,
  LinkIcon,
  MessageCircleQuestionIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ACTOR_SIZE, ActorMark, CreatorHeard } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { AttentionMark } from "../attention-mark.js";
import { LINK_COPY, useCopyToast } from "../copy-feedback.js";
import { agentPlace, LinkWorkspaceProvider, useCopyLinkItem } from "../copy-link-item.js";
import { ExperimentTag, SendFeedbackButton } from "../experiment-marks.js";
import { FactoryWorldPage } from "../factory-world/world-page.js";
import {
  FACTORY_CHOICE,
  FactoryViewPicker,
  useFactoryViews,
} from "../factory-world/world-picker.js";
import { MemberDirectory, useMemberDirectory } from "../member-directory.js";
import { GLYPH_STATE, stateEndMark } from "../state-glyph.js";
import { agentTabLabel } from "../tasks/coding-agent-model.js";
import { NEEDS_YOU } from "../tasks/inbox-model.js";
import { useSettledWaiting } from "../tasks/inbox-settling.js";
import { PullRequestMark } from "../tasks/pull-request-mark.js";
import { RelativeTime } from "../tasks/relative-time.js";
import { AgentGlyph, agentEndMark } from "../tasks/tab-look.js";
import { useMinute } from "../tasks/task-time.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useWaitingItems, type WaitingItems } from "../tasks/use-waiting-items.js";
import { RowHint, RowHintOptions } from "../tooltip.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import {
  agentMovedAt,
  FACTORY_BLOCK,
  FACTORY_STEP,
  FACTORY_STOP,
  FACTORY_WORK,
  type FactoryBlock,
  type FactoryBoard,
  type FactoryShipped,
  type FactoryStep,
  type FactoryStop,
  type FactoryWork,
  factoryBoard,
  factoryMovedAt,
  factoryOneOffWaiting,
  factoryWaiting,
} from "./factory-model.js";
import { paneTiming } from "./pane-motion.js";
import { taskCardOf } from "./task-card.js";
import { useRowKeys } from "./use-row-keys.js";

/**
 * desktop-factory.tsx -- the window's Factory: the workspace's tasks being talked through, built, and shipped, as three stations on one line, each leading with what waits on the developer there.
 *
 * It stands in the plan's place beside the sidebar, as the Inbox does, and is
 * a live view rather than a report: no totals, only where work stands now and
 * what moved in the last day (`factory-model.ts`), read from the plan list,
 * every member's open Inbox items as Home reads them, and the call. Three
 * stations run left to right, each a card counting the rows it lists: Talk,
 * the task on a call with Luke; Build, the agents at work, an agent with no
 * task among them by its automation's name, opening its own page; and Ship,
 * what merged in the last day. Every row reads as Home's does: a glyph, what
 * it is, the task it is about in the faint context ink, a teammate's face,
 * and when it moved, the time slot holding nothing but a time. What waits on
 * the developer stands first in the station it holds up, in the unread weight
 * with its dot, apart from the rest by a hairline: under Build the agents
 * stopped on a question or a failed turn, under Ship failing checks and pull
 * requests ready to merge. The line above the stations says how many wait,
 * how many agents work, and how much shipped today. A question opens in the
 * Inbox, an agent its page, a pull request its agent's Pull request tab, or
 * GitHub where the service named no agent (its row then ends in ↗), and
 * anything else its task, whose card hangs on the row's hover. A row that
 * moves from one station to another slides there once, and one that arrives
 * fades in; nothing else moves, and the times count on with the window's
 * minute. ↑ and ↓ move through the rows from the window itself, as on Home,
 * and Return opens the one reached. Escape leaves it for the task it stood
 * over, and so does any row of the sidebar. The toolbar's picker shows the
 * campus in the board's place (`../factory-world/`); the board is its first
 * entry and what the page opens on, and Escape in the campus steps back to
 * its overview before it leaves. Until the plan list is read the line stands in blocks, its
 * stations named and holding placeholder rows in a row's own shape, so the
 * rows land where the blocks stood; a list that could not be read says so
 * with Retry, above the line where an earlier read still stands, and with
 * nothing on a call, built, or shipped the page is the app's empty state.
 * It is an experiment
 * (`EXPERIMENT.FACTORY`): every door to it is gated on the account's switch,
 * and its toolbar says so with the Experimental tag and Send feedback.
 */

/** What each station is called, its glyph, and what it says with nothing in it. */
const STEPS = {
  [FACTORY_STEP.TALK]: { name: "Talk", Icon: AudioLinesIcon, idle: "No task on a call" },
  [FACTORY_STEP.BUILD]: { name: "Build", Icon: BlocksIcon, idle: "No agents working" },
  [FACTORY_STEP.SHIP]: { name: "Ship", Icon: GitMergeIcon, idle: "Nothing shipped today" },
} as const;

/** What a block's row says it waits for. */
const BLOCK_WORDS = {
  [FACTORY_BLOCK.CHECKS]: "checks failing",
  [FACTORY_BLOCK.MERGE]: "ready to merge",
} as const;

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The Pull request tab a pull request's row opens, its agent's on its task; none where the service named no agent. */
function pullRequestPlace(
  task: TaskSummary,
  pullRequest: TaskPullRequestLine,
): LinkPlace | undefined {
  const { agentId } = pullRequest;
  return agentId === undefined ? undefined : { kind: LINK_PLACE.CHANGES, planId: task.id, agentId };
}

/** Whether a pull request's row leaves for GitHub: one the service named a page for but no agent of. */
function opensOnGitHub(task: TaskSummary, pullRequest: TaskPullRequestLine): boolean {
  return pullRequestPlace(task, pullRequest) === undefined && pullRequest.url !== undefined;
}

/** A pull request opens in its agent's Pull request tab, else on GitHub, where it is worked on and merged; one the service sent no page for opens its task. */
export function openPullRequest(
  tasks: TasksControl,
  task: TaskSummary,
  pullRequest: TaskPullRequestLine,
) {
  const place = pullRequestPlace(task, pullRequest);
  if (place !== undefined) tasks.onOpenLink({ workspace: "", place });
  else if (pullRequest.url === undefined) tasks.onSelect(task.id);
  else tasks.repositories.openGitHub(pullRequest.url);
}

/** What a row's Copy link copies: what a press on it opens, a place in Luke, or a pull request's page on GitHub. */
type RowLink = { readonly place: LinkPlace } | { readonly url: string };

/** What a pull request's row copies: its page on GitHub, or its task where the service sent no page. Note that its page is copied though a press may open its Pull request tab, because a link to a pull request is read by teammates outside Luke too, and in Luke it opens the same tab. */
function pullRequestLink(task: TaskSummary, pullRequest: TaskPullRequestLine): RowLink {
  return pullRequest.url === undefined
    ? { place: { kind: LINK_PLACE.TASK, planId: task.id } }
    : { url: pullRequest.url };
}

/** What a pull request still being built says: a draft, or its checks running. */
function buildingWords(pullRequest: TaskPullRequestLine): string {
  return pullRequest.state === PULL_REQUEST_STATE.DRAFT
    ? `#${pullRequest.number} draft`
    : `#${pullRequest.number} checks running`;
}

/** The board as the window holds it now, and the read of what waits it was drawn from, which may have failed. */
interface FactoryRead {
  readonly board: FactoryBoard;
  readonly questions: WaitingItems;
}

/**
 * The board as the window holds it now: the workspace's tasks, every open
 * Inbox item of theirs as Home reads them, so Factory and Home count the
 * same questions, and the call.
 */
function useFactoryBoard(tasks: TasksControl, now: number): FactoryRead {
  const listed = tasks.listed.tasks;
  const questions = useWaitingItems(tasks);
  // Note that main's own count stands in only for a plan the Inbox has not read as it stands now, because such a read is newer than main's, and an item it shows answered must not come back; a plan changed since its last read, its reread out or failed, keeps main's count.
  const { items, readTasks } = questions;
  // Note that main's count leaves out what the window answered, from the moment it was sent, as the reads do.
  const settled = useSettledWaiting(tasks.inbox, tasks.inboxTaskless);
  const waiting = useMemo(
    () =>
      factoryWaiting(
        items,
        settled.waiting.filter((each) => !readTasks.has(each.taskId)),
      ),
    [items, readTasks, settled.waiting],
  );
  const oneOff = tasks.listedAgents.standing;
  // Note that an agent with no task keeps main's count on the same terms as a task does, until its own read is current.
  const { readAgents } = questions;
  const oneOffWaiting = useMemo(
    () =>
      factoryOneOffWaiting(
        items,
        settled.taskless.filter((each) => !readAgents.has(each.agentId)),
      ),
    [items, readAgents, settled.taskless],
  );
  const board = useMemo(
    () =>
      factoryBoard({
        tasks: listed,
        waiting,
        callTaskId: tasks.callTaskId,
        oneOff,
        oneOffWaiting,
        now,
      }),
    [listed, waiting, tasks.callTaskId, oneOff, oneOffWaiting, now],
  );
  return { board, questions };
}

/**
 * One slide where a row moved from one step to another, from where it
 * stood, and a fade where one arrived; nothing else moves. Reduced motion
 * and a capture run hold both still through the motion tokens.
 */
function useRowSlide(root: HTMLElement | null, board: FactoryBoard): void {
  const last = useRef(new Map<string, { step: string | undefined; rect: DOMRect }>());
  useLayoutEffect(() => {
    if (root === null) return;
    const timing = paneTiming(root);
    const seen = last.current;
    const next = new Map<string, { step: string | undefined; rect: DOMRect }>();
    for (const mark of root.querySelectorAll<HTMLElement>("[data-factory-row]")) {
      // Note that the key rides the row's glyph, so the item around it is what slides.
      const row = mark.closest<HTMLElement>("li") ?? mark;
      const key = mark.dataset.factoryRow ?? "";
      const step = row.closest<HTMLElement>("[data-step]")?.dataset.step;
      const rect = row.getBoundingClientRect();
      const was = seen.get(key);
      next.set(key, { step, rect });
      if (timing === undefined || seen.size === 0) continue;
      if (was === undefined) row.animate([{ opacity: 0 }, { opacity: 1 }], timing);
      else if (was.step !== step) {
        const moved = `translate(${was.rect.left - rect.left}px, ${was.rect.top - rect.top}px)`;
        row.animate([{ transform: moved }, { transform: "none" }], timing);
      }
    }
    last.current = next;
  }, [root, board]);
}

/** Copy link for a row: its place's Luke link under the workspace handed down, or the page it opens outside Luke. */
function useRowLinkItem(): (link: RowLink) => MenuAction | undefined {
  const linkItem = useCopyLinkItem();
  const copy = useCopyToast();
  return (link) =>
    "place" in link
      ? linkItem(link.place)
      : {
          label: LINK_COPY.LABEL,
          icon: <LinkIcon aria-hidden="true" />,
          onSelect: () => copy(link.url, LINK_COPY.COPIED),
        };
}

/**
 * A row that moves from one station's list to another keeps the keyboard:
 * React draws it anew in its new list and drops the one that held focus, so
 * where the row that held it is gone and focus with it, the row of the same
 * name takes it back. A row left for elsewhere keeps nothing.
 */
function useFocusFollows(root: HTMLElement | null, board: FactoryBoard): void {
  const held = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (root === null) return;
    const note = (event: FocusEvent) => {
      held.current = event.target instanceof HTMLElement ? event.target : null;
    };
    root.addEventListener("focusin", note);
    return () => root.removeEventListener("focusin", note);
  }, [root]);
  useLayoutEffect(() => {
    const was = held.current;
    if (root === null || was === null || was.isConnected) return;
    const lost = document.activeElement === null || document.activeElement === document.body;
    const key = was.querySelector<HTMLElement>("[data-factory-row]")?.dataset.factoryRow;
    if (!lost || key === undefined) return;
    const mark = [...root.querySelectorAll<HTMLElement>("[data-factory-row]")].find(
      (each) => each.dataset.factoryRow === key,
    );
    mark?.closest("li")?.querySelector<HTMLElement>(":scope > button")?.focus();
  }, [root, board]);
}

/**
 * A row as Home draws one: its glyph, what it is, the task it is about in
 * the context ink, a teammate's face, and when it moved; one that opens
 * GitHub says so with ↗ after its words, one that failed wears the failed
 * mark before its time, and one waiting on the developer is in the unread
 * weight with a dot past its time. Its hover hangs `card`, or says its
 * words whole, and its right-click offers Copy link, copying what a press
 * on it opens.
 */
function FactoryRow({
  slide,
  glyph,
  words,
  context,
  actor,
  at,
  end,
  external = false,
  waiting = false,
  card,
  link,
  onOpen,
}: {
  /** What Copy link copies: what a press on the row opens. */
  link: RowLink;
  /** What the row is across stations, so a move slides it: its plan, agent, item, or pull request. */
  slide: string;
  glyph: React.ReactNode;
  words: string;
  /** The task the row is about, where its words are not the task's name. */
  context?: string | undefined;
  /** Who the row names, where a teammate: who started its agent, else who created its task. */
  actor?: Actor | undefined;
  at: number;
  /** What stands before the time: the failed mark on what failed. */
  end?: React.ReactNode;
  external?: boolean;
  waiting?: boolean;
  card?: React.ReactNode;
  onOpen: () => void;
}): React.JSX.Element {
  const now = useMinute();
  const menu = useMenu(true);
  const copyLink = useRowLinkItem()(link);
  return (
    <>
      <RowHintOptions card={card}>
        <ListRow
          leading={
            <span className="home-row-picture" data-factory-row={slide}>
              {glyph}
            </span>
          }
          title={
            <>
              {words}
              {external ? (
                <span className="factory-external">
                  <ArrowUpRightIcon />
                  <span className="visually-hidden">(opens on GitHub)</span>
                </span>
              ) : null}
              {actor === undefined ? null : <CreatorHeard actor={actor} />}
            </>
          }
          meta={
            <span className="home-row-meta">
              {context === undefined ? null : <span className="home-row-context">{context}</span>}
              {actor === undefined ? null : <ActorMark actor={actor} size={ACTOR_SIZE.MARK} />}
              {end}
              {waiting ? (
                <span className="inbox-row-attention">
                  <AttentionMark />
                  <span className="visually-hidden">{NEEDS_YOU.LABEL}</span>
                </span>
              ) : null}
              <RelativeTime at={at} now={now} hint={false} />
            </span>
          }
          unread={waiting}
          hint={{ Hint: RowHint, label: words }}
          onPress={onOpen}
          contextMenu={copyLink === undefined ? undefined : menu.contextMenu()}
        />
      </RowHintOptions>
      {menu.drawn === undefined || copyLink === undefined ? null : (
        <ActionMenu
          label="Row actions"
          menu={menu.drawn}
          groups={[[copyLink]]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** One station: its glyph, name, and the count of its rows, what waits on the developer first and then its work, or a line saying it holds nothing, marked idle so it keeps to its words. */
function Station({
  step,
  needs = [],
  rows,
}: {
  step: FactoryStep;
  needs?: readonly React.ReactNode[];
  rows: readonly React.ReactNode[];
}): React.JSX.Element {
  const { name, Icon, idle } = STEPS[step];
  const held = needs.length + rows.length;
  return (
    <section
      className="factory-step"
      data-step={step}
      data-idle={held === 0 ? "" : undefined}
      aria-label={name}
    >
      <h2 className="factory-head">
        <Icon className="factory-glyph" aria-hidden="true" />
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.SECTION} truncate>
          {name}
        </Text>
        {held > 0 ? (
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE}>
            {held}
          </Text>
        ) : null}
      </h2>
      {held === 0 ? (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {idle}
        </Text>
      ) : null}
      {needs.length === 0 ? null : (
        <div className="factory-rows" data-needs="">
          <List label={`${name}, ${NEEDS_YOU.LABEL}`}>{needs}</List>
        </div>
      )}
      {rows.length === 0 ? null : (
        <div className="factory-rows">
          <List label={name}>{rows}</List>
        </div>
      )}
    </section>
  );
}

/** The arrow from one station to the next. */
function Arrow(): React.JSX.Element {
  return (
    <span className="factory-arrow" aria-hidden="true">
      <ArrowRightIcon />
    </span>
  );
}

/** Who a row names: whoever started its agent where that is a teammate, else whoever created its task where that is. */
function useWho(): (task: TaskSummary, agent?: TaskAgentLine) => Actor | undefined {
  const reader = useMemberDirectory();
  const started = useStarter();
  return (task, agent) =>
    agent?.startedBy === undefined ? teammateCreator(task, reader) : started(agent);
}

/** Who started an agent, where that is a teammate; an agent with no task names no creator besides. */
function useStarter(): (agent: Pick<TasklessAgent, "startedBy">) => Actor | undefined {
  const reader = useMemberDirectory();
  return ({ startedBy }) =>
    startedBy === undefined || startedBy.userId === reader.readerId
      ? undefined
      : personActor(startedBy, reader.members, reader.readerId);
}

/** The line, left to right, each station leading with what waits on the developer there. */
function Line({
  tasks,
  board,
  now,
}: {
  tasks: TasksControl;
  board: FactoryBoard;
  now: number;
}): React.JSX.Element {
  const card = (task: TaskSummary) => taskCardOf(tasks, task, now);
  const who = useWho();
  const started = useStarter();
  const models = tasks.agents.models;
  const ask = (task: TaskSummary, itemId: string) => {
    tasks.inboxView.onOpen();
    tasks.inboxView.onChoose({ taskId: task.id, itemId });
  };
  const talkRow = (task: TaskSummary) => (
    <FactoryRow
      key={task.id}
      slide={task.id}
      glyph={<CallIcon />}
      words={task.name}
      context="On a call with Luke"
      actor={who(task)}
      at={taskTime(task, TASK_ORDER.UPDATED)}
      card={card(task)}
      link={{ place: { kind: LINK_PLACE.TASK, planId: task.id } }}
      onOpen={() => tasks.onSelect(task.id)}
    />
  );
  // An agent with no task names its automation where the rows of a task name the task, and opens its own page.
  const oneOffStopRow = (
    stop: Extract<
      FactoryStop,
      { readonly kind: typeof FACTORY_STOP.ONE_OFF_QUESTION | typeof FACTORY_STOP.ONE_OFF_FAILED }
    >,
  ) => {
    const { agent } = stop;
    if (stop.kind === FACTORY_STOP.ONE_OFF_QUESTION) {
      const itemId = stop.item.id;
      return (
        <FactoryRow
          key={itemId}
          slide={itemId}
          glyph={<AgentGlyph agent={agent} />}
          words={stop.item.title}
          context={agent.automationName}
          actor={started(agent)}
          at={stop.item.postedAt}
          waiting
          link={{ place: { kind: LINK_PLACE.INBOX_ITEM, agentId: agent.id, itemId } }}
          onOpen={() => {
            tasks.inboxView.onOpen();
            tasks.inboxView.onChoose({ agentId: agent.id, itemId });
          }}
        />
      );
    }
    return (
      <FactoryRow
        key={agent.id}
        slide={agent.id}
        glyph={<AgentGlyph agent={agent} />}
        words={`${agentTabLabel(agent, models)} failed`}
        context={agent.automationName}
        actor={started(agent)}
        at={agent.activityAt}
        end={agentEndMark(agent, true)}
        waiting
        link={{ place: agentPlace({ id: agent.id, planId: null }) }}
        onOpen={() => tasks.agentView.onOpen(agent.id)}
      />
    );
  };
  const stopRow = (stop: FactoryStop) => {
    if (stop.kind === FACTORY_STOP.ONE_OFF_QUESTION || stop.kind === FACTORY_STOP.ONE_OFF_FAILED) {
      return oneOffStopRow(stop);
    }
    const { task } = stop;
    if (stop.kind === FACTORY_STOP.QUESTION) {
      const agent = task.agents?.agents.find((each) => each.id === stop.item.agentId);
      return (
        <FactoryRow
          key={stop.item.id}
          slide={stop.item.id}
          glyph={agent === undefined ? <MessageCircleQuestionIcon /> : <AgentGlyph agent={agent} />}
          words={stop.item.title}
          context={task.name}
          actor={who(task, agent)}
          at={stop.item.postedAt}
          waiting
          // Note that a question hangs no card, because its hover says the question whole, which its one line cuts short.
          link={{ place: { kind: LINK_PLACE.INBOX_ITEM, planId: task.id, itemId: stop.item.id } }}
          onOpen={() => ask(task, stop.item.id)}
        />
      );
    }
    const { agent } = stop;
    return (
      <FactoryRow
        key={agent.id}
        slide={agent.id}
        glyph={<AgentGlyph agent={agent} />}
        words={`${agentTabLabel(agent, models)} failed`}
        context={task.name}
        actor={who(task, agent)}
        at={agentMovedAt(task, agent)}
        end={agentEndMark(agent, true)}
        waiting
        card={card(task)}
        link={{ place: agentPlace({ id: agent.id, planId: task.id }) }}
        onOpen={() => tasks.onShowAgent(task.id, agent.id)}
      />
    );
  };
  const workRow = (work: FactoryWork) => {
    if (work.kind === FACTORY_WORK.ONE_OFF) {
      const { agent } = work;
      return (
        <FactoryRow
          key={agent.id}
          slide={agent.id}
          glyph={<AgentGlyph agent={agent} />}
          words={agentTabLabel(agent, models)}
          context={agent.automationName}
          actor={started(agent)}
          at={agent.activityAt}
          link={{ place: agentPlace({ id: agent.id, planId: null }) }}
          onOpen={() => tasks.agentView.onOpen(agent.id)}
        />
      );
    }
    const { task } = work;
    if (work.kind === FACTORY_WORK.AGENT) {
      const { agent } = work;
      return (
        <FactoryRow
          key={agent.id}
          slide={agent.id}
          glyph={<AgentGlyph agent={agent} />}
          words={agentTabLabel(agent, models)}
          context={task.name}
          actor={who(task, agent)}
          at={agentMovedAt(task, agent)}
          card={card(task)}
          link={{ place: agentPlace({ id: agent.id, planId: task.id }) }}
          onOpen={() => tasks.onShowAgent(task.id, agent.id)}
        />
      );
    }
    const { pullRequest } = work;
    return (
      <FactoryRow
        key={pullRequest.url ?? pullRequest.number}
        slide={pullRequest.url ?? task.id}
        glyph={<PullRequestMark pullRequest={pullRequest} />}
        words={buildingWords(pullRequest)}
        context={task.name}
        actor={who(task)}
        at={factoryMovedAt(task)}
        external={opensOnGitHub(task, pullRequest)}
        card={card(task)}
        link={pullRequestLink(task, pullRequest)}
        onOpen={() => openPullRequest(tasks, task, pullRequest)}
      />
    );
  };
  const blockRow = ({ kind, task, pullRequest }: FactoryBlock) => (
    <FactoryRow
      key={pullRequest.url ?? pullRequest.number}
      slide={pullRequest.url ?? task.id}
      glyph={<PullRequestMark pullRequest={pullRequest} />}
      words={`#${pullRequest.number} ${BLOCK_WORDS[kind]}`}
      context={task.name}
      actor={who(task)}
      at={factoryMovedAt(task)}
      end={kind === FACTORY_BLOCK.CHECKS ? stateEndMark(GLYPH_STATE.FAILED, true) : undefined}
      external={opensOnGitHub(task, pullRequest)}
      waiting
      card={card(task)}
      link={pullRequestLink(task, pullRequest)}
      onOpen={() => openPullRequest(tasks, task, pullRequest)}
    />
  );
  const shippedRow = ({ task, pullRequest, at }: FactoryShipped) => (
    <FactoryRow
      key={pullRequest.url ?? pullRequest.number}
      slide={pullRequest.url ?? task.id}
      glyph={<PullRequestMark pullRequest={pullRequest} />}
      words={`#${pullRequest.number} merged`}
      context={task.name}
      actor={who(task)}
      at={at}
      external={opensOnGitHub(task, pullRequest)}
      card={card(task)}
      link={pullRequestLink(task, pullRequest)}
      onOpen={() => openPullRequest(tasks, task, pullRequest)}
    />
  );
  return (
    <div className="factory-line-up">
      <Station step={FACTORY_STEP.TALK} rows={board.talking.map(talkRow)} />
      <Arrow />
      <Station
        step={FACTORY_STEP.BUILD}
        needs={board.stopped.map(stopRow)}
        rows={board.working.map(workRow)}
      />
      <Arrow />
      <Station
        step={FACTORY_STEP.SHIP}
        needs={board.blocked.map(blockRow)}
        rows={board.shipped.map(shippedRow)}
      />
    </div>
  );
}

/** The dot between the summary's parts, kept from a reader. */
function Separator(): React.JSX.Element {
  return (
    <span aria-hidden="true">
      <Text as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.SUBTLE}>
        ·
      </Text>
    </span>
  );
}

/** The line over the stations: how many things wait on the developer, how many agents work, and how much shipped today. */
function Summary({ board }: { board: FactoryBoard }): React.JSX.Element {
  const waiting = board.stopped.length + board.blocked.length;
  return (
    <p className="factory-summary">
      {waiting === 0 ? (
        <Text as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED}>
          {NEEDS_YOU.NONE}
        </Text>
      ) : (
        <span className="factory-needs">
          <AttentionMark />
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.LABEL}>
            {`${waiting} ${waiting === 1 ? NEEDS_YOU.COUNT.one : NEEDS_YOU.COUNT.many}`}
          </Text>
        </span>
      )}
      <Separator />
      <Text as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED}>
        {count(board.agentsWorking, "agent working", "agents working")}
      </Text>
      <Separator />
      <Text as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED}>
        {`${board.shipped.length} shipped today`}
      </Text>
    </p>
  );
}

/** What the line's page is read as while the list is. */
const READING_LINE = "Reading tasks…";

/** One placeholder row: how wide its words and the task it is about stand, so the rows read as rows of their own. */
interface SkeletonRowShape {
  readonly words: string;
  readonly context: string;
}

/** The placeholder rows each station holds while the list is read, a few apiece as a working day's line holds. */
const SKELETON_ROWS = {
  [FACTORY_STEP.TALK]: [{ words: "136px", context: "60%" }],
  [FACTORY_STEP.BUILD]: [
    { words: "168px", context: "72%" },
    { words: "120px", context: "56%" },
    { words: "148px", context: "64%" },
  ],
  [FACTORY_STEP.SHIP]: [
    { words: "96px", context: "68%" },
    { words: "112px", context: "52%" },
  ],
} as const satisfies Record<FactoryStep, readonly SkeletonRowShape[]>;

/** How wide the summary's placeholder parts stand: what waits, what works, and what shipped. */
const SKELETON_SUMMARY = ["104px", "112px", "96px"] as const;

/** How wide a placeholder row's glyph stands, a row's picture at its size (`.home-row-picture`). */
const SKELETON_GLYPH = "16px";

/** How wide a placeholder row's time stands, as wide as a short "2h". */
const SKELETON_TIME = "20px";

/** What the list says where it could not be read, as the sidebar says it. */
const UNREAD_LINE = "Your tasks could not be read.";

/** What Factory says where a task's questions could not be read, as Home says it of its items. */
const QUESTIONS_UNREAD_LINE = "Some questions could not be read.";

/** A placeholder row in a row's own line: a block for its glyph, its words, the task it is about, and its time. It opens nothing. */
function SkeletonRow({ shape }: { shape: SkeletonRowShape }): React.JSX.Element {
  return (
    <li className="home-row inbox-row factory-skeleton-row">
      <span className="sidebar-task-line">
        <span className="home-row-picture">
          <Skeleton shape={SKELETON_SHAPE.CIRCLE} width={SKELETON_GLYPH} />
        </span>
        <span className="sidebar-task-name">
          <Skeleton width={shape.words} />
        </span>
        <span className="home-row-context">
          <Skeleton width={shape.context} />
        </span>
        <span className="sidebar-task-time">
          <Skeleton width={SKELETON_TIME} />
        </span>
      </span>
    </li>
  );
}

/**
 * The line while the plan list is first read: the summary in blocks over
 * the three stations, each named as it will be and holding placeholder
 * rows, laid out by the line's own rules, so the line stands side by side
 * or stacked as the room has it and the rows land where the blocks stood.
 * The region says what is being read and nothing else to a reader.
 */
function LineSkeleton(): React.JSX.Element {
  const station = (step: FactoryStep) => {
    const { name, Icon } = STEPS[step];
    return (
      <div className="factory-step">
        <div className="factory-head">
          <Icon className="factory-glyph" />
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.SECTION} truncate>
            {name}
          </Text>
        </div>
        <ul className="sidebar-tasks factory-rows">
          {SKELETON_ROWS[step].map((shape) => (
            <SkeletonRow key={shape.words} shape={shape} />
          ))}
        </ul>
      </div>
    );
  };
  return (
    <SkeletonRegion label={READING_LINE}>
      <div aria-hidden="true">
        <p className="factory-summary">
          {SKELETON_SUMMARY.map((width) => (
            <Text key={width} as={TEXT_ELEMENT.SPAN}>
              <Skeleton width={width} />
            </Text>
          ))}
        </p>
        <div className="factory-line-up">
          {station(FACTORY_STEP.TALK)}
          <Arrow />
          {station(FACTORY_STEP.BUILD)}
          <Arrow />
          {station(FACTORY_STEP.SHIP)}
        </div>
      </div>
    </SkeletonRegion>
  );
}

/**
 * What the line's page stands. Note that until the list is read it stands
 * the line's own placeholder (`LineSkeleton`) rather than the page's loading
 * rows, since those are a list's shape, not the line's; a read that failed
 * with nothing listed says so in the line's place, and one that failed over
 * a list read before says so above the line.
 */
function lineState(tasks: TasksControl, empty: boolean): CollectionState {
  if (tasks.listFailed && empty) return COLLECTION_STATE.ERROR;
  if (!tasks.listRead && !tasks.listFailed) return COLLECTION_STATE.READY;
  return empty ? COLLECTION_STATE.EMPTY : COLLECTION_STATE.READY;
}

/** The window's Factory, in the task's place: the line as it stands now, or the campus in its place. */
export function DesktopFactory({ tasks }: { tasks: TasksControl }): React.JSX.Element {
  const views = useFactoryViews();
  // Note that the campus takes Escape first, for as long as it has a step back toward its overview to take.
  const backOut = useRef<(() => boolean) | undefined>(undefined);
  useAppCommand(APP_COMMAND.EXIT_FACTORY, () => {
    if (backOut.current?.() !== true) tasks.factoryView.onClose();
  });
  const now = useMinute();
  const { board, questions } = useFactoryBoard(tasks, now);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useRowSlide(root, board);
  useRowKeys(root, tasks.shown);
  useFocusFollows(root, board);
  const empty =
    board.talking.length +
      board.stopped.length +
      board.working.length +
      board.blocked.length +
      board.shipped.length ===
    0;
  const toolbar = (
    <header className="desktop-toolbar">
      <div className="desktop-toolbar-heading">
        <h1 className="desktop-toolbar-title">Factory</h1>
        <ExperimentTag />
      </div>
      <div className="desktop-toolbar-actions">
        {views.offered ? <FactoryViewPicker views={views} /> : null}
        <SendFeedbackButton experiment={EXPERIMENT.FACTORY} />
      </div>
    </header>
  );
  // A question that could not be read is not shown as though none waits, whatever the line stands.
  const questionsUnread = questions.failed ? (
    <ErrorState onRetry={questions.onRetry}>{QUESTIONS_UNREAD_LINE}</ErrorState>
  ) : null;
  const state = lineState(tasks, empty);
  return (
    <div ref={setRoot} className="factory-pages">
      {views.choice === FACTORY_CHOICE.CAMPUS ? (
        <section className="factory-view" aria-label="Factory">
          {toolbar}
          <FactoryWorldPage tasks={tasks} backOut={backOut} />
        </section>
      ) : (
        // The line stands across the room, its stations side by side wherever they fit.
        <CollectionPage
          frame={PAGE_FRAME.TOOLBAR}
          width={PAGE_WIDTH.FULL}
          label="Factory"
          toolbar={toolbar}
          state={state}
          loadingLabel={READING_LINE}
          empty={
            <>
              {questionsUnread}
              <EmptyState icon={<FactoryIcon />}>No agents at work</EmptyState>
            </>
          }
          error={
            <>
              {questionsUnread}
              <ErrorState onRetry={tasks.onRetryList} placement={ERROR_STATE_PLACEMENT.CENTRED}>
                {UNREAD_LINE}
              </ErrorState>
            </>
          }
        >
          <div className="factory-board">
            {questionsUnread}
            {!tasks.listRead && !tasks.listFailed ? (
              <LineSkeleton />
            ) : (
              <>
                {tasks.listFailed ? (
                  <ErrorState onRetry={tasks.onRetryList}>{UNREAD_LINE}</ErrorState>
                ) : null}
                <Summary board={board} />
                {/* A teammate's task names its creator against the listed workspace's members. */}
                {/* Copy link writes a row's link under the listed workspace, by its slug where it has one. */}
                <LinkWorkspaceProvider value={tasks.workspace?.slug ?? tasks.workspace?.id}>
                  <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
                    <Line tasks={tasks} board={board} now={now} />
                  </MemberDirectory>
                </LinkWorkspaceProvider>
              </>
            )}
          </div>
        </CollectionPage>
      )}
    </div>
  );
}
