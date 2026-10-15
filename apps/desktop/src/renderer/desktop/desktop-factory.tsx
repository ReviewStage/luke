import type { PlanSummary } from "@luke/features/plan-wire";
import { EXPERIMENT } from "@luke/settings";
import { CodingAgentsIcon } from "@luke/ui";
import {
  ArrowRightIcon,
  AudioLinesIcon,
  CircleCheckIcon,
  FileTextIcon,
  GitMergeIcon,
  MessageCircleQuestionIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { useOpenFeedback } from "../open-feedback";
import { NEEDS_YOU } from "../planning/inbox-model";
import { useMinute } from "../planning/plan-time";
import { PullRequestMark } from "../planning/pull-request-mark";
import { RelativeTime } from "../planning/relative-time";
import { AgentGlyph } from "../planning/tab-look";
import type { PlansControl } from "../planning/use-plans-tab";
import { SIDE_PANEL_TAB, SIDE_PANEL_TAB_KIND } from "../planning/use-side-panel";
import { Tooltip } from "../tooltip";
import { NewPlanButton } from "./desktop-home";
import {
  EMPTY_MERGED,
  FACTORY_STEP,
  type FactoryBoard,
  type FactoryBuilding,
  type FactoryMerge,
  type FactoryPlanning,
  type FactoryQuestion,
  type FactoryShipped,
  type FactoryStep,
  factoryBoard,
  type MergedSeen,
  noteMerged,
} from "./factory-model";
import { paneTiming } from "./pane-motion";
import { planCardOf } from "./plan-card";

/**
 * desktop-factory.tsx -- the window's Factory: every plan of the workspace being planned, built, and shipped right now, on one line, with what waits on the developer at the foot of the step it holds up.
 *
 * It stands in the plan's place beside the sidebar, as the Inbox does, and
 * is a live view rather than a report: no range, no totals, only where work
 * stands now (`factory-model.ts`), read from the plan list, main's Inbox
 * read, and the call. Three steps run left to right, Plan, Build, and Ship,
 * each a card listing its plans as the sidebar draws a plan, with the
 * plan's card on hover, and a question's hover saying it whole. What waits on the developer is the foot of a step,
 * lined up across the line: the Inbox's open questions under Build, each in
 * full with the question's glyph rather than the working mark, since its
 * agent is stopped, and the pull requests ready to merge under Ship. Where
 * both wait, the one to take first says so. A question opens in the Inbox,
 * a pull request on GitHub, and anything else its plan. A row that moves
 * from one step to another slides there once, and one that arrives fades in;
 * nothing else moves, and the times count on with the window's minute.
 * Escape leaves it for the plan it stood over, and so does any row of the
 * sidebar. It is an experiment (`EXPERIMENT.FACTORY`): every door to it is
 * gated on the account's switch, and its toolbar says so with a quiet badge
 * and Send feedback.
 */

/** What each step is called, its glyph, and what its line says with nothing in it. */
const STEPS = {
  [FACTORY_STEP.PLAN]: { name: "Plan", Icon: AudioLinesIcon, idle: "No plan in progress" },
  [FACTORY_STEP.BUILD]: { name: "Build", Icon: CodingAgentsIcon, idle: "No agents working" },
  [FACTORY_STEP.SHIP]: { name: "Ship", Icon: GitMergeIcon, idle: "Nothing just shipped" },
} as const;

/** The most rows a step lists before it counts the rest. */
const STEP_ROWS = 4;

const CallGlyph = SIDE_PANEL_TAB_KIND[SIDE_PANEL_TAB.CALL].icon;

/** A pull request ready to merge opens on GitHub, where it is merged; one the service sent no page for opens its plan. */
function openMerge(plans: PlansControl, { plan, pullRequest }: FactoryMerge): void {
  if (pullRequest.url === undefined) plans.onSelect(plan.id);
  else plans.repositories.openGitHub(pullRequest.url);
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What needs the developer, in the summary's words: questions, then merges. */
function needsText(board: FactoryBoard): string | undefined {
  const parts = [
    board.questions.length > 0 ? count(board.questions.length, "question", "questions") : "",
    board.merges.length > 0 ? count(board.merges.length, "merge", "merges") : "",
  ].filter((part) => part !== "");
  if (parts.length === 0) return undefined;
  const waiting = board.questions.length + board.merges.length;
  return `${parts.join(" and ")} ${waiting === 1 ? "needs" : "need"} you`;
}

/**
 * The board as the window holds it now: the workspace's plans, what main
 * says waits, and the call, with each pull request seen turning merged
 * carried from one read of the list to the next.
 */
function useFactoryBoard(plans: PlansControl, now: number): FactoryBoard {
  const listed = plans.listed.plans;
  const before = useRef<readonly PlanSummary[] | undefined>(undefined);
  const [merged, setMerged] = useState<MergedSeen>(EMPTY_MERGED);
  useEffect(() => {
    setMerged((seen) => noteMerged(seen, before.current, listed, Date.now()));
    before.current = listed;
  }, [listed]);
  return useMemo(
    () =>
      factoryBoard({
        plans: listed,
        waiting: plans.inbox,
        callPlanId: plans.callPlanId,
        merged,
        now,
      }),
    [listed, plans.inbox, plans.callPlanId, merged, now],
  );
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

/** A row as the sidebar draws a plan: its glyph, its words, and how long ago it moved, or a word in its time's place; one waiting on the developer in the unread weight with a dot past its time. Its hover hangs `card`, or says its words whole. */
function FactoryRow({
  slide,
  glyph,
  words,
  time,
  waiting = false,
  card,
  onOpen,
}: {
  /** What the row is across steps, so a move slides it: its plan, or its question. */
  slide: string;
  glyph: React.ReactNode;
  words: string;
  /** How long ago the row moved, or a word in its time's place. */
  time: { readonly at: number } | { readonly word: string };
  waiting?: boolean;
  card?: React.ReactNode;
  onOpen: () => void;
}): React.JSX.Element {
  const now = useMinute();
  return (
    <li className="sidebar-plan-item inbox-row factory-row" data-factory-row={slide}>
      <Tooltip label={words} card={card}>
        <button
          type="button"
          className="sidebar-plan"
          data-unread={String(waiting)}
          onClick={onOpen}
        >
          <span className="sidebar-plan-line">
            <span className="sidebar-pinned-tab-glyph">{glyph}</span>
            <span className="sidebar-plan-name">{words}</span>
            <span className="sidebar-plan-time">
              {"word" in time ? time.word : <RelativeTime at={time.at} now={now} hint={false} />}
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

/** What waits on the developer at a step's foot: whose turn it is, what to do, why, and the rows. */
function Wait({
  order,
  name,
  line,
  children,
}: {
  order: string | undefined;
  name: string;
  line: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="factory-wait">
      <p className="factory-over">
        Waiting for you
        {order === undefined ? null : ` · ${order}`}
      </p>
      <h3 className="factory-head">
        <span className="factory-name">{name}</span>
        <span className="inbox-row-dot factory-head-dot" aria-hidden="true" />
      </h3>
      <p className="factory-line">{line}</p>
      <ul className="sidebar-plans factory-rows" data-wait="">
        {children}
      </ul>
    </div>
  );
}

/** One step: its glyph, name, and count, what it holds in a line, its first rows and how many more, and what waits at its foot. */
function Step({
  step,
  line,
  rows,
  wait,
}: {
  step: FactoryStep;
  line: string | undefined;
  rows: readonly React.ReactNode[];
  wait?: React.ReactNode;
}): React.JSX.Element {
  const { name, Icon, idle } = STEPS[step];
  const held = rows.length;
  return (
    <section className="factory-step" data-step={step} aria-label={name}>
      <div className="factory-work">
        <h2 className="factory-head">
          <Icon className="factory-glyph" aria-hidden="true" />
          <span className="factory-name">{name}</span>
          {held > 0 ? <span className="factory-count">{held}</span> : null}
        </h2>
        <p className="factory-line">{line ?? idle}</p>
        <ul className="sidebar-plans factory-rows">
          {rows.slice(0, STEP_ROWS)}
          {held > STEP_ROWS ? <li className="factory-more">{held - STEP_ROWS} more</li> : null}
        </ul>
      </div>
      {wait}
    </section>
  );
}

/** The arrow from one step to the next. */
function Arrow(): React.JSX.Element {
  return (
    <span className="factory-arrow" aria-hidden="true">
      <ArrowRightIcon />
    </span>
  );
}

/** The line, left to right, and what waits at its steps' feet. */
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
  const order = (step: FactoryStep) =>
    board.questions.length > 0 && board.merges.length > 0
      ? board.first === step
        ? "start here"
        : "then"
      : undefined;
  const ask = ({ plan, item }: FactoryQuestion) => {
    plans.inboxView.onOpen();
    plans.inboxView.onChoose({ planId: plan.id, itemId: item.id });
  };
  const planRow = ({ plan, onCall }: FactoryPlanning) => (
    <FactoryRow
      key={plan.id}
      slide={plan.id}
      glyph={onCall ? <CallGlyph /> : <FileTextIcon />}
      words={plan.name}
      time={onCall ? { word: "On a call" } : { at: plan.updatedAt }}
      card={card(plan)}
      onOpen={() => plans.onSelect(plan.id)}
    />
  );
  const buildRow = ({ plan, agent, pullRequest }: FactoryBuilding) => (
    <FactoryRow
      key={plan.id}
      slide={plan.id}
      glyph={
        agent !== undefined ? (
          <AgentGlyph agent={agent} />
        ) : pullRequest !== undefined ? (
          <PullRequestMark pullRequest={pullRequest} />
        ) : null
      }
      words={plan.name}
      time={{ at: agent?.at ?? plan.updatedAt }}
      card={card(plan)}
      onOpen={() =>
        agent === undefined ? plans.onSelect(plan.id) : plans.onShowAgent(plan.id, agent.id)
      }
    />
  );
  const questionRow = (question: FactoryQuestion) => (
    <FactoryRow
      key={question.item.id}
      slide={question.item.id}
      glyph={<MessageCircleQuestionIcon className="factory-asking" />}
      words={question.item.title}
      time={{ at: question.item.postedAt }}
      waiting
      onOpen={() => ask(question)}
    />
  );
  const mergeRow = (ready: FactoryMerge) => (
    <FactoryRow
      key={ready.pullRequest.url ?? ready.pullRequest.number}
      slide={ready.plan.id}
      glyph={<PullRequestMark pullRequest={ready.pullRequest} />}
      words={ready.plan.name}
      time={{ word: `#${ready.pullRequest.number}` }}
      waiting
      card={card(ready.plan)}
      onOpen={() => openMerge(plans, ready)}
    />
  );
  const shippedRow = ({ plan, pullRequest, at }: FactoryShipped) => (
    <FactoryRow
      key={pullRequest.url ?? pullRequest.number}
      slide={plan.id}
      glyph={<CircleCheckIcon className="factory-shipped" />}
      words={plan.name}
      time={{ at }}
      card={card(plan)}
      onOpen={() => plans.onSelect(plan.id)}
    />
  );
  return (
    <div className="factory-line-up">
      <Step
        step={FACTORY_STEP.PLAN}
        line={board.planning.length > 0 ? "Being planned with Luke" : undefined}
        rows={board.planning.map(planRow)}
      />
      <Arrow />
      <Step
        step={FACTORY_STEP.BUILD}
        line={
          board.agentsWorking > 0
            ? `${count(board.agentsWorking, "agent", "agents")} working`
            : board.building.length > 0
              ? "In checks"
              : undefined
        }
        rows={board.building.map(buildRow)}
        wait={
          board.questions.length === 0 ? null : (
            <Wait
              order={order(FACTORY_STEP.BUILD)}
              name={`Answer ${count(board.questions.length, "question", "questions")}`}
              line="Agents are stopped until you answer"
            >
              {board.questions.map(questionRow)}
            </Wait>
          )
        }
      />
      <Arrow />
      <Step
        step={FACTORY_STEP.SHIP}
        line={board.shipped.length > 0 ? `${board.shipped.length} just shipped` : undefined}
        rows={board.shipped.map(shippedRow)}
        wait={
          board.merges.length === 0 ? null : (
            <Wait
              order={order(FACTORY_STEP.SHIP)}
              name="Ready to merge"
              line="Not shipped until you merge"
            >
              {board.merges.map(mergeRow)}
            </Wait>
          )
        }
      />
    </div>
  );
}

/** The line under the title: what needs the developer, which leads to the wait to take first, then what is moving. */
function Summary({
  plans,
  board,
}: {
  plans: PlansControl;
  board: FactoryBoard;
}): React.JSX.Element {
  const needs = needsText(board);
  // The summary leads to the wait to take first: the Inbox while a question waits, else the first pull request ready to merge.
  const [firstMerge] = board.merges;
  const takeFirst = () => {
    if (board.questions.length > 0 || firstMerge === undefined) plans.inboxView.onOpen();
    else openMerge(plans, firstMerge);
  };
  const working =
    board.agentsWorking > 0
      ? `${count(board.agentsWorking, "agent", "agents")} working on ${count(board.plansWorking, "plan", "plans")}`
      : undefined;
  return (
    <p className="factory-summary">
      {needs === undefined ? (
        <span>Nothing needs you</span>
      ) : (
        <button type="button" className="factory-needs" onClick={takeFirst}>
          <span className="inbox-row-dot factory-head-dot" aria-hidden="true" />
          {needs}
        </button>
      )}
      {working === undefined ? null : (
        <>
          <span className="factory-sep" aria-hidden="true">
            ·
          </span>
          <span>{working}</span>
        </>
      )}
    </p>
  );
}

/** The window's Factory, in the plan's place: the line as it stands now. */
export function DesktopFactory({ plans }: { plans: PlansControl }): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_FACTORY, plans.factoryView.onClose);
  const openFeedback = useOpenFeedback();
  const now = useMinute();
  const board = useFactoryBoard(plans, now);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useRowSlide(root, board);
  const empty =
    board.planning.length === 0 &&
    board.building.length === 0 &&
    board.questions.length === 0 &&
    board.merges.length === 0 &&
    board.shipped.length === 0;
  return (
    <section className="factory-view" aria-label="Factory" ref={setRoot}>
      <header className="desktop-toolbar">
        <div className="desktop-toolbar-heading">
          <h1 className="desktop-toolbar-title">Factory</h1>
          <span className="integration-tool-badge experiment-badge">Experimental</span>
        </div>
        <div className="desktop-toolbar-actions">
          <button
            type="button"
            className="experiment-feedback"
            onClick={() => openFeedback(EXPERIMENT.FACTORY)}
          >
            Send feedback
          </button>
        </div>
      </header>
      <div className="factory-scroll">
        {empty ? (
          <p className="factory-summary">Nothing is happening right now.</p>
        ) : (
          <Summary plans={plans} board={board} />
        )}
        <Line plans={plans} board={board} now={now} />
        {empty ? (
          <div className="factory-empty">
            <span>Talk an idea through with Luke to start.</span>
            <NewPlanButton plans={plans} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
