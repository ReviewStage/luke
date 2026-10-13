import type { TurnRecord } from "@sidecar/hosted/coding-agent-wire";
import type { CatalogModel } from "@sidecar/hosted/models-wire";
import {
  PLAN_WORK_STATE,
  type PlanWorkState,
  type PlanWorkTurn,
} from "@sidecar/hosted/planning-view";
import { WorkIcon } from "@sidecar/panel";
import { Fragment, useEffect, useRef, useState } from "react";
import { Checkpoint } from "../ai-elements/checkpoint";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../ai-elements/conversation";
import { Shimmer } from "../ai-elements/shimmer";
import { EmptyState } from "../empty-state";
import { RetryRowLabel } from "../retry-button";
import { BusyLabel } from "../spinner";
import {
  AgentMessage,
  AgentTranscriptView,
  type DelegationDoors,
  PLANNING_LEAD,
  WORKER_LEAD,
} from "./agent-tab";
import { workerLines } from "./coding-agent-model";
import { REVEAL_MARK, useRevealInLog } from "./reveal-in-log";
import { TranscriptNote } from "./transcript-blocks";
import { callHeading } from "./transcript-model";
import {
  WORK_EMPTY_LINE,
  type WorkTurnRow,
  type WorkWorkerBlock,
  workerJob,
  workFailed,
  workRowsOf,
} from "./work-model";
import { WorkingTime } from "./working-time";

/**
 * plan-work.tsx -- the open plan's Work tab: what Luke's planning model wrote and ran on the plan's calls, turn by turn, drawn with a coding agent's own transcript.
 *
 * Each turn opens at a Checkpoint saying when it began and how far it got,
 * and is then one of Luke's messages, drawn by the agent tab's own
 * component (`AgentMessage`) from the turn as `work-model.ts` reads it into
 * the agent tab's parts: the model's words as a reply, its reasoning folded
 * behind one line, each call a row wearing its kind's icon that opens onto
 * its input and output, the runs of calls and a finished turn's lead folded,
 * a coding agent's start the one button that opens the agent's tab, and
 * each worker the subagent's row an agent's delegation is, one button that
 * opens its session in a tab of the panel's own (`SubagentTab`), or chooses
 * that tab where it is open. That tab is a worker's transcript as an
 * agent's worker's tab draws it (`AgentTranscriptView`): the task a card at
 * the top, a shimmering line at the end while the subagent runs, a quiet one
 * where it stopped or failed, and follows it while the subagent runs. The
 * tab holds the plan's newest turns first, and the turns before them are
 * read a page at a time as the developer scrolls up to the oldest
 * (`EarlierWork`). Everything here is the planning model's or the
 * developer's repository's, a command's output included, so the root is
 * left out of the screen recording (`ph-no-capture`) as a second line
 * behind its text masking.
 */

/** What a turn's state says beside its time. */
const TURN_STATE_WORD = {
  [PLAN_WORK_STATE.RUNNING]: "Working",
  [PLAN_WORK_STATE.DONE]: "Done",
} as const;

/** What a turn or a subagent's session that ended without answering says, by whether it failed (`workFailed`). */
const ENDED_WORD = {
  STOPPED: "Stopped",
  FAILED: "Failed",
} as const;

/** What a subagent's session that ended having recorded nothing says in place of its rows. */
const NOTHING_RECORDED = "Nothing recorded.";

/** What work that ended without answering says it did, as its record says it ended. */
function endedWord(record: TurnRecord | undefined): string {
  return workFailed(record) ? ENDED_WORD.FAILED : ENDED_WORD.STOPPED;
}

/**
 * A subagent's session in a tab of the panel's own, drawn as an agent's
 * worker's tab draws its transcript (`AgentTranscriptView`): the task it was
 * handed as a card at the top, its job on the card's line and the whole
 * message once opened; its session as one of its messages; and at the end a
 * shimmering line while it runs, "Starting…" until its session draws its
 * first part and "Working…" after, counting from when its task began, or
 * once it has finished a quiet line saying how long it worked and when it
 * ended, and one saying so where it stopped or failed, or that it recorded
 * nothing. The tab's own label names the task, so no head repeats it. The
 * worker is read from the plan's work on every frame, so the tab follows
 * the session while the subagent runs.
 */
export function SubagentTab({
  worker,
  shown,
  models,
}: {
  worker: WorkWorkerBlock;
  /** Whether the tab is on screen, which is when a running subagent's line counts how long it has worked. */
  shown: boolean;
  /** The catalog as last read, which names the model its finished line's card says; none before the first read lands. */
  models?: readonly CatalogModel[] | undefined;
}): React.JSX.Element {
  const { call, task, session } = worker;
  const recorded = session !== undefined && session.message.parts.length > 0;
  // A session that ended is drawn even with nothing recorded, so its end still says how long it worked and on what.
  const drawn = recorded || session?.message.finishedAt !== undefined ? session : undefined;
  // A session whose own task failed says so even where the planning model answered its call and went on.
  const ended =
    call.running || (call.state !== PLAN_WORK_STATE.FAILED && !workFailed(session?.record))
      ? undefined
      : endedWord(session?.record);
  return (
    <section className="agent-tab ph-no-capture" aria-label={workerJob(call)}>
      <AgentTranscriptView
        briefTitle={workerJob(call)}
        messages={workerLines(task, drawn === undefined ? [] : [drawn.message])}
        lead={WORKER_LEAD}
        delegation={{ models }}
        reading={false}
        failed={false}
        working={call.running}
        startedAt={shown ? session?.startedAt : undefined}
        ended={ended ?? (call.running || recorded ? undefined : NOTHING_RECORDED)}
        onRetry={() => undefined}
        earlierOmitted={session?.earlierOmitted ?? false}
      />
    </section>
  );
}

/**
 * A turn's state at the right of its checkpoint, a light sweeping it while
 * the turn works and how long it has worked beside it while the tab is on
 * screen.
 */
function TurnState({
  state,
  record,
  startedAt,
  counting,
}: {
  state: PlanWorkState;
  record: TurnRecord;
  startedAt: number;
  counting: boolean;
}): React.JSX.Element {
  return (
    <span data-state={state}>
      {state === PLAN_WORK_STATE.RUNNING ? (
        <>
          <Shimmer>{TURN_STATE_WORD[state]}</Shimmer>
          {counting ? <WorkingTime startedAt={startedAt} /> : null}
        </>
      ) : state === PLAN_WORK_STATE.DONE ? (
        TURN_STATE_WORD[state]
      ) : (
        endedWord(record)
      )}
    </span>
  );
}

/** One turn: the checkpoint saying when it began and how far it got, then the turn as one of Luke's messages, ending once it ended on how long it worked. */
function WorkTurn({
  turn,
  now,
  counting,
  doors,
}: {
  turn: WorkTurnRow;
  now: number;
  counting: boolean;
  doors: DelegationDoors;
}): React.JSX.Element {
  return (
    <>
      <Checkpoint
        trailing={
          <TurnState
            state={turn.state}
            record={turn.record}
            startedAt={turn.startedAt}
            counting={counting}
          />
        }
      >
        {callHeading(turn.startedAt, now)}
      </Checkpoint>
      {turn.earlierOmitted ? <TranscriptNote>Earlier steps are not shown.</TranscriptNote> : null}
      <AgentMessage
        message={turn.message}
        plan={false}
        lead={PLANNING_LEAD}
        moving={turn.moving}
        delegation={doors}
      />
    </>
  );
}

/** When each running worker's task began, by the call that started it, which its row counts from. */
function workerStarts(rows: readonly WorkTurnRow[]): ReadonlyMap<string, number> {
  return new Map(
    rows.flatMap((turn) =>
      turn.workers.flatMap((worker) =>
        worker.session?.startedAt === undefined ? [] : [[worker.call.id, worker.session.startedAt]],
      ),
    ),
  );
}

/** Where the read of the turns before the oldest one drawn stands. */
const EARLIER_READ = {
  IDLE: "idle",
  READING: "reading",
  FAILED: "failed",
} as const;

type EarlierRead = (typeof EARLIER_READ)[keyof typeof EARLIER_READ];

/** What the row before the oldest turn drawn says, by where the read stands; a read out draws the spinner over the row's words. */
const EARLIER_LINE = {
  [EARLIER_READ.IDLE]: "Show earlier work",
  [EARLIER_READ.FAILED]: "Could not read earlier work.",
} as const satisfies Record<Exclude<EarlierRead, typeof EARLIER_READ.READING>, string>;

/**
 * The row standing before the oldest turn drawn while older turns stand:
 * the page before it is read as the row scrolls into view, the way a long
 * transcript reads back, or on its press. The row is drawn afresh for each
 * page, so a read that settles while the same row stands left the same
 * older turns standing and did not land; the row then waits for a press
 * rather than asking again on its own.
 */
function EarlierWork({ onLoad }: { onLoad: () => Promise<void> }): React.JSX.Element {
  const row = useRef<HTMLButtonElement>(null);
  const [read, setRead] = useState<EarlierRead>(EARLIER_READ.IDLE);
  const load = useRef(() => {
    setRead(EARLIER_READ.READING);
    const failed = () => setRead(EARLIER_READ.FAILED);
    onLoad().then(failed, failed);
  });

  useEffect(() => {
    const target = row.current;
    if (target === null || read !== EARLIER_READ.IDLE) return;
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) load.current();
    });
    seen.observe(target);
    return () => seen.disconnect();
  }, [read]);

  return (
    <button
      ref={row}
      type="button"
      className="ai-trigger m-0 text-[11.5px] text-muted-foreground"
      disabled={read === EARLIER_READ.READING}
      onClick={() => load.current()}
    >
      <BusyLabel busy={read === EARLIER_READ.READING} label="Loading earlier work">
        {read === EARLIER_READ.FAILED ? (
          <RetryRowLabel failure={EARLIER_LINE[EARLIER_READ.FAILED]} />
        ) : (
          EARLIER_LINE[EARLIER_READ.IDLE]
        )}
      </BusyLabel>
    </button>
  );
}

/** The turn that was running at `at`: the last to start at or before it, or the first where every turn drawn started after it. */
function turnAt(rows: readonly WorkTurnRow[], at: number): string | undefined {
  return (rows.findLast((row) => row.startedAt <= at) ?? rows[0])?.key;
}

/**
 * Reads older pages of the work while the moment a version's Open asked for
 * is older than every turn drawn and an older page stands, answering whether
 * it is still reading. A page that did not land leaves the page before it
 * where it was, so a read settling with the same page before it is one that
 * failed, and the seeking stops there rather than asking again forever.
 */
function useEarlierUntil(
  at: number | undefined,
  rows: readonly WorkTurnRow[],
  earlier: string | undefined,
  onLoadEarlier: () => Promise<void>,
): boolean {
  const [failedAt, setFailedAt] = useState<string | undefined>(undefined);
  const oldest = rows[0]?.startedAt;
  const seeking =
    at !== undefined &&
    earlier !== undefined &&
    earlier !== failedAt &&
    oldest !== undefined &&
    oldest > at;
  const latest = useRef(onLoadEarlier);
  latest.current = onLoadEarlier;
  useEffect(() => {
    if (!seeking || earlier === undefined) return;
    const settled = () => setFailedAt(earlier);
    latest.current().then(settled, settled);
  }, [seeking, earlier]);
  return seeking;
}

export function PlanWork({
  turns,
  callLive,
  earlier,
  onLoadEarlier,
  onOpenSubagent,
  onOpenAgent,
  shown,
  models,
  reveal,
}: {
  turns: readonly PlanWorkTurn[] | undefined;
  callLive: boolean;
  /** The turn the page before the oldest one drawn is read before; absent where no older turn stands. */
  earlier: string | undefined;
  /** Reads the page before the oldest turn drawn; the view brings it. */
  onLoadEarlier: () => Promise<void>;
  /** Opens a subagent's session in a tab of the panel's own, or chooses the tab open on it, by the call that started it. */
  onOpenSubagent: (callId: string) => void;
  /** Opens a coding agent's tab in the plan's column, by the agent, which a start's row asks for; none where nothing opens one. */
  onOpenAgent?: ((agentId: string) => void) | undefined;
  /** Whether the tab is on screen, which is when a running turn counts how long it has worked. */
  shown: boolean;
  /** The catalog as last read, which names each subagent's model; none before the first read lands. */
  models?: readonly CatalogModel[] | undefined;
  /** The moment whose turn a version's Open asked to bring into view, and the word that it has. */
  reveal?: { readonly at: number; readonly onRevealed: () => void } | undefined;
}): React.JSX.Element {
  const rows = workRowsOf(turns, callLive);
  const now = Date.now();
  const root = useRef<HTMLElement>(null);
  const seeking = useEarlierUntil(reveal?.at, rows, earlier, onLoadEarlier);
  const revealed = reveal === undefined ? undefined : turnAt(rows, reveal.at);
  useRevealInLog(root, turns !== undefined && !seeking, reveal?.onRevealed);
  const doors: DelegationDoors = {
    models,
    // A running worker's row counts how long it has worked while the tab is on screen, as its turn counts.
    starts: shown ? workerStarts(rows) : undefined,
    onOpen: (callId) => onOpenSubagent(callId),
    onOpenAgent,
  };
  return (
    <section ref={root} className="plan-work ph-no-capture" aria-label="Work">
      {rows.length === 0 && earlier === undefined ? (
        <EmptyState icon={<WorkIcon />}>{WORK_EMPTY_LINE}</EmptyState>
      ) : (
        <Conversation>
          {/* No top padding, because a sticky checkpoint would leave what scrolled under it showing in that band. */}
          <ConversationContent className="pt-0">
            {/* Drawn afresh for each page, which is how a read that did not land is told apart. */}
            {earlier === undefined ? null : <EarlierWork key={earlier} onLoad={onLoadEarlier} />}
            {rows.map((turn) => (
              <Fragment key={turn.key}>
                {turn.key === revealed ? <span {...{ [REVEAL_MARK]: "" }} /> : null}
                <WorkTurn turn={turn} now={now} counting={shown} doors={doors} />
              </Fragment>
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}
    </section>
  );
}
