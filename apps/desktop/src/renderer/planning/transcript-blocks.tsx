import type { ModelProvider } from "@sidecar/hosted/models-wire";
import { SidePanelIcon } from "@sidecar/panel";
import {
  BotIcon,
  CircleStopIcon,
  EyeIcon,
  FileCodeIcon,
  FilePenIcon,
  FileTextIcon,
  GlobeIcon,
  HourglassIcon,
  ListIcon,
  type LucideIcon,
  MessageCircleQuestionIcon,
  PencilLineIcon,
  PhoneOffIcon,
  PlayIcon,
  SearchIcon,
  SendIcon,
  TerminalIcon,
  WrenchIcon,
} from "lucide-react";
import { type ComponentProps, Fragment, type ReactNode } from "react";
import type { Components } from "streamdown";
import { Fold, FoldBody, FoldChevron, FoldSummary } from "../ai-elements/fold";
import { MessageResponse, PANEL_MARKDOWN_COMPONENTS } from "../ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "../ai-elements/reasoning";
import { Shimmer } from "../ai-elements/shimmer";
import {
  TOOL_STATE,
  Tool,
  type ToolBlock,
  ToolContent,
  ToolHeader,
  type ToolHeaderProps,
  ToolInput,
  ToolOutput,
  type ToolState,
  ToolStateMark,
} from "../ai-elements/tool";
import { cn } from "../ai-elements/utils";
import { ModelProviderMark } from "../provider-marks";
import { Tooltip } from "../tooltip";
import {
  CALL_KIND,
  CALL_WORDS,
  type CallKind,
  groupSummary,
  TURN_ROW,
  type TurnRow,
} from "./turn-rows";

/**
 * transcript-blocks.tsx -- the one way a transcript's blocks are drawn, on the Transcript tab, the Work tab, and a coding agent's tab alike.
 *
 * Each tab decides what its rows say from its own wire
 * (`transcript-model.ts`, `work-model.ts`, `coding-agent-model.ts` with
 * `tool-call-model.ts`); how a block of each kind looks is decided here
 * once, over the AI Elements components (`../ai-elements/`): words as
 * markdown at the panel's scale, reasoning folded under one quiet line,
 * a tool call as one collapsible row wearing its kind's icon and verb
 * (`turn-rows.ts`) that opens onto its input and its answer, a run of
 * calls folded under one line saying how many, a finished turn's lead
 * folded under what it holds, a subagent's row as the Work tab draws its
 * worker's line, boxed, with the model and effort it runs on and a way
 * into its tab, opening onto its answer, and a note between the rows. A
 * tab that drew one of these its own way would be a second transcript
 * style, which is what this file is here to refuse.
 */

/**
 * How a transcript's markdown is drawn: at the panel's scale, but never
 * as an image, because an image is a request to wherever its address
 * points the moment the tab opens, and nothing said on a call or written
 * by a model should make one.
 */
export const TRANSCRIPT_COMPONENTS: Components = { ...PANEL_MARKDOWN_COMPONENTS, img: () => null };

/** A turn's words as markdown. */
export function TranscriptWords({
  text,
  components = TRANSCRIPT_COMPONENTS,
}: {
  text: string;
  components?: Components;
}): ReactNode {
  return (
    <MessageResponse mode="static" components={components}>
      {text}
    </MessageResponse>
  );
}

/** A model's reasoning, folded under one line until opened, its words as they are. */
export function TranscriptReasoning({ text }: { text: string }): ReactNode {
  return (
    <Reasoning>
      <ReasoningTrigger />
      <ReasoningContent>
        <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</p>
      </ReasoningContent>
    </Reasoning>
  );
}

/** Each kind of call's icon. */
const CALL_ICON = {
  [CALL_KIND.COMMAND]: TerminalIcon,
  [CALL_KIND.READ_FILE]: FileTextIcon,
  [CALL_KIND.WRITE_FILE]: FilePenIcon,
  [CALL_KIND.EDIT]: FilePenIcon,
  [CALL_KIND.SEARCH]: SearchIcon,
  [CALL_KIND.WEB_SEARCH]: SearchIcon,
  [CALL_KIND.WEB_PAGE]: GlobeIcon,
  [CALL_KIND.SHOW_CODE]: FileCodeIcon,
  [CALL_KIND.DRAW_ON_BOARD]: PencilLineIcon,
  [CALL_KIND.LOOK_AT_BOARD]: EyeIcon,
  [CALL_KIND.QUEUE_QUESTION]: MessageCircleQuestionIcon,
  [CALL_KIND.EDIT_PLAN]: FilePenIcon,
  [CALL_KIND.WORKER]: BotIcon,
  [CALL_KIND.WORKER_WAIT]: HourglassIcon,
  [CALL_KIND.WORKER_CANCEL]: CircleStopIcon,
  [CALL_KIND.LIST_AGENTS]: BotIcon,
  [CALL_KIND.READ_AGENT]: BotIcon,
  [CALL_KIND.MESSAGE_AGENT]: SendIcon,
  [CALL_KIND.START_AGENT]: PlayIcon,
  [CALL_KIND.END_CALL]: PhoneOffIcon,
  [CALL_KIND.OTHER]: WrenchIcon,
} as const satisfies Record<CallKind, LucideIcon>;

export type TranscriptToolProps = Omit<ComponentProps<typeof Tool>, "children"> &
  Pick<ToolHeaderProps, "state" | "subject"> & {
    kind: CallKind;
    input: ToolBlock;
    /** Nothing while the call has not answered. */
    output: ToolBlock | undefined;
    errorText: string | undefined;
  };

/** One tool call: its row saying what it did, closed until clicked, and its input and answer under it once opened. */
export function TranscriptTool({
  state,
  kind,
  subject,
  input,
  output,
  errorText,
  ...props
}: TranscriptToolProps): ReactNode {
  const Icon = CALL_ICON[kind];
  const words = CALL_WORDS[kind];
  return (
    <Tool {...props}>
      <ToolHeader
        state={state}
        icon={<Icon aria-hidden="true" />}
        label={words.verb}
        subject={subject}
        subjectIsCode={words.code}
      />
      <ToolContent>
        <ToolInput block={input} />
        <ToolOutput block={output} errorText={errorText} />
      </ToolContent>
    </Tool>
  );
}

/** What a subagent's row says it runs on: the pair as one line, and the mark of the provider whose model it is, where known. */
interface SubagentPair {
  readonly label: string;
  readonly provider: ModelProvider | undefined;
}

/** What a subagent's row says in its body while the worker is still at work; one that ended without an answer says nothing. */
const SUBAGENT_WORKING_LINE = "Working…";

/** The word on the button that opens a subagent's tab, and its label for a reader who cannot see it. */
const OPEN_IN_TAB_LABEL = "Open in tab";

export type TranscriptSubagentProps = Omit<ComponentProps<typeof Tool>, "children"> & {
  /** The task the subagent was handed, cut to the row's line. */
  task: string;
  pair: SubagentPair | undefined;
  state: ToolState;
  /** The worker's answer once it has one. */
  result: string | undefined;
  errorText: string | undefined;
  /** Opens the subagent's session in a tab of the panel's own; none where the row stands in a tab that opens no tab. */
  onOpen: (() => void) | undefined;
};

/**
 * A subagent's call: one boxed row, as the Work tab draws its worker's
 * line, wearing the worker's glyph lit while it runs, the task cut to the
 * line, the model and effort the worker runs on in a muted word behind the
 * provider's mark, and the mark a call's row wears for where it stands;
 * closed until clicked, and open onto the worker's answer. The button at
 * its end opens the worker's tab and leaves the fold as it was, so the row
 * is one line that does two things rather than two rows.
 */
export function TranscriptSubagent({
  task,
  pair,
  state,
  result,
  errorText,
  onOpen,
  className,
  ...props
}: TranscriptSubagentProps): ReactNode {
  const running = state === TOOL_STATE.INPUT_STREAMING || state === TOOL_STATE.INPUT_AVAILABLE;
  return (
    <Tool className={className} data-subagent-row="" {...props}>
      <FoldSummary className="transcript-subagent-line flex min-w-0 items-center gap-2 rounded-lg transition-colors">
        <FoldChevron />
        <BotIcon
          className={cn("size-4 shrink-0", running ? "text-luke" : "text-muted-foreground")}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-foreground">{task}</span>
        {pair === undefined ? null : (
          <span
            className="flex shrink-0 items-center gap-1 text-muted-foreground [&>svg]:size-3"
            data-subagent-pair=""
          >
            {pair.provider === undefined ? null : <ModelProviderMark provider={pair.provider} />}
            <span>{pair.label}</span>
          </span>
        )}
        <ToolStateMark state={state} />
        {onOpen === undefined ? null : (
          <Tooltip label={OPEN_IN_TAB_LABEL}>
            <button
              type="button"
              className="flex size-5 shrink-0 items-center justify-center rounded bg-transparent text-muted-foreground transition-colors hover:text-foreground [&>svg]:size-4"
              aria-label={OPEN_IN_TAB_LABEL}
              onClick={(event) => {
                // The press is the button's, not the line's: the fold stays as it was.
                event.preventDefault();
                event.stopPropagation();
                onOpen();
              }}
            >
              <SidePanelIcon />
            </button>
          </Tooltip>
        )}
      </FoldSummary>
      <FoldBody className="mt-1 mb-1 ml-6 text-[13px] leading-normal" data-subagent-result="">
        {errorText !== undefined ? (
          <p className="m-0 text-danger whitespace-pre-wrap [overflow-wrap:anywhere]" role="alert">
            {errorText}
          </p>
        ) : result !== undefined ? (
          <TranscriptWords text={result} />
        ) : running ? (
          <TranscriptNote>{SUBAGENT_WORKING_LINE}</TranscriptNote>
        ) : null}
      </FoldBody>
    </Tool>
  );
}

/** A line that folds the rows beneath it: a run of calls, or a finished turn's lead. */
function TurnFold({
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
}): ReactNode {
  return (
    <Fold className="text-[12.5px]" defaultOpen={open} data-turn-fold="">
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

/** One row of a turn: a block drawn by its tab, a run of calls, or a folded lead. */
function TurnRowView<B>({
  row,
  children,
}: {
  row: TurnRow<B>;
  children: (block: B) => ReactNode;
}): ReactNode {
  switch (row.kind) {
    case TURN_ROW.BLOCK:
      return children(row.block);
    case TURN_ROW.GROUP:
      return (
        <TurnFold
          icon={<WrenchIcon />}
          summary={groupSummary(row.blocks.length)}
          running={row.running}
          open={row.open}
        >
          {row.blocks.map((block, index) => (
            <Fragment key={index}>{children(block)}</Fragment>
          ))}
        </TurnFold>
      );
    case TURN_ROW.FOLDED:
      return (
        <TurnFold icon={<ListIcon />} summary={row.summary} running={false}>
          <TranscriptRows rows={row.rows}>{children}</TranscriptRows>
        </TurnFold>
      );
  }
}

/** A turn's rows (`turn-rows.ts`): each block drawn by its tab, a run of calls and a folded lead drawn here. */
export function TranscriptRows<B>({
  rows,
  children,
}: {
  rows: readonly TurnRow<B>[];
  /** How the tab draws one of its own blocks. */
  children: (block: B) => ReactNode;
}): ReactNode {
  // Note that a group is keyed by whether it opens, because the fold reads `defaultOpen` once, and a group that stops being the turn's latest work has to fold.
  return rows.map((row) => (
    <TurnRowView
      key={row.kind === TURN_ROW.GROUP ? `${row.key}-${String(row.open)}` : row.key}
      row={row}
    >
      {children}
    </TurnRowView>
  ));
}

/** A quiet note between a transcript's rows: what was left out, or what stands in a row's place. */
export function TranscriptNote({ className, ...props }: ComponentProps<"p">): ReactNode {
  return <p className={cn("m-0 text-[11.5px] text-muted-foreground", className)} {...props} />;
}
