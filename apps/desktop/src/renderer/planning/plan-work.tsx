import {
  PLAN_WORK_STATE,
  PLAN_WORK_TOOL,
  type PlanWorkState,
  type PlanWorkTool,
  type PlanWorkTurn,
} from "@sidecar/hosted/planning-view";
import { MESSAGE_ROLE } from "@sidecar/wire";
import {
  BotIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleStopIcon,
  EyeIcon,
  FileCodeIcon,
  GlobeIcon,
  HourglassIcon,
  ListIcon,
  MessageCircleQuestionIcon,
  PencilLineIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
} from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import { Checkpoint } from "../ai-elements/checkpoint";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "../ai-elements/conversation";
import { Fold, FoldBody, FoldChevron, FoldSummary } from "../ai-elements/fold";
import { Message, MessageContent } from "../ai-elements/message";
import { Shimmer } from "../ai-elements/shimmer";
import { TOOL_BLOCK, TOOL_STATE, type ToolState } from "../ai-elements/tool";
import { cn } from "../ai-elements/utils";
import {
  TranscriptNote,
  TranscriptReasoning,
  TranscriptTool,
  TranscriptWords,
} from "./transcript-blocks";
import { callHeading } from "./transcript-model";
import {
  openedWorker,
  WORK_BLOCK,
  WORK_EMPTY_LINE,
  type WorkBlock,
  type WorkCallRow,
  type WorkTurnRow,
  workRowsOf,
} from "./work-model";

/**
 * plan-work.tsx -- the open plan's Work tab: what Luke's planning model wrote and ran on the plan's calls, turn by turn, read the way an agent's own transcript reads.
 *
 * Each turn opens at a Checkpoint saying when it began and how far it got,
 * and its rows are `work-model.ts`'s, drawn as one of Luke's turns by the
 * blocks every transcript shares (`transcript-blocks.tsx`): the model's
 * words as a reply, its reasoning folded behind one line, each call a row
 * wearing its tool's icon that opens onto its input and output. What is
 * this tab's own is a run of calls folded under one line saying how many,
 * a finished turn's lead folded under what it holds, and the worker, a
 * boxed line that opens its session in the tab's place. Everything here is
 * the planning model's or the developer's repository's, a command's output
 * included, so the root is left out of the screen recording
 * (`ph-no-capture`) as a second line behind its text masking.
 */

/** What a turn's state says beside its time. */
const TURN_STATE_WORD = {
  [PLAN_WORK_STATE.RUNNING]: "Working",
  [PLAN_WORK_STATE.DONE]: "Done",
  [PLAN_WORK_STATE.FAILED]: "Stopped",
} as const;

/** Each tool's icon. */
const TOOL_ICON = {
  [PLAN_WORK_TOOL.REPOSITORY]: <TerminalIcon />,
  [PLAN_WORK_TOOL.SEARCH_WEB]: <SearchIcon />,
  [PLAN_WORK_TOOL.READ_WEB_PAGE]: <GlobeIcon />,
  [PLAN_WORK_TOOL.SHOW_CODE]: <FileCodeIcon />,
  [PLAN_WORK_TOOL.DRAW_ON_BOARD]: <PencilLineIcon />,
  [PLAN_WORK_TOOL.LOOK_AT_BOARD]: <EyeIcon />,
  [PLAN_WORK_TOOL.QUEUE_QUESTION]: <MessageCircleQuestionIcon />,
  [PLAN_WORK_TOOL.WORKER]: <BotIcon />,
  [PLAN_WORK_TOOL.WORKER_WAIT]: <HourglassIcon />,
  [PLAN_WORK_TOOL.WORKER_CANCEL]: <CircleStopIcon />,
  [PLAN_WORK_TOOL.OTHER]: <WrenchIcon />,
} as const satisfies Record<PlanWorkTool, ReactNode>;

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
      icon={TOOL_ICON[call.tool]}
      label={call.verb}
      subject={call.subject}
      subjectIsCode={call.subjectIsCode}
      state={toolStateOf(call)}
      input={{ kind: TOOL_BLOCK.TEXT, text: call.input }}
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
 * A line that folds what is beneath it: a group of calls, or a finished
 * turn's lead. Note that the group is keyed by whether it opens, by its
 * caller, because the fold reads `defaultOpen` once, and a group that stops
 * being the turn's latest work has to fold.
 */
function WorkFold({
  icon,
  summary,
  running,
  open = false,
  children,
}: {
  icon: ReactNode;
  summary: string;
  running: boolean;
  open?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Fold className="text-[12.5px]" defaultOpen={open}>
      <FoldSummary className="flex h-7 items-center gap-2 rounded-md px-1 text-muted-foreground transition-colors hover:text-foreground">
        <FoldChevron />
        <span
          className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-4"
          aria-hidden="true"
        >
          {icon}
        </span>
        {running ? <Shimmer>{summary}</Shimmer> : <span>{summary}</span>}
      </FoldSummary>
      <FoldBody className="ml-6 flex flex-col gap-1 pt-1">{children}</FoldBody>
    </Fold>
  );
}

/** Opens a subagent's session in the tab's place; a row deep in the tree reaches it through this rather than through every row above it. */
const OpenSubagent = createContext<(callId: string) => void>(() => undefined);

/** What a subagent's line says of how far it got, a light sweeping it while it works. */
function WorkerState({ call }: { call: WorkCallRow }): React.JSX.Element {
  if (call.running) return <Shimmer>Working</Shimmer>;
  return <span>{call.state === PLAN_WORK_STATE.FAILED ? "Stopped" : "Done"}</span>;
}

/** A subagent's call as one boxed line that opens its session: its job, and how far it got. */
function WorkerLine({ call }: { call: WorkCallRow }): React.JSX.Element {
  const open = useContext(OpenSubagent);
  return (
    <button
      type="button"
      className="ai-trigger work-worker-line flex w-full min-w-0 items-center gap-2"
      onClick={() => open(call.id)}
    >
      <BotIcon className={cn("size-3.5 shrink-0", call.running && "text-luke")} />
      <span className="min-w-0 truncate text-foreground">{call.subject ?? call.verb}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <WorkerState call={call} />
        <ChevronRightIcon className="size-3" />
      </span>
    </button>
  );
}

/** A subagent's session in the tab's place: the way back, its job and state, and its blocks, drawn as a turn's are. */
function SubagentSession({
  worker,
  onBack,
}: {
  worker: Extract<WorkBlock, { kind: typeof WORK_BLOCK.WORKER }>;
  onBack: () => void;
}): React.JSX.Element {
  const { call, session } = worker;
  return (
    <Conversation>
      {/* No top padding, so the sticky header covers everything scrolled above it. */}
      <ConversationContent className="pt-0">
        <header className="work-session-header">
          <button type="button" className="ai-trigger flex items-center gap-1" onClick={onBack}>
            <ChevronLeftIcon className="size-3.5" />
            All work
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <BotIcon className={cn("size-3.5 shrink-0", call.running && "text-luke")} />
            <p className="m-0 min-w-0 flex-1 font-semibold text-[12.5px] text-foreground">
              {call.subject ?? call.verb}
            </p>
            <span className="shrink-0 text-muted-foreground text-xs">
              <WorkerState call={call} />
            </span>
          </div>
        </header>
        {session?.earlierOmitted ? (
          <TranscriptNote>Earlier steps are not shown.</TranscriptNote>
        ) : null}
        {session === undefined || session.blocks.length === 0 ? (
          <TranscriptNote>{call.running ? "Starting…" : "Nothing recorded."}</TranscriptNote>
        ) : (
          <WorkTurnBlocks blocks={session.blocks} />
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
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
    case WORK_BLOCK.GROUP:
      return (
        <WorkFold
          key={String(block.open)}
          icon={<WrenchIcon />}
          summary={
            block.calls.length === 1 ? "1 tool called" : `${block.calls.length} tools called`
          }
          running={block.running}
          open={block.open}
        >
          {block.calls.map((call) => (
            <WorkCall key={call.id} call={call} />
          ))}
        </WorkFold>
      );
    case WORK_BLOCK.FOLDED:
      return (
        <WorkFold icon={<ListIcon />} summary={block.summary} running={false}>
          {block.blocks.map((inner) => (
            <WorkBlockView key={inner.key} block={inner} />
          ))}
        </WorkFold>
      );
  }
}

/** A turn's blocks as one of Luke's turns, drawn as the Transcript tab draws his words. */
function WorkTurnBlocks({ blocks }: { blocks: readonly WorkBlock[] }): React.JSX.Element {
  return (
    <Message from={MESSAGE_ROLE.ASSISTANT}>
      <MessageContent>
        {blocks.map((block) => (
          <WorkBlockView key={block.key} block={block} />
        ))}
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
      <WorkTurnBlocks blocks={turn.blocks} />
    </>
  );
}

export function PlanWork({
  turns,
  callLive,
}: {
  turns: readonly PlanWorkTurn[] | undefined;
  callLive: boolean;
}): React.JSX.Element {
  const rows = workRowsOf(turns, callLive);
  const now = Date.now();
  // The subagents opened, outermost first: one opened inside another's session stacks on it.
  const [opened, setOpened] = useState<readonly string[]>([]);
  const worker = openedWorker(rows, opened);
  const open = useCallback((callId: string) => setOpened((held) => [...held, callId]), []);
  if (worker !== undefined) {
    return (
      <section className="plan-work ph-no-capture" aria-label="Work">
        <OpenSubagent.Provider value={open}>
          <SubagentSession worker={worker} onBack={() => setOpened((held) => held.slice(0, -1))} />
        </OpenSubagent.Provider>
      </section>
    );
  }
  return (
    <section className="plan-work ph-no-capture" aria-label="Work">
      <OpenSubagent.Provider value={open}>
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
      </OpenSubagent.Provider>
    </section>
  );
}
