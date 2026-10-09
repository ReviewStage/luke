import * as Collapsible from "@radix-ui/react-collapsible";
import {
  PLAN_WORK_STATE,
  PLAN_WORK_TOOL,
  type PlanWorkState,
  type PlanWorkTool,
  type PlanWorkTurn,
} from "@sidecar/hosted/planning-view";
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
import type { Components } from "streamdown";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "../ai-elements/conversation";
import { MessageResponse } from "../ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "../ai-elements/reasoning";
import { Shimmer } from "../ai-elements/shimmer";
import {
  TOOL_STATE,
  Tool,
  ToolContent,
  ToolHeader,
  type ToolState,
  ToolText,
} from "../ai-elements/tool";
import { cn } from "../ai-elements/utils";
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
 * Each turn opens under the time it began, and its rows are
 * `work-model.ts`'s, drawn with the AI Elements components Stage draws
 * Stagent's turns with: the model's words as a reply, its reasoning folded
 * behind one line, each call a Tool line wearing its tool's icon that opens
 * onto its input and output, and the worker a Task box whose commands hang
 * beneath it. Everything here is the planning model's or the developer's
 * repository's, a command's output included, so the root is left out of the
 * screen recording (`ph-no-capture`) as a second line behind its text
 * masking.
 */

/** How the model's words are drawn: as markdown, but never as an image, which would be a request to wherever it points. */
const WORDS_COMPONENTS: Components = { img: () => null };

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

/** A call's state as the Tool line marks it: running only while it still moves. */
function toolStateOf(call: WorkCallRow): ToolState {
  if (call.running) return TOOL_STATE.RUNNING;
  return call.state === PLAN_WORK_STATE.FAILED ? TOOL_STATE.FAILED : TOOL_STATE.DONE;
}

/** A call's line, opening onto its input and what it answered. */
function WorkCall({ call }: { call: WorkCallRow }): React.JSX.Element {
  const failed = call.state === PLAN_WORK_STATE.FAILED;
  return (
    <Tool>
      <ToolHeader
        icon={TOOL_ICON[call.tool]}
        title={call.verb}
        subject={call.subject}
        subjectIsCode={call.subjectIsCode}
        state={toolStateOf(call)}
      />
      <ToolContent>
        <ToolText label="Input" text={call.input} />
        {call.output === undefined ? null : (
          <ToolText label={failed ? "Error" : "Output"} text={call.output} failed={failed} />
        )}
      </ToolContent>
    </Tool>
  );
}

/**
 * A line that folds what is beneath it: a group of calls, or a finished
 * turn's lead. Note that the group is keyed by whether it opens, by its
 * caller, because Radix reads `defaultOpen` once, and a group that stops
 * being the turn's latest work has to fold.
 */
function Fold({
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
    <Collapsible.Root className="group/fold not-prose w-full" defaultOpen={open}>
      <Collapsible.Trigger className="ai-trigger flex w-full items-center gap-1.5 rounded-md py-0.5">
        <ChevronRightIcon className="size-3 shrink-0 transition-transform group-data-[state=open]/fold:rotate-90" />
        <span className="flex size-3.5 shrink-0 items-center justify-center [&>svg]:size-3.5">
          {icon}
        </span>
        {running ? <Shimmer>{summary}</Shimmer> : <span>{summary}</span>}
      </Collapsible.Trigger>
      <Collapsible.Content className="space-y-1 pt-1 pl-[18px] outline-none">
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
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
        {session?.earlierOmitted ? <p className="work-note">Earlier steps are not shown.</p> : null}
        {session === undefined || session.blocks.length === 0 ? (
          <p className="work-note">{call.running ? "Starting…" : "Nothing recorded."}</p>
        ) : (
          <div className="work-blocks">
            {session.blocks.map((block) => (
              <WorkBlockView key={block.key} block={block} />
            ))}
          </div>
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
      return (
        <MessageResponse
          mode="static"
          components={WORDS_COMPONENTS}
          className="text-[13px] text-foreground leading-relaxed"
        >
          {block.text}
        </MessageResponse>
      );
    case WORK_BLOCK.REASONING:
      return (
        <Reasoning>
          <ReasoningTrigger />
          <ReasoningContent>{block.text}</ReasoningContent>
        </Reasoning>
      );
    case WORK_BLOCK.CALL:
      return <WorkCall call={block.call} />;
    case WORK_BLOCK.WORKER:
      return <WorkerLine call={block.call} />;
    case WORK_BLOCK.GROUP:
      return (
        <Fold
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
        </Fold>
      );
    case WORK_BLOCK.FOLDED:
      return (
        <Fold icon={<ListIcon />} summary={block.summary} running={false}>
          {block.blocks.map((inner) => (
            <WorkBlockView key={inner.key} block={inner} />
          ))}
        </Fold>
      );
  }
}

/** A turn's state beside its time, a light sweeping it while the turn works. */
function TurnState({ state }: { state: PlanWorkState }): React.JSX.Element {
  return (
    <span className="work-turn-state" data-state={state}>
      {state === PLAN_WORK_STATE.RUNNING ? (
        <Shimmer>{TURN_STATE_WORD[state]}</Shimmer>
      ) : (
        TURN_STATE_WORD[state]
      )}
    </span>
  );
}

/** One turn: when it began and how far it got, then its blocks. */
function WorkTurn({ turn, now }: { turn: WorkTurnRow; now: number }): React.JSX.Element {
  return (
    <li className="work-turn">
      <header className="work-turn-header">
        <span>{callHeading(turn.startedAt, now)}</span>
        <TurnState state={turn.state} />
      </header>
      {turn.earlierOmitted ? <p className="work-note">Earlier steps are not shown.</p> : null}
      <div className="work-blocks">
        {turn.blocks.map((block) => (
          <WorkBlockView key={block.key} block={block} />
        ))}
      </div>
    </li>
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
            {/* Note that the scroll box has no top padding, because a sticky turn header
                sticks below it and would leave what scrolled under it showing in that band;
                the list carries the room instead, as the Transcript's does. */}
            <ConversationContent className="pt-0">
              <ol className="work-turns">
                {rows.map((turn) => (
                  <WorkTurn key={turn.key} turn={turn} now={now} />
                ))}
              </ol>
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        )}
      </OpenSubagent.Provider>
    </section>
  );
}
