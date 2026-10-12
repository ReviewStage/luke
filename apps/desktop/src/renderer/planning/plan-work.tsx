import type { CatalogModel } from "@sidecar/hosted/models-wire";
import {
  PLAN_WORK_STATE,
  type PlanWorkState,
  type PlanWorkTurn,
} from "@sidecar/hosted/planning-view";
import { MESSAGE_ROLE } from "@sidecar/wire";
import { BotIcon } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Checkpoint } from "../ai-elements/checkpoint";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "../ai-elements/conversation";
import { Message, MessageContent } from "../ai-elements/message";
import { Plan, PlanContent, PlanHeader, PlanTitle } from "../ai-elements/plan";
import { Shimmer } from "../ai-elements/shimmer";
import { TOOL_BLOCK, TOOL_STATE, type ToolState } from "../ai-elements/tool";
import { RetryRowLabel } from "../retry-button";
import { BusyLabel } from "../spinner";
import { WorkingMark } from "../working-mark";
import {
  TranscriptNote,
  TranscriptOpeningCall,
  TranscriptReasoning,
  TranscriptRows,
  TranscriptSubagent,
  TranscriptTool,
  TranscriptWords,
} from "./transcript-blocks";
import { callHeading } from "./transcript-model";
import type { TurnRow } from "./turn-rows";
import {
  WORK_BLOCK,
  WORK_EMPTY_LINE,
  type WorkBlock,
  type WorkCallRow,
  type WorkTurnRow,
  type WorkWorkerBlock,
  workerChoice,
  workerJob,
  workRowsOf,
} from "./work-model";
import { WorkedFor, WorkingLine, WorkingTime } from "./working-time";

/**
 * plan-work.tsx -- the open plan's Work tab: what Luke's planning model wrote and ran on the plan's calls, turn by turn, read the way an agent's own transcript reads.
 *
 * Each turn opens at a Checkpoint saying when it began and how far it got,
 * and its rows are `work-model.ts`'s, drawn as one of Luke's turns by the
 * blocks every transcript shares (`transcript-blocks.tsx`): the model's
 * words as a reply, its reasoning folded behind one line, each call a row
 * wearing its kind's icon that opens onto its input and output, and the
 * runs of calls and a finished turn's lead folded as an agent's are, and
 * each worker the subagent's row an agent's delegation is too, one button
 * that opens its session in a tab of the panel's own (`SubagentTab`), or
 * chooses that tab where it is open. The
 * tab draws the session as an agent's tab draws its transcript: the task a
 * card at the top that opens onto the whole message the subagent was
 * handed, a shimmering line at the end while the subagent runs, a quiet one
 * where it was stopped, and follows it while the subagent runs. The tab
 * holds the plan's newest turns first, and the turns before them are read a
 * page at a time as the developer scrolls up to the oldest (`EarlierWork`).
 * Everything here is the planning model's or the developer's repository's,
 * a command's output included, so the root is left out of the screen
 * recording (`ph-no-capture`) as a second line behind its text masking.
 */

/** What a turn's state says beside its time. */
const TURN_STATE_WORD = {
  [PLAN_WORK_STATE.RUNNING]: "Working",
  [PLAN_WORK_STATE.DONE]: "Done",
  [PLAN_WORK_STATE.FAILED]: "Stopped",
} as const;

/** A call's state as the Tool row marks it, in the AI SDK's words: running only while it still moves. */
function toolStateOf(call: WorkCallRow): ToolState {
  if (call.running) return TOOL_STATE.INPUT_AVAILABLE;
  return call.state === PLAN_WORK_STATE.FAILED
    ? TOOL_STATE.OUTPUT_ERROR
    : TOOL_STATE.OUTPUT_AVAILABLE;
}

/** Opens a coding agent's tab, by the agent, which a start's row reaches through this rather than through every row above it; none where the rows stand in a tab that opens no agent. */
const OpenAgentContext = createContext<((agentId: string) => void) | undefined>(undefined);

/**
 * A call's row, opening onto its input and what it answered, each as the
 * words the frame carried; a coding agent's start, once the agent began,
 * the one button that opens the agent's tab, as a subagent's row opens its.
 */
function WorkCall({ call }: { call: WorkCallRow }): React.JSX.Element {
  const openAgent = useContext(OpenAgentContext);
  const failed = call.state === PLAN_WORK_STATE.FAILED;
  const { agent } = call;
  if (agent !== undefined && openAgent !== undefined) {
    return (
      <TranscriptOpeningCall
        callId={call.id}
        kind={call.kind}
        subject={call.subject}
        state={toolStateOf(call)}
        onOpen={() => openAgent(agent)}
      />
    );
  }
  return (
    <TranscriptTool
      data-call-id={call.id}
      kind={call.kind}
      subject={call.subject}
      state={toolStateOf(call)}
      input={call.input}
      output={
        call.output === undefined || failed
          ? undefined
          : { kind: TOOL_BLOCK.TEXT, text: call.output }
      }
      errorText={failed ? call.output : undefined}
    />
  );
}

/**
 * Opens a subagent's session in a tab of the panel's own, by the call that
 * started it, which a line deep in the tree reaches through this rather
 * than through every row above it. Nothing outside the Work tab, since a
 * subagent's own session starts no subagent of its own.
 */
const OpenSubagentContext = createContext<(callId: string) => void>(() => undefined);

/** Whether a running subagent's row counts how long it has worked: while the Work tab is on screen, as its running turn counts. */
const CountingContext = createContext(false);

/** The catalog a subagent's row names its model from; empty before the first read lands. */
const ModelsContext = createContext<readonly CatalogModel[]>([]);

/** A subagent's call as the one button every subagent's row is, which opens its tab, counting while it runs from when its task began. */
function WorkerLine({ worker }: { worker: WorkWorkerBlock }): React.JSX.Element {
  const open = useContext(OpenSubagentContext);
  const counting = useContext(CountingContext);
  const models = useContext(ModelsContext);
  const { call, session } = worker;
  const choice = workerChoice(worker);
  return (
    <TranscriptSubagent
      callId={call.id}
      job={workerJob(call)}
      pair={choice === undefined ? undefined : { choice, models }}
      state={toolStateOf(call)}
      startedAt={counting ? session?.startedAt : undefined}
      errorText={undefined}
      onOpen={() => open(call.id)}
    />
  );
}

/** A subagent's session's rows, drawn as a turn's are, or the note standing in their place. */
function SubagentRows({ worker }: { worker: WorkWorkerBlock }): React.JSX.Element {
  const { call, session } = worker;
  return (
    <>
      {session?.earlierOmitted ? (
        <TranscriptNote>Earlier steps are not shown.</TranscriptNote>
      ) : null}
      {session === undefined || session.rows.length === 0 ? (
        <TranscriptNote>
          {call.running ? (
            <span role="status" className="inline-flex">
              <WorkingMark label="Starting" />
            </span>
          ) : (
            "Nothing recorded."
          )}
        </TranscriptNote>
      ) : (
        <WorkTurnRows rows={session.rows} />
      )}
    </>
  );
}

/** The word before a subagent's task card's title. */
const TASK_CARD_LABEL = "Task";

/** What stands at the end of a subagent's session where it was stopped; one that runs ends on the working line. */
const SUBAGENT_END_LINE = {
  [PLAN_WORK_STATE.RUNNING]: undefined,
  [PLAN_WORK_STATE.DONE]: undefined,
  [PLAN_WORK_STATE.FAILED]: "Stopped",
} as const satisfies Record<PlanWorkState, string | undefined>;

/**
 * A subagent's session in a tab of the panel's own, drawn as an agent's
 * tab draws its transcript: the task it was handed as a card at the top,
 * its job on the card's line and the whole message once opened, scrolling
 * with the rest; its blocks as the Work tab draws them; and at
 * the end a shimmering line while it runs, counting from when its task
 * began, or once it has finished a quiet line saying how long it worked
 * and when it ended, and one saying so where it was stopped. The tab's own
 * label names the task, so no head repeats it. The
 * worker is read from the plan's work on every frame, so the tab follows
 * the session while the subagent runs, and the log keeps to its newest
 * line as every transcript does.
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
  const job = workerJob(call);
  const ended = call.running ? undefined : SUBAGENT_END_LINE[call.state];
  const worked =
    call.running || session?.startedAt === undefined || session.endedAt === undefined
      ? undefined
      : { startedAt: session.startedAt, endedAt: session.endedAt };
  return (
    <div className="plan-work ph-no-capture">
      <Conversation>
        {/* The card stands off the tab row by the gap between a column's groups, as an agent's plan does. */}
        <ConversationContent className="pt-(--section-gap)">
          <Plan data-task-card="" aria-label={TASK_CARD_LABEL}>
            <PlanHeader>
              <BotIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <PlanTitle label={TASK_CARD_LABEL}>{job}</PlanTitle>
            </PlanHeader>
            <PlanContent>
              <TranscriptWords text={task} />
            </PlanContent>
          </Plan>
          <SubagentRows worker={worker} />
          {call.running ? <WorkingLine startedAt={shown ? session?.startedAt : undefined} /> : null}
          {worked === undefined ? null : (
            <WorkedFor {...worked} record={session?.record} models={models} />
          )}
          {ended === undefined ? null : (
            <p className="agent-end-line" data-ended="" aria-live="polite">
              {ended}
            </p>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </div>
  );
}

/** One block of a turn. */
function WorkBlockView({ block }: { block: WorkBlock }): React.JSX.Element {
  switch (block.kind) {
    case WORK_BLOCK.TEXT:
      return <TranscriptWords text={block.text} />;
    case WORK_BLOCK.REASONING:
      return <TranscriptReasoning text={block.text} />;
    case WORK_BLOCK.CALL:
      return <WorkCall call={block.call} />;
    case WORK_BLOCK.WORKER:
      return <WorkerLine worker={block} />;
  }
}

/** A turn's rows as one of Luke's turns, drawn as the Transcript tab draws his words. */
function WorkTurnRows({ rows }: { rows: readonly TurnRow<WorkBlock>[] }): React.JSX.Element {
  return (
    <Message from={MESSAGE_ROLE.ASSISTANT}>
      <MessageContent>
        <TranscriptRows rows={rows}>{(block) => <WorkBlockView block={block} />}</TranscriptRows>
      </MessageContent>
    </Message>
  );
}

/**
 * A turn's state at the right of its checkpoint, a light sweeping it while
 * the turn works and how long it has worked beside it while the tab is on
 * screen.
 */
function TurnState({
  state,
  startedAt,
  counting,
}: {
  state: PlanWorkState;
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
      ) : (
        TURN_STATE_WORD[state]
      )}
    </span>
  );
}

/** One turn: the checkpoint saying when it began and how far it got, then its blocks, and once it ended how long it worked. */
function WorkTurn({
  turn,
  now,
  counting,
}: {
  turn: WorkTurnRow;
  now: number;
  counting: boolean;
}): React.JSX.Element {
  const models = useContext(ModelsContext);
  return (
    <>
      <Checkpoint
        trailing={<TurnState state={turn.state} startedAt={turn.startedAt} counting={counting} />}
      >
        {callHeading(turn.startedAt, now)}
      </Checkpoint>
      {turn.earlierOmitted ? <TranscriptNote>Earlier steps are not shown.</TranscriptNote> : null}
      <WorkTurnRows rows={turn.rows} />
      {turn.state === PLAN_WORK_STATE.RUNNING || turn.endedAt === undefined ? null : (
        <WorkedFor
          startedAt={turn.startedAt}
          endedAt={turn.endedAt}
          record={turn.record}
          models={models}
          harnessed={false}
        />
      )}
    </>
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

export function PlanWork({
  turns,
  callLive,
  earlier,
  onLoadEarlier,
  onOpenSubagent,
  onOpenAgent,
  shown,
  models,
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
}): React.JSX.Element {
  const rows = workRowsOf(turns, callLive);
  const now = Date.now();
  return (
    <section className="plan-work ph-no-capture" aria-label="Work">
      <OpenSubagentContext.Provider value={onOpenSubagent}>
        <ModelsContext.Provider value={models ?? []}>
          <OpenAgentContext.Provider value={onOpenAgent}>
            <CountingContext.Provider value={shown}>
              {rows.length === 0 && earlier === undefined ? (
                <ConversationEmptyState>
                  <p className="m-0">{WORK_EMPTY_LINE}</p>
                </ConversationEmptyState>
              ) : (
                <Conversation>
                  {/* No top padding, because a sticky checkpoint would leave what scrolled under it showing in that band. */}
                  <ConversationContent className="pt-0">
                    {/* Drawn afresh for each page, which is how a read that did not land is told apart. */}
                    {earlier === undefined ? null : (
                      <EarlierWork key={earlier} onLoad={onLoadEarlier} />
                    )}
                    {rows.map((turn) => (
                      <WorkTurn key={turn.key} turn={turn} now={now} counting={shown} />
                    ))}
                  </ConversationContent>
                  <ConversationScrollButton />
                </Conversation>
              )}
            </CountingContext.Provider>
          </OpenAgentContext.Provider>
        </ModelsContext.Provider>
      </OpenSubagentContext.Provider>
    </section>
  );
}
