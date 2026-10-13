import {
  CODING_AGENT_TODO_STATUS,
  type CodingAgentTodoStatus,
  type CodingAgentTodos,
} from "@sidecar/hosted/coding-agent-wire";
import type { CatalogModel, ModelChoice } from "@sidecar/hosted/models-wire";
import {
  BotIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  CircleStopIcon,
  CodeXmlIcon,
  EyeIcon,
  FilePenIcon,
  FileTextIcon,
  GlobeIcon,
  HourglassIcon,
  InboxIcon,
  ListIcon,
  ListTodoIcon,
  type LucideIcon,
  MessageCircleQuestionIcon,
  MessageCircleXIcon,
  PencilLineIcon,
  PhoneOffIcon,
  PlayIcon,
  SearchIcon,
  SendIcon,
  SquareTerminalIcon,
  TerminalIcon,
  WrenchIcon,
} from "lucide-react";
import { type ComponentProps, Fragment, type ReactNode } from "react";
import type { Components } from "streamdown";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import { Fold, FoldBody, FoldChevron, FoldSummary } from "../ai-elements/fold";
import { MessageResponse, PANEL_MARKDOWN_COMPONENTS } from "../ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "../ai-elements/reasoning";
import { Shimmer } from "../ai-elements/shimmer";
import {
  TOOL_BLOCK,
  TOOL_LINE_CLASS,
  TOOL_STATE,
  Tool,
  type ToolBlock,
  ToolContent,
  ToolHeader,
  type ToolHeaderProps,
  ToolInput,
  ToolLine,
  ToolOutput,
  type ToolState,
  ToolStateMark,
} from "../ai-elements/tool";
import { cn } from "../ai-elements/utils";
import { HarnessMark } from "../provider-marks";
import { useClipped } from "../use-clipped";
import { opensOnGitHub, providerOf } from "./coding-agent-model";
import { ModelLabel } from "./model-label";
import { cardTitle } from "./tool-call-model";
import {
  TRANSCRIPT_CODE_AND_TABLE_COMPONENTS,
  TranscriptMarkdownSource,
} from "./transcript-markdown";
import {
  CALL_KIND,
  CALL_WORDS,
  type CallKind,
  callLine,
  groupSummary,
  TURN_ROW,
  type TurnRow,
} from "./turn-rows";
import { WorkingTime } from "./working-time";

/**
 * transcript-blocks.tsx -- the one way a transcript's blocks are drawn, on the Transcript tab, the Work tab, and a coding agent's tab alike.
 *
 * Each tab decides what its rows say from its own wire
 * (`transcript-model.ts`, `work-model.ts`, `coding-agent-model.ts` with
 * `tool-call-model.ts`); how a block of each kind looks is decided here
 * once, over the AI Elements components (`../ai-elements/`): words as
 * markdown at the panel's scale with a link opening on GitHub, reasoning folded under one quiet line
 * previewing its words, a tool call as one collapsible row wearing its kind's icon and verb
 * (`turn-rows.ts`) that opens onto its input and its answer, a run of
 * calls folded under one line saying how many, a finished turn's lead
 * folded under what it holds, a subagent's row as one line like a call's
 * that opens its tab, an agent's to-do list as a call's row that opens onto
 * the list, and a note between the rows. A
 * tab that drew one of these its own way would be a second transcript
 * style, which is what this file is here to refuse.
 */

/**
 * A link in a transcript's words. A page on GitHub, such as the pull request
 * an agent opened, opens in the browser over the act channel; any other
 * address is drawn as words that go nowhere, with the address as its hint.
 * Note that the press is ours rather than Streamdown's, because Streamdown's
 * link asks in a modal of its own and then calls `window.open`, which the
 * window denies (`hardened-window.ts`), so its link opened nothing.
 */
function TranscriptLink({
  href,
  children,
}: {
  href: string | undefined;
  children: ReactNode;
}): ReactNode {
  const { tell } = useAct();
  if (href === undefined || !opensOnGitHub(href)) {
    return (
      <span className="agent-link-inert" title={href}>
        {children}
      </span>
    );
  }
  return (
    <a
      href={href}
      className="agent-link"
      onClick={(event) => {
        event.preventDefault();
        tell(ACT_KIND.GITHUB_OPEN, { url: href });
      }}
    >
      {children}
    </a>
  );
}

/**
 * How a transcript's markdown is drawn: at the panel's scale, its code and
 * tables as `transcript-markdown.tsx` draws them, its links as
 * {@link TranscriptLink}, but never as an image, because an image is a
 * request to wherever its address points the moment the tab opens, and
 * nothing said on a call or written by a model should make one.
 */
const TRANSCRIPT_COMPONENTS: Components = {
  ...PANEL_MARKDOWN_COMPONENTS,
  ...TRANSCRIPT_CODE_AND_TABLE_COMPONENTS,
  a: ({ href, children }) => <TranscriptLink href={href}>{children}</TranscriptLink>,
  img: () => null,
};

/** A turn's words as markdown. */
export function TranscriptWords({ text }: { text: string }): ReactNode {
  return (
    <TranscriptMarkdownSource markdown={text}>
      <MessageResponse mode="static" components={TRANSCRIPT_COMPONENTS}>
        {text}
      </MessageResponse>
    </TranscriptMarkdownSource>
  );
}

/** The blank lines a reasoning may open on, up to the first line with words. */
const LEADING_BLANK_LINES = /^(?:[^\S\n]*\n)+/u;

/**
 * How many characters of a thought its closed line is handed: more than the
 * widest column shows, since the line cuts the rest itself. Note that the
 * words are cut here as well, because a transcript holds hundreds of closed
 * thoughts, and a long first paragraph whole in each line would put back in
 * the page what the fold keeps out of it.
 */
const REASONING_PREVIEW_LENGTH = 400;

/**
 * A model's reasoning, folded under one line until opened, its words as they
 * are but for the blank lines a model leaves around them. Note that only
 * whole blank lines go at the start, because the words keep their line breaks
 * and indents, and a trailing break would draw as an empty line under the last.
 *
 * The closed line previews the thought by its first line of words, as
 * plain words, as a task is named on its card: a model's thought often opens
 * on a bold title of its own, which a preview of every paragraph would run
 * into the sentence after it. Note that the preview keeps to that first line
 * rather than following the newest words while the thought streams, so it
 * stands still once the line fills the row, because a line rewritten word by
 * word draws the eye from the reply it sits in.
 */
export function TranscriptReasoning({ text }: { text: string }): ReactNode {
  return (
    <Reasoning>
      <ReasoningTrigger preview={cardTitle(text).slice(0, REASONING_PREVIEW_LENGTH)} />
      <ReasoningContent>
        <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {text.replace(LEADING_BLANK_LINES, "").trimEnd()}
        </p>
      </ReasoningContent>
    </Reasoning>
  );
}

/** Each kind of call's icon: a verb's own, or, for a call about something the window draws a glyph for, that glyph's likeness: the Code tab's brackets for code shown, the Coding agents glyph's terminal for the agents read. */
const CALL_ICON = {
  [CALL_KIND.COMMAND]: TerminalIcon,
  [CALL_KIND.READ_FILE]: FileTextIcon,
  [CALL_KIND.WRITE_FILE]: FilePenIcon,
  [CALL_KIND.EDIT]: FilePenIcon,
  [CALL_KIND.SEARCH]: SearchIcon,
  [CALL_KIND.WEB_SEARCH]: SearchIcon,
  [CALL_KIND.WEB_PAGE]: GlobeIcon,
  [CALL_KIND.SHOW_CODE]: CodeXmlIcon,
  [CALL_KIND.DRAW_ON_BOARD]: PencilLineIcon,
  [CALL_KIND.LOOK_AT_BOARD]: EyeIcon,
  [CALL_KIND.QUEUE_QUESTION]: MessageCircleQuestionIcon,
  [CALL_KIND.WITHDRAW_QUESTION]: MessageCircleXIcon,
  [CALL_KIND.EDIT_PLAN]: FilePenIcon,
  [CALL_KIND.TODOS]: ListTodoIcon,
  [CALL_KIND.INBOX_POST]: InboxIcon,
  [CALL_KIND.INBOX_CLOSE]: InboxIcon,
  [CALL_KIND.INBOX_READ]: InboxIcon,
  [CALL_KIND.WORKER]: BotIcon,
  [CALL_KIND.WORKER_WAIT]: HourglassIcon,
  [CALL_KIND.WORKER_CANCEL]: CircleStopIcon,
  [CALL_KIND.LIST_AGENTS]: SquareTerminalIcon,
  [CALL_KIND.READ_AGENT]: SquareTerminalIcon,
  [CALL_KIND.MESSAGE_AGENT]: SendIcon,
  [CALL_KIND.START_AGENT]: PlayIcon,
  [CALL_KIND.END_CALL]: PhoneOffIcon,
  [CALL_KIND.OTHER]: WrenchIcon,
} as const satisfies Record<CallKind, LucideIcon>;

export type TranscriptToolProps = Omit<ComponentProps<typeof Tool>, "children"> &
  Pick<ToolHeaderProps, "state" | "subject"> & {
    kind: CallKind;
    /** For a command, the plain words the model said it is for, which the row says in its verb's place; the closed row previews the command's first line after them, and the body holds it whole. */
    description?: string | undefined;
    input: ToolBlock;
    /** Nothing while the call has not answered. */
    output: ToolBlock | undefined;
    errorText: string | undefined;
  };

/**
 * One tool call: its row saying what it did, closed until clicked, and its
 * input and answer under it once opened. A command is the closed row's
 * preview, dropped once the body under it shows the command whole behind
 * its prompt, or by a find, which draws that body hidden; a description
 * stays, since the body does not say it.
 */
export function TranscriptTool({
  state,
  kind,
  subject,
  description,
  input,
  output,
  errorText,
  ...props
}: TranscriptToolProps): ReactNode {
  const Icon = CALL_ICON[kind];
  const line = callLine(kind, subject, description);
  const command = kind === CALL_KIND.COMMAND;
  return (
    <Tool {...props}>
      <ToolHeader
        state={state}
        icon={<Icon aria-hidden="true" />}
        label={line.verb}
        subject={line.subject}
        subjectIsCode={line.code}
        subjectInBody={command && input.kind === TOOL_BLOCK.COMMAND}
      />
      <ToolContent>
        <ToolInput block={input} />
        <ToolOutput block={output} errorText={errorText} />
      </ToolContent>
    </Tool>
  );
}

/**
 * A call whose subject stands in a tab of its own, as a coding agent's start
 * does once the agent began: the call's line as a call's row draws it, its
 * icon, what it did, and where it stands, as the one button that opens that
 * tab rather than folding its input and answer open in place.
 */
export function TranscriptOpeningCall({
  callId,
  kind,
  subject,
  state,
  onOpen,
}: {
  callId: string;
  kind: CallKind;
  subject: string | undefined;
  state: ToolState;
  onOpen: () => void;
}): ReactNode {
  const Icon = CALL_ICON[kind];
  const words = CALL_WORDS[kind];
  return (
    <button
      type="button"
      className={cn(TOOL_LINE_CLASS, "w-full text-left text-[12.5px]")}
      data-call-id={callId}
      onClick={onOpen}
    >
      <ToolLine
        state={state}
        icon={<Icon aria-hidden="true" />}
        label={words.verb}
        subject={subject}
        subjectIsCode={words.code}
      />
    </button>
  );
}

/** How a to-do of each status is drawn: its mark, the mark's colour, how its words are set, and what the mark says aloud. */
const TODO_LOOK = {
  [CODING_AGENT_TODO_STATUS.PENDING]: {
    Icon: CircleIcon,
    mark: "text-muted-foreground",
    words: "",
    label: "Pending",
  },
  [CODING_AGENT_TODO_STATUS.IN_PROGRESS]: {
    Icon: CircleDotIcon,
    mark: "text-luke",
    words: "",
    label: "In progress",
  },
  [CODING_AGENT_TODO_STATUS.DONE]: {
    Icon: CircleCheckIcon,
    mark: "text-muted-foreground",
    words: "text-muted-foreground line-through",
    label: "Done",
  },
} as const satisfies Record<
  CodingAgentTodoStatus,
  { Icon: LucideIcon; mark: string; words: string; label: string }
>;

export type TranscriptTodosProps = Omit<ComponentProps<typeof Tool>, "children"> &
  Pick<ToolHeaderProps, "state" | "subject"> & {
    todos: CodingAgentTodos["todos"];
    errorText: string | undefined;
  };

/** A to-do list's items, each behind the mark of where it stands, a done item struck through. */
function TodoItems({ todos }: { todos: CodingAgentTodos["todos"] }): ReactNode {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 px-3 py-2">
      {todos.map((todo, index) => {
        const look = TODO_LOOK[todo.status];
        return (
          <li key={index} className="flex items-start gap-2" data-todo-status={todo.status}>
            <span className="flex h-[1lh] shrink-0 items-center" role="img" aria-label={look.label}>
              <look.Icon className={cn("size-3.5", look.mark)} aria-hidden="true" />
            </span>
            <span className={cn("min-w-0 [overflow-wrap:anywhere]", look.words)}>
              {todo.content}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One write of an agent's to-do list: a call's row saying how far the list
 * has got, which opens onto the list itself. Whether it starts open is the
 * caller's, since only the newest list is worth reading unasked.
 */
export function TranscriptTodos({
  state,
  subject,
  todos,
  errorText,
  ...props
}: TranscriptTodosProps): ReactNode {
  const words = CALL_WORDS[CALL_KIND.TODOS];
  return (
    <Tool data-todos="" {...props}>
      <ToolHeader
        state={state}
        icon={<ListTodoIcon aria-hidden="true" />}
        label={words.verb}
        subject={subject}
        subjectIsCode={words.code}
      />
      <ToolContent>
        <TodoItems todos={todos} />
        <ToolOutput block={undefined} errorText={errorText} />
      </ToolContent>
    </Tool>
  );
}

/**
 * The list the agent is working through, docked above the composer while
 * it works, as Claude Code keeps its list over the prompt and VS Code's
 * chat over its log: one line saying how far the list has got and the
 * item it is at, which opens onto the whole list. Closed by default, as
 * VS Code's collapses to the item in progress, so it costs the log one
 * line. It is a card on the plan card's look, since it stands outside the
 * log, and it is drawn by the caller only while the list is worked.
 */
export function TranscriptTodosDock({
  todos,
  summary,
  focus,
}: {
  todos: CodingAgentTodos["todos"];
  /** How far the list has got, as the row says it. */
  summary: string;
  /** The item the list is at; none once every item is done. */
  focus: string | undefined;
}): ReactNode {
  return (
    <Fold
      className="overflow-clip rounded-lg border border-border bg-muted text-[12.5px]"
      data-todos-dock=""
      aria-label="To-dos"
    >
      <FoldSummary className="flex h-8 cursor-pointer items-center gap-2 px-3 transition-colors hover:bg-secondary focus-visible:[--focus-ring-offset:calc(var(--focus-ring-width)*-1)]">
        <ListTodoIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="shrink-0 text-muted-foreground">{summary}</span>
        {focus === undefined ? null : <span className="min-w-0 flex-1 truncate">{focus}</span>}
        <FoldChevron className="ml-auto" />
      </FoldSummary>
      <FoldBody className="border-t border-border">
        <TodoItems todos={todos} />
      </FoldBody>
    </Fold>
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
  /** When the subagent began, which a running row counts from beside its working mark; none where unknown or not counted, when the mark stands alone. */
  startedAt?: number | undefined;
  /** Why the call failed, drawn under the row, since a call refused before its worker began leaves no tab to read it in. */
  errorText: string | undefined;
  /** Opens the subagent's tab, or chooses it where it is open; none where the row stands in a tab that opens no tab. */
  onOpen: (() => void) | undefined;
};

/** The subagent's glyph: the mark of the harness its model runs in, read from the model's id as its tab reads it (`SubagentMark`), or the worker's robot where the model is no provider's Luke runs, in the muted ink whether it runs or not, since the row's working mark says which. */
function SubagentGlyph({ pair }: { pair: SubagentPair | undefined }): ReactNode {
  const provider = pair === undefined ? undefined : providerOf(pair.choice.model);
  if (provider === undefined) {
    return <BotIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  }
  return (
    <span
      className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-4"
      data-subagent-harness={provider}
    >
      <HarnessMark provider={provider} />
    </span>
  );
}

/**
 * A subagent's row, on the Work tab and a coding agent's tab alike, running
 * or finished: one line drawn as a call's row is, in its muted ink, wearing
 * the mark of the harness its model runs in (the worker's robot where the
 * model is unknown), the job in the full ink as a call's verb is, fading
 * where the line cuts it, the model and effort it runs on as every pair is
 * drawn (`model-label.tsx`), and the mark a call's
 * row wears for where it stands, with how long it has worked beside the
 * working mark while it runs (`working-time.tsx`). The whole line is
 * the one button that opens the subagent's tab, which is where its steps
 * and its answer are read, so it folds nothing open in place. Where it
 * opens no tab it is the same line, pressed by nothing. A call that failed
 * says why in red under the line, open from the start.
 */
export function TranscriptSubagent({
  callId,
  job,
  pair,
  state,
  startedAt,
  errorText,
  onOpen,
}: TranscriptSubagentProps): ReactNode {
  const [words, clipped] = useClipped();
  const running = state === TOOL_STATE.INPUT_STREAMING || state === TOOL_STATE.INPUT_AVAILABLE;
  const line = (
    <>
      <SubagentGlyph pair={pair} />
      <span
        ref={words}
        className="subagent-job min-w-0 flex-1 text-foreground"
        data-overflow={String(clipped)}
      >
        {job}
      </span>
      {pair === undefined ? null : (
        <span className="shrink-0" data-subagent-pair="">
          <ModelLabel choice={pair.choice} models={pair.models} />
        </span>
      )}
      {running && startedAt !== undefined ? (
        <WorkingTime startedAt={startedAt} className="shrink-0" />
      ) : null}
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
      {/* Note that the reason sits under the job, past the line's 4px padding, glyph, and gap. */}
      <p
        className="m-0 mt-1 ml-7 text-[12.5px] text-danger whitespace-pre-wrap [overflow-wrap:anywhere]"
        role="alert"
      >
        {errorText}
      </p>
    </div>
  );
}

/**
 * A line that folds the rows beneath it: a run of calls, or a finished
 * turn's lead. Note that it stays in the muted ink, summary and all,
 * unlike a call's line, because it counts rows rather than saying what one
 * did, and the rows it opens onto are what a reader scans.
 */
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
