import type { CatalogModel, ModelChoice } from "@sidecar/hosted/models-wire";
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
import { Fold, FoldBody, FoldSummary } from "../ai-elements/fold";
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
import { useClipped } from "../use-clipped";
import { ModelLabel } from "./model-label";
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
 * folded under what it holds, a subagent's row as one boxed line that
 * opens its tab, and a note between the rows. A
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

/** What a subagent's row says it runs on: the model and effort, and the catalog the model is named from. */
interface SubagentPair {
  readonly choice: ModelChoice;
  readonly models: readonly CatalogModel[];
}

export type TranscriptSubagentProps = {
  /** The call that started the subagent, which the row carries as `data-call-id`. */
  callId: string;
  /** The job the subagent was handed, as its tab names it. */
  job: string;
  /** What it runs on; none where the row knows no pair. */
  pair: SubagentPair | undefined;
  state: ToolState;
  /** Why the call failed, drawn under the row, since a call refused before its worker began leaves no tab to read it in. */
  errorText: string | undefined;
  /** Opens the subagent's tab, or chooses it where it is open; none where the row stands in a tab that opens no tab. */
  onOpen: (() => void) | undefined;
};

/**
 * A subagent's row, on the Work tab and a coding agent's tab alike, running
 * or finished: one boxed line wearing the worker's glyph, lit while it
 * runs, the job, fading where the line cuts it, the model and effort it
 * runs on as every pair is drawn (`model-label.tsx`), and the mark a call's
 * row wears for where it stands. The whole line is the one button that
 * opens the subagent's tab, which is where its steps and its answer are
 * read, so it folds nothing open in place. Where it opens no tab it is the
 * same line, pressed by nothing. A call that failed says why in red under
 * the line, open from the start.
 */
export function TranscriptSubagent({
  callId,
  job,
  pair,
  state,
  errorText,
  onOpen,
}: TranscriptSubagentProps): ReactNode {
  const [words, clipped] = useClipped();
  const running = state === TOOL_STATE.INPUT_STREAMING || state === TOOL_STATE.INPUT_AVAILABLE;
  const line = (
    <>
      <BotIcon
        className={cn("size-4 shrink-0", running ? "text-luke" : "text-muted-foreground")}
        aria-hidden="true"
      />
      <span ref={words} className="subagent-job min-w-0 flex-1" data-overflow={String(clipped)}>
        {job}
      </span>
      {pair === undefined ? null : (
        <span className="shrink-0 text-foreground" data-subagent-pair="">
          <ModelLabel choice={pair.choice} models={pair.models} />
        </span>
      )}
      <ToolStateMark state={state} />
    </>
  );
  const className = "subagent-line flex w-full min-w-0 items-center gap-2";
  const row =
    onOpen === undefined ? (
      <div className={className} data-subagent-row="" data-call-id={callId}>
        {line}
      </div>
    ) : (
      <button
        type="button"
        className={className}
        data-subagent-row=""
        data-call-id={callId}
        onClick={onOpen}
      >
        {line}
      </button>
    );
  if (errorText === undefined) return row;
  return (
    <div>
      {row}
      {/* Note that the reason sits under the job, past the line's 1px border, 10px padding, glyph, and gap. */}
      <p
        className="m-0 mt-1 ml-[35px] text-[12.5px] text-danger whitespace-pre-wrap [overflow-wrap:anywhere]"
        role="alert"
      >
        {errorText}
      </p>
    </div>
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
      <FoldSummary className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
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
