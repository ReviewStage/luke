import { CheckIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";
import { CodeBlock } from "./code-block";
import {
  Fold,
  FoldBody,
  type FoldBodyProps,
  FoldChevron,
  type FoldProps,
  FoldSummary,
  type FoldSummaryProps,
} from "./fold";
import { cn } from "./utils";

/**
 * tool.tsx -- AI Elements' Tool: one tool call as a compact row, with its input and its answer under it once opened.
 *
 * After the AI Elements registry (https://elements.ai-sdk.dev), restyled
 * to Luke's tokens and folded on `fold.tsx`. The row is one line: the
 * chevron, the tool's icon, what the call did in a few words, and where
 * it stands, a spinner while it runs and a quiet check or a red mark once
 * it has ended, each in the same 16px seat so the row never changes shape
 * as the answer lands. The body under it is the call's input and its
 * answer in two mono blocks of bounded height, the answer cut to its first
 * lines with the rest behind Show more. What the words say is the
 * caller's decision (`planning/tool-call-model.ts`); how a block of each
 * kind is drawn is this file's.
 */

/** The states a tool part may stand in, as the AI SDK spells them. */
export const TOOL_STATE = {
  INPUT_STREAMING: "input-streaming",
  INPUT_AVAILABLE: "input-available",
  OUTPUT_AVAILABLE: "output-available",
  OUTPUT_ERROR: "output-error",
} as const;

export type ToolState = (typeof TOOL_STATE)[keyof typeof TOOL_STATE];

/** What each state's mark says to a reader who cannot see it. */
const STATE_LABEL = {
  [TOOL_STATE.INPUT_STREAMING]: "Running",
  [TOOL_STATE.INPUT_AVAILABLE]: "Running",
  [TOOL_STATE.OUTPUT_AVAILABLE]: "Completed",
  [TOOL_STATE.OUTPUT_ERROR]: "Failed",
} as const satisfies Record<ToolState, string>;

/** How a block of the body is drawn: a command behind its prompt, a patch with its lines coloured, words as they are, or JSON. */
export const TOOL_BLOCK = {
  COMMAND: "command",
  PATCH: "patch",
  TEXT: "text",
  JSON: "json",
} as const;

type ToolBlockKind = (typeof TOOL_BLOCK)[keyof typeof TOOL_BLOCK];

export interface ToolBlock {
  readonly kind: ToolBlockKind;
  readonly text: string;
}

/** The kinds of line a patch has, each drawn in its own colour. */
const PATCH_LINE = {
  ADDED: "added",
  REMOVED: "removed",
  MARK: "mark",
  CONTEXT: "context",
} as const;

type PatchLineKind = (typeof PATCH_LINE)[keyof typeof PATCH_LINE];

/** The prompt a command is drawn behind. */
export const COMMAND_PROMPT = "$ ";

/** How many lines of an answer a body shows before the rest waits behind Show more. */
const OUTPUT_PREVIEW_LINES = 40;

/** Which kind of line a patch's line is, by its first characters. */
function patchLineKind(line: string): PatchLineKind {
  if (line.startsWith("+")) return PATCH_LINE.ADDED;
  if (line.startsWith("-")) return PATCH_LINE.REMOVED;
  if (line.startsWith("@@") || line.startsWith("***")) return PATCH_LINE.MARK;
  return PATCH_LINE.CONTEXT;
}

/** A long answer cut to its first lines: what is shown, and how many lines wait behind Show more. */
interface ClippedLines {
  readonly shown: string;
  readonly hiddenLines: number;
}

function clippedLines(text: string, limit: number = OUTPUT_PREVIEW_LINES): ClippedLines {
  const lines = text.split("\n");
  if (lines.length <= limit) return { shown: text, hiddenLines: 0 };
  return { shown: lines.slice(0, limit).join("\n"), hiddenLines: lines.length - limit };
}

const PATCH_LINE_CLASS = {
  [PATCH_LINE.ADDED]: "text-luke",
  [PATCH_LINE.REMOVED]: "text-danger",
  [PATCH_LINE.MARK]: "text-muted-foreground",
  [PATCH_LINE.CONTEXT]: "",
} as const satisfies Record<PatchLineKind, string>;

export type ToolProps = FoldProps;

export function Tool({ className, children, ...props }: ToolProps): ReactNode {
  return (
    <Fold className={cn("text-[12.5px]", className)} {...props}>
      {children}
    </Fold>
  );
}

/** Where the call stands, in a 16px seat of its own: a spinner, a quiet check, or a red mark. */
function ToolStateMark({ state }: { state: ToolState }): ReactNode {
  return (
    <span
      className="flex size-4 shrink-0 items-center justify-center"
      data-tool-state={state}
      role="img"
      aria-label={STATE_LABEL[state]}
    >
      {state === TOOL_STATE.OUTPUT_AVAILABLE ? (
        <CheckIcon className="size-4 text-muted-foreground" aria-hidden="true" />
      ) : state === TOOL_STATE.OUTPUT_ERROR ? (
        <XIcon className="size-4 text-danger" aria-hidden="true" />
      ) : (
        <LoaderCircleIcon
          className="size-4 animate-spin text-muted-foreground [animation-play-state:var(--loop-motion)]"
          aria-hidden="true"
        />
      )}
    </span>
  );
}

export type ToolHeaderProps = Omit<FoldSummaryProps, "children"> & {
  state: ToolState;
  /** The tool's icon, drawn at 16px. */
  icon: ReactNode;
  /** The verb before the subject; none for a command, which is its own line. */
  label: string | undefined;
  /** What the call was done to; none for a call that has no one input a reader looks for first. */
  subject: string | undefined;
  /** Whether the subject is code (a command, a path), set in mono, rather than words. */
  subjectIsCode?: boolean;
};

/** The one line a call shows: what it did, and where it stands. */
export function ToolHeader({
  state,
  icon,
  label,
  subject,
  subjectIsCode = true,
  className,
  ...props
}: ToolHeaderProps): ReactNode {
  return (
    <FoldSummary
      className={cn(
        "flex h-7 items-center gap-2 rounded-md px-1 transition-colors hover:bg-secondary",
        className,
      )}
      {...props}
    >
      <FoldChevron />
      <span
        className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-4"
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {label === undefined ? null : <span className="text-muted-foreground">{label} </span>}
        {subject === undefined ? null : (
          <span className={subjectIsCode ? "font-mono text-[11.5px]" : undefined}>{subject}</span>
        )}
      </span>
      <ToolStateMark state={state} />
    </FoldSummary>
  );
}

export type ToolContentProps = FoldBodyProps;

/** The body under an open row: a card holding the blocks, a hairline between them. */
export function ToolContent({ className, children, ...props }: ToolContentProps): ReactNode {
  return (
    <FoldBody
      className={cn(
        "mt-1 mb-1 ml-6 overflow-hidden rounded-lg border border-border bg-muted [&>*+*]:border-t [&>*+*]:border-border",
        className,
      )}
      {...props}
    >
      {children}
    </FoldBody>
  );
}

/** A block's words drawn by its kind. */
function BlockWords({ block }: { block: ToolBlock }): ReactNode {
  switch (block.kind) {
    case TOOL_BLOCK.COMMAND:
      return (
        <>
          <span className="text-muted-foreground select-none">{COMMAND_PROMPT}</span>
          {block.text}
        </>
      );
    case TOOL_BLOCK.PATCH:
      return block.text.split("\n").map((line, index) => (
        <span key={index} className={cn("block", PATCH_LINE_CLASS[patchLineKind(line)])}>
          {line}
        </span>
      ));
    case TOOL_BLOCK.TEXT:
    case TOOL_BLOCK.JSON:
      return block.text;
  }
}

export type ToolInputProps = ComponentProps<"div"> & {
  block: ToolBlock;
};

/** What the call was given. */
export function ToolInput({ block, className, ...props }: ToolInputProps): ReactNode {
  return (
    <div className={className} data-tool-input="" {...props}>
      <CodeBlock>
        <BlockWords block={block} />
      </CodeBlock>
    </div>
  );
}

export type ToolOutputProps = ComponentProps<"div"> & {
  /** Nothing while the call has not answered. */
  block: ToolBlock | undefined;
  errorText: string | undefined;
};

/** What the call answered, cut to its first lines, or the error it ended in; nothing while it has answered neither. */
export function ToolOutput({ block, errorText, className, ...props }: ToolOutputProps): ReactNode {
  const [whole, setWhole] = useState(false);
  if (block === undefined && errorText === undefined) return null;
  if (errorText !== undefined) {
    return (
      <div className={className} data-tool-output="" {...props}>
        <p
          className="m-0 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-danger whitespace-pre-wrap [overflow-wrap:anywhere]"
          role="alert"
        >
          {errorText}
        </p>
      </div>
    );
  }
  if (block === undefined) return null;
  const clipped = whole ? { shown: block.text, hiddenLines: 0 } : clippedLines(block.text);
  return (
    <div className={className} data-tool-output="" {...props}>
      <CodeBlock>
        <BlockWords block={{ kind: block.kind, text: clipped.shown }} />
      </CodeBlock>
      {clipped.hiddenLines > 0 ? (
        <button
          type="button"
          className="block w-full border-t border-border bg-transparent px-3 py-1.5 text-left text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setWhole(true)}
        >
          Show more ({clipped.hiddenLines} more lines)
        </button>
      ) : null}
    </div>
  );
}
