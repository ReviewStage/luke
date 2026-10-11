import {
  PLAN_WORK_STATE,
  type PlanWorkState,
  type PlanWorkTurn,
} from "@sidecar/hosted/planning-view";
import { MESSAGE_ROLE } from "@sidecar/wire";
import { BotIcon } from "lucide-react";
import { createContext, useContext } from "react";
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
import { TOOL_BLOCK, TOOL_STATE, type ToolState, ToolStateMark } from "../ai-elements/tool";
import { cn } from "../ai-elements/utils";
import {
  TranscriptNote,
  TranscriptReasoning,
  TranscriptRows,
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
  workerJob,
  workRowsOf,
} from "./work-model";

/**
 * plan-work.tsx -- the open plan's Work tab: what Luke's planning model wrote and ran on the plan's calls, turn by turn, read the way an agent's own transcript reads.
 *
 * Each turn opens at a Checkpoint saying when it began and how far it got,
 * and its rows are `work-model.ts`'s, drawn as one of Luke's turns by the
 * blocks every transcript shares (`transcript-blocks.tsx`): the model's
 * words as a reply, its reasoning folded behind one line, each call a row
 * wearing its kind's icon that opens onto its input and output, and the
 * runs of calls and a finished turn's lead folded as an agent's are. What
 * is this tab's own is the worker, a boxed line wearing the mark a call's
 * row wears for where it stands, which opens its session in a tab of the
 * panel's own (`SubagentTab`), or chooses that tab where it is open. The
 * tab draws the session as an agent's tab draws its transcript: the task a
 * card at the top that opens onto the whole message the subagent was
 * handed, a shimmering line at the end while the subagent runs, a quiet one
 * where it was stopped, and follows it while the subagent runs. Everything
 * here is the planning model's or the developer's repository's, a command's
 * output included, so the root is left out of the screen recording
 * (`ph-no-capture`) as a second line behind its text masking.
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

/** A call's row, opening onto its input and what it answered, each as the words the frame carried. */
function WorkCall({ call }: { call: WorkCallRow }): React.JSX.Element {
  const failed = call.state === PLAN_WORK_STATE.FAILED;
  return (
    <TranscriptTool
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

/**
 * A subagent's call as one boxed line: its job, cut to the line, and the
 * mark a call's row wears for where it stands. The whole line is the one
 * button that opens its tab, so it carries no link of its own.
 */
function WorkerLine({ call }: { call: WorkCallRow }): React.JSX.Element {
  const open = useContext(OpenSubagentContext);
  return (
    <button
      type="button"
      className="work-worker-line ai-trigger flex w-full min-w-0 items-center gap-2"
      onClick={() => open(call.id)}
    >
      <BotIcon className={cn("size-3.5 shrink-0", call.running && "text-luke")} />
      <span className="min-w-0 flex-1 truncate text-foreground">{workerJob(call)}</span>
      <ToolStateMark state={toolStateOf(call)} />
    </button>
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
        <TranscriptNote>{call.running ? "Starting…" : "Nothing recorded."}</TranscriptNote>
      ) : (
        <WorkTurnRows rows={session.rows} />
      )}
    </>
  );
}

/** The word before a subagent's task card's title. */
const TASK_CARD_LABEL = "Task";

/** What stands at the end of a subagent's session while it runs, and where it was stopped. */
const SUBAGENT_END_LINE = {
  [PLAN_WORK_STATE.RUNNING]: "Working…",
  [PLAN_WORK_STATE.DONE]: undefined,
  [PLAN_WORK_STATE.FAILED]: "Stopped",
} as const satisfies Record<PlanWorkState, string | undefined>;

/**
 * A subagent's session in a tab of the panel's own, drawn as an agent's
 * tab draws its transcript: the task it was handed as a card at the top,
 * its job on the card's line and the whole message once opened, scrolling
 * with the rest; its blocks as the Work tab draws them; and at
 * the end a shimmering line while it runs, or a quiet one where it was
 * stopped. The tab's own label names the task, so no head repeats it. The
 * worker is read from the plan's work on every frame, so the tab follows
 * the session while the subagent runs, and the log keeps to its newest
 * line as every transcript does.
 */
export function SubagentTab({ worker }: { worker: WorkWorkerBlock }): React.JSX.Element {
  const { call, task } = worker;
  const job = workerJob(call);
  const ended = call.running ? undefined : SUBAGENT_END_LINE[call.state];
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
          {call.running ? (
            <p className="m-0 text-[12.5px]" data-working="" aria-live="polite">
              <Shimmer>{SUBAGENT_END_LINE[PLAN_WORK_STATE.RUNNING]}</Shimmer>
            </p>
          ) : null}
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
      return <WorkerLine call={block.call} />;
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

/** A turn's state at the right of its checkpoint, a light sweeping it while the turn works. */
function TurnState({ state }: { state: PlanWorkState }): React.JSX.Element {
  return (
    <span data-state={state}>
      {state === PLAN_WORK_STATE.RUNNING ? (
        <Shimmer>{TURN_STATE_WORD[state]}</Shimmer>
      ) : (
        TURN_STATE_WORD[state]
      )}
    </span>
  );
}

/** One turn: the checkpoint saying when it began and how far it got, then its blocks. */
function WorkTurn({ turn, now }: { turn: WorkTurnRow; now: number }): React.JSX.Element {
  return (
    <>
      <Checkpoint trailing={<TurnState state={turn.state} />}>
        {callHeading(turn.startedAt, now)}
      </Checkpoint>
      {turn.earlierOmitted ? <TranscriptNote>Earlier steps are not shown.</TranscriptNote> : null}
      <WorkTurnRows rows={turn.rows} />
    </>
  );
}

export function PlanWork({
  turns,
  callLive,
  onOpenSubagent,
}: {
  turns: readonly PlanWorkTurn[] | undefined;
  callLive: boolean;
  /** Opens a subagent's session in a tab of the panel's own, or chooses the tab open on it, by the call that started it. */
  onOpenSubagent: (callId: string) => void;
}): React.JSX.Element {
  const rows = workRowsOf(turns, callLive);
  const now = Date.now();
  return (
    <section className="plan-work ph-no-capture" aria-label="Work">
      <OpenSubagentContext.Provider value={onOpenSubagent}>
        {rows.length === 0 ? (
          <ConversationEmptyState>
            <p className="m-0">{WORK_EMPTY_LINE}</p>
          </ConversationEmptyState>
        ) : (
          <Conversation>
            {/* No top padding, because a sticky checkpoint would leave what scrolled under it showing in that band. */}
            <ConversationContent className="pt-0">
              {rows.map((turn) => (
                <WorkTurn key={turn.key} turn={turn} now={now} />
              ))}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        )}
      </OpenSubagentContext.Provider>
    </section>
  );
}
