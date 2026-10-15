import { PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import type { PlanAgentLine, PlanPullRequestLine, PlanSummary } from "@luke/features/plan-wire";
import { EXPERIMENT } from "@luke/settings";
import { type Actor, personActor, teammateCreator } from "@luke/ui/actor-model";
import { TASK_ORDER, taskTime } from "@luke/ui/task-list-model";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  AudioLinesIcon,
  BlocksIcon,
  FactoryIcon,
  GitMergeIcon,
  MessageCircleQuestionIcon,
} from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { ACTOR_SIZE, ActorMark, CreatorHeard } from "../actor-ref";
import { useAppCommand } from "../app-commands";
import { EmptyState } from "../empty-state";
import { ExperimentTag, SendFeedbackButton } from "../experiment-marks";
import { MemberDirectory, useMemberDirectory } from "../member-directory";
import { agentTabLabel } from "../planning/coding-agent-model";
import { NEEDS_YOU } from "../planning/inbox-model";
import { useMinute } from "../planning/plan-time";
import { PullRequestMark } from "../planning/pull-request-mark";
import { RelativeTime } from "../planning/relative-time";
import { AgentGlyph, agentEndMark } from "../planning/tab-look";
import type { PlansControl } from "../planning/use-plans-tab";
import { SIDE_PANEL_TAB, SIDE_PANEL_TAB_KIND } from "../planning/use-side-panel";
import { useWaitingItems, type WaitingItems } from "../planning/use-waiting-items";
import { READ_FAILURE_PLACE, ReadFailure } from "../read-failure";
import { GLYPH_STATE, stateEndMark } from "../state-glyph";
import { Tooltip } from "../tooltip";
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
  factoryWaiting,
} from "./factory-model";
import { paneTiming } from "./pane-motion";
import { planCardOf } from "./plan-card";

/**
 * desktop-factory.tsx -- the window's Factory: the workspace's tasks being talked through, built, and shipped, as three stations on one line, each leading with what waits on the developer there.
 *
 * It stands in the plan's place beside the sidebar, as the Inbox does, and
 * is a live view rather than a report: no totals, only where work stands
 * now and what moved in the last day (`factory-model.ts`), read from the
 * plan list, every member's open Inbox items as Home reads them, and the
 * call. Three stations run left to right, each a card counting the rows it
 * lists: Talk, the task on a call with Luke; Build, the agents at work; and
 * Ship, what merged in the last day. Every row reads as Home's does: a glyph, what it is, the task it is
 * about in the faint context ink, a teammate's face, and when it moved, the
 * time slot holding nothing but a time. What waits on the developer stands
 * first in the station it holds up, in the unread weight with its dot,
 * apart from the rest by a hairline: under Build the agents stopped on a
 * question or a failed turn, under Ship failing checks and pull requests
 * ready to merge. The line above the stations says how many wait, how many
 * agents work, and how much shipped today. A question opens in the Inbox,
 * an agent its page, a pull request on GitHub (its row ends in ↗), and
 * anything else its task, whose card hangs on the row's hover. A row that
 * moves from one station to another slides there once, and one that arrives
 * fades in; nothing else moves, and the times count on with the window's
 * minute. Escape leaves it for the task it stood over, and so does any row
 * of the sidebar. Until the plan list is read nothing stands, a list that
 * could not be read says so with Retry, above the line
 * where an earlier read still stands, and with nothing on a call, built,
 * or shipped the page is the app's empty state. It is an experiment
 * (`EXPERIMENT.FACTORY`): every door to it is gated on the account's switch,
 * and its toolbar says so with the Experimental tag and Send feedback.
 */

/** What each station is called, its glyph, and what it says with nothing in it. */
const STEPS = {
  [FACTORY_STEP.TALK]: { name: "Talk", Icon: AudioLinesIcon, idle: "No task on a call" },
  [FACTORY_STEP.BUILD]: { name: "Build", Icon: BlocksIcon, idle: "No agents working" },
  [FACTORY_STEP.SHIP]: { name: "Ship", Icon: GitMergeIcon, idle: "Nothing shipped today" },
} as const;

const CallGlyph = SIDE_PANEL_TAB_KIND[SIDE_PANEL_TAB.CALL].icon;

/** What a block's row says it waits for. */
const BLOCK_WORDS = {
  [FACTORY_BLOCK.CHECKS]: "checks failing",
  [FACTORY_BLOCK.MERGE]: "ready to merge",
} as const;

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A pull request opens on GitHub, where it is worked on and merged; one the service sent no page for opens its plan. */
function openPullRequest(plans: PlansControl, plan: PlanSummary, pullRequest: PlanPullRequestLine) {
  if (pullRequest.url === undefined) plans.onSelect(plan.id);
  else plans.repositories.openGitHub(pullRequest.url);
}

/** What a pull request still being built says: a draft, or its checks running. */
function buildingWords(pullRequest: PlanPullRequestLine): string {
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
function useFactoryBoard(plans: PlansControl, now: number): FactoryRead {
  const listed = plans.listed.plans;
  const questions = useWaitingItems(plans);
  // Note that main's own count stands in only for a plan the Inbox has not read as it stands now, because such a read is newer than main's, and an item it shows answered must not come back; a plan changed since its last read, its reread out or failed, keeps main's count.
  const { items, readPlans } = questions;
  const waiting = useMemo(
    () =>
      factoryWaiting(
        items,
        plans.inbox.filter((each) => !readPlans.has(each.planId)),
      ),
    [items, readPlans, plans.inbox],
  );
  const board = useMemo(
    () => factoryBoard({ plans: listed, waiting, callPlanId: plans.callPlanId, now }),
    [listed, waiting, plans.callPlanId, now],
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
    for (const row of root.querySelectorAll<HTMLElement>("[data-factory-row]")) {
      const key = row.dataset.factoryRow ?? "";
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

/**
 * A row as Home draws one: its glyph, what it is, the task it is about in
 * the context ink, a teammate's face, and when it moved; one that opens
 * GitHub says so with ↗ after its words, one that failed wears the failed
 * mark before its time, and one waiting on the developer is in the unread
 * weight with a dot past its time. Its hover hangs `card`, or says its
 * words whole.
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
  onOpen,
}: {
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
  return (
    <li className="sidebar-plan-item home-row inbox-row factory-row" data-factory-row={slide}>
      <Tooltip label={words} card={card}>
        <button
          type="button"
          className="sidebar-plan"
          data-unread={String(waiting)}
          onClick={onOpen}
        >
          <span className="sidebar-plan-line">
            <span className="home-row-picture">{glyph}</span>
            <span className="sidebar-plan-name">{words}</span>
            {external ? (
              <span className="factory-external">
                <ArrowUpRightIcon className="text-link-out" aria-hidden="true" />
                <span className="visually-hidden">(opens on GitHub)</span>
              </span>
            ) : null}
            {context === undefined ? null : <span className="home-row-context">{context}</span>}
            {actor === undefined ? null : <CreatorHeard actor={actor} />}
            <span className="sidebar-plan-time">
              {actor === undefined ? null : <ActorMark actor={actor} size={ACTOR_SIZE.MARK} />}
              {end}
              <RelativeTime at={at} now={now} hint={false} />
            </span>
            {waiting ? (
              <span className="inbox-row-dot">
                <span className="visually-hidden">{NEEDS_YOU.LABEL}</span>
              </span>
            ) : null}
          </span>
        </button>
      </Tooltip>
    </li>
  );
}

/** One station: its glyph, name, and the count of its rows, what waits on the developer first and then its work, or a line saying it holds nothing. */
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
    <section className="factory-step" data-step={step} aria-label={name}>
      <h2 className="factory-head">
        <Icon className="factory-glyph" aria-hidden="true" />
        <span className="factory-name">{name}</span>
        {held > 0 ? <span className="factory-count">{held}</span> : null}
      </h2>
      {held === 0 ? <p className="factory-idle">{idle}</p> : null}
      {needs.length === 0 ? null : (
        <ul className="sidebar-plans factory-rows" data-needs="">
          {needs}
        </ul>
      )}
      {rows.length === 0 ? null : <ul className="sidebar-plans factory-rows">{rows}</ul>}
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
function useWho(): (plan: PlanSummary, agent?: PlanAgentLine) => Actor | undefined {
  const reader = useMemberDirectory();
  return (plan, agent) => {
    const starter = agent?.startedBy;
    if (starter === undefined) return teammateCreator(plan, reader);
    if (starter.userId === reader.readerId) return undefined;
    return personActor(starter, reader.members, reader.readerId);
  };
}

/** The line, left to right, each station leading with what waits on the developer there. */
function Line({
  plans,
  board,
  now,
}: {
  plans: PlansControl;
  board: FactoryBoard;
  now: number;
}): React.JSX.Element {
  const card = (plan: PlanSummary) => planCardOf(plans, plan, now);
  const who = useWho();
  const models = plans.agents.models;
  const ask = (plan: PlanSummary, itemId: string) => {
    plans.inboxView.onOpen();
    plans.inboxView.onChoose({ planId: plan.id, itemId });
  };
  const talkRow = (plan: PlanSummary) => (
    <FactoryRow
      key={plan.id}
      slide={plan.id}
      glyph={<CallGlyph />}
      words={plan.name}
      context="On a call with Luke"
      actor={who(plan)}
      at={taskTime(plan, TASK_ORDER.UPDATED)}
      card={card(plan)}
      onOpen={() => plans.onSelect(plan.id)}
    />
  );
  const stopRow = (stop: FactoryStop) => {
    const { plan } = stop;
    if (stop.kind === FACTORY_STOP.QUESTION) {
      const agent = plan.agents?.agents.find((each) => each.id === stop.item.agentId);
      return (
        <FactoryRow
          key={stop.item.id}
          slide={stop.item.id}
          glyph={agent === undefined ? <MessageCircleQuestionIcon /> : <AgentGlyph agent={agent} />}
          words={stop.item.title}
          context={plan.name}
          actor={who(plan, agent)}
          at={stop.item.postedAt}
          waiting
          // Note that a question hangs no card, because its hover says the question whole, which its one line cuts short.
          onOpen={() => ask(plan, stop.item.id)}
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
        context={plan.name}
        actor={who(plan, agent)}
        at={agentMovedAt(plan, agent)}
        end={agentEndMark(agent, true)}
        waiting
        card={card(plan)}
        onOpen={() => plans.onShowAgent(plan.id, agent.id)}
      />
    );
  };
  const workRow = (work: FactoryWork) => {
    const { plan } = work;
    if (work.kind === FACTORY_WORK.AGENT) {
      const { agent } = work;
      return (
        <FactoryRow
          key={agent.id}
          slide={agent.id}
          glyph={<AgentGlyph agent={agent} />}
          words={agentTabLabel(agent, models)}
          context={plan.name}
          actor={who(plan, agent)}
          at={agentMovedAt(plan, agent)}
          card={card(plan)}
          onOpen={() => plans.onShowAgent(plan.id, agent.id)}
        />
      );
    }
    const { pullRequest } = work;
    return (
      <FactoryRow
        key={pullRequest.url ?? pullRequest.number}
        slide={pullRequest.url ?? plan.id}
        glyph={<PullRequestMark pullRequest={pullRequest} />}
        words={buildingWords(pullRequest)}
        context={plan.name}
        actor={who(plan)}
        at={factoryMovedAt(plan)}
        external={pullRequest.url !== undefined}
        card={card(plan)}
        onOpen={() => openPullRequest(plans, plan, pullRequest)}
      />
    );
  };
  const blockRow = ({ kind, plan, pullRequest }: FactoryBlock) => (
    <FactoryRow
      key={pullRequest.url ?? pullRequest.number}
      slide={pullRequest.url ?? plan.id}
      glyph={<PullRequestMark pullRequest={pullRequest} />}
      words={`#${pullRequest.number} ${BLOCK_WORDS[kind]}`}
      context={plan.name}
      actor={who(plan)}
      at={factoryMovedAt(plan)}
      end={kind === FACTORY_BLOCK.CHECKS ? stateEndMark(GLYPH_STATE.FAILED, true) : undefined}
      external={pullRequest.url !== undefined}
      waiting
      card={card(plan)}
      onOpen={() => openPullRequest(plans, plan, pullRequest)}
    />
  );
  const shippedRow = ({ plan, pullRequest, at }: FactoryShipped) => (
    <FactoryRow
      key={pullRequest.url ?? pullRequest.number}
      slide={pullRequest.url ?? plan.id}
      glyph={<PullRequestMark pullRequest={pullRequest} />}
      words={`#${pullRequest.number} merged`}
      context={plan.name}
      actor={who(plan)}
      at={at}
      external={pullRequest.url !== undefined}
      card={card(plan)}
      onOpen={() => openPullRequest(plans, plan, pullRequest)}
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

/** The line over the stations: how many things wait on the developer, how many agents work, and how much shipped today. */
function Summary({ board }: { board: FactoryBoard }): React.JSX.Element {
  const waiting = board.stopped.length + board.blocked.length;
  return (
    <p className="factory-summary">
      {waiting === 0 ? (
        <span>{NEEDS_YOU.NONE}</span>
      ) : (
        <span className="factory-needs">
          <span className="inbox-row-dot factory-head-dot" aria-hidden="true" />
          {`${waiting} ${waiting === 1 ? NEEDS_YOU.COUNT.one : NEEDS_YOU.COUNT.many}`}
        </span>
      )}
      <span className="factory-sep" aria-hidden="true">
        ·
      </span>
      <span>{count(board.agentsWorking, "agent working", "agents working")}</span>
      <span className="factory-sep" aria-hidden="true">
        ·
      </span>
      <span>{`${board.shipped.length} shipped today`}</span>
    </p>
  );
}

/** What the list says where it could not be read, as the sidebar says it. */
const UNREAD_LINE = "Your tasks could not be read.";

/** What Factory says where a task's questions could not be read, as Home says it of its items. */
const QUESTIONS_UNREAD_LINE = "Some questions could not be read.";

/** The window's Factory, in the plan's place: the line as it stands now. */
export function DesktopFactory({ plans }: { plans: PlansControl }): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_FACTORY, plans.factoryView.onClose);
  const now = useMinute();
  const { board, questions } = useFactoryBoard(plans, now);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useRowSlide(root, board);
  const empty =
    board.talking.length +
      board.stopped.length +
      board.working.length +
      board.blocked.length +
      board.shipped.length ===
    0;
  return (
    <section className="factory-view" aria-label="Factory" ref={setRoot}>
      <header className="desktop-toolbar">
        <div className="desktop-toolbar-heading">
          <h1 className="desktop-toolbar-title">Factory</h1>
          <ExperimentTag />
        </div>
        <div className="desktop-toolbar-actions">
          <SendFeedbackButton experiment={EXPERIMENT.FACTORY} />
        </div>
      </header>
      <div className="factory-scroll">
        {/* A question that could not be read is not shown as though none waits. */}
        {questions.failed ? (
          <ReadFailure line={QUESTIONS_UNREAD_LINE} onRetry={questions.onRetry} />
        ) : null}
        {/* Until the list is read nothing stands, since what the line says hangs on it. A read that failed with nothing listed says so in the line's place; one that failed over a list read before says so above it. */}
        {plans.listFailed && empty ? (
          <ReadFailure
            line={UNREAD_LINE}
            onRetry={plans.onRetryList}
            place={READ_FAILURE_PLACE.CENTRED}
          />
        ) : !plans.listRead && !plans.listFailed ? null : empty ? (
          <EmptyState icon={<FactoryIcon />} title="No agents at work">
            Agents you and your team start show here as they work.
          </EmptyState>
        ) : (
          <>
            {plans.listFailed ? (
              <ReadFailure line={UNREAD_LINE} onRetry={plans.onRetryList} />
            ) : null}
            <Summary board={board} />
            {/* A teammate's task names its creator against the listed workspace's members. */}
            <MemberDirectory workspace={plans.workspace} readerId={plans.me}>
              <Line plans={plans} board={board} now={now} />
            </MemberDirectory>
          </>
        )}
      </div>
    </section>
  );
}
