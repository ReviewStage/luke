import { TextButton, useDisclosureBodyDrawn } from "@luke/ui";
import { type ReactNode, useState } from "react";
import { GLYPH_STATE, StateGlyph, stateEndMark } from "../state-glyph.js";
import { CodeBlock } from "./code-block.js";
import { Fold, FoldBody, type FoldProps, FoldSummary } from "./fold.js";

/**
 * tool.tsx -- AI Elements' Tool: one tool call as a compact row, with its input and its answer under it once opened.
 *
 * After the AI Elements registry (https://elements.ai-sdk.dev), restyled
 * to Luke's tokens and folded on `fold.tsx`. The row is one line, and
 * the whole of it opens the call: the tool's icon, what the call did in
 * a few words, and where it stands, trailing the words so that only their
 * cut moves when the mark goes: the working mark while it runs and the
 * failed mark if it failed, each as an agent's tab draws it
 * (`state-glyph.tsx`); a call that ended well keeps no seat for one. A
 * subject the body says whole, as a command's input is the command, is
 * the closed row's preview, and the open row says its verb alone. The
 * verb is in the full ink and the icon and the subject in the muted one,
 * so a reader scans what each call did and the subject reads as its
 * preview, fading where the line cuts it rather than ending on an
 * ellipsis. There is no chevron: the icon leads, and a hover fill says
 * the line opens. The body under
 * it, set in under the words, is the call's input and its answer in two
 * mono blocks of bounded height, the answer cut to its first lines with
 * the rest behind Show more. What the words say is the caller's decision
 * (`tasks/tool-call-model.ts`); how a block of each kind is drawn is
 * this file's. Its look is `.tool`'s (tasks.css).
 */

/** The states a tool part may stand in, as the AI SDK spells them. */
export const TOOL_STATE = {
  INPUT_STREAMING: "input-streaming",
  INPUT_AVAILABLE: "input-available",
  OUTPUT_AVAILABLE: "output-available",
  OUTPUT_ERROR: "output-error",
} as const;

export type ToolState = (typeof TOOL_STATE)[keyof typeof TOOL_STATE];

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
const COMMAND_PROMPT = "$ ";

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

export type ToolProps = Omit<FoldProps, "className">;

export function Tool({ children, ...props }: ToolProps): ReactNode {
  return (
    <Fold className="tool" {...props}>
      {children}
    </Fold>
  );
}

/**
 * Where the call stands: the working mark while it runs, in the line's
 * muted ink, or the failed mark if it failed, each the one an agent's tab
 * wears and named as it is. A call that ended well draws nothing, no empty
 * seat and no gap beside it, since that is every call's end and a mark on
 * each says nothing. Note that the failed mark gives no hint of its own,
 * because a subagent's row already hangs one over the whole line.
 */
export function ToolStateMark({ state }: { state: ToolState }): ReactNode {
  if (state === TOOL_STATE.OUTPUT_AVAILABLE) return null;
  if (state === TOOL_STATE.OUTPUT_ERROR) return stateEndMark(GLYPH_STATE.FAILED, false);
  return <StateGlyph state={GLYPH_STATE.WORKING} />;
}

export interface ToolHeaderProps {
  state: ToolState;
  /** The tool's icon, drawn at 16px. */
  icon: ReactNode;
  /** What the call did, in the full ink: its verb, or what a described command is for; none for a line that is its subject alone. */
  label: string | undefined;
  /** What the call was done to, in the muted ink after the label; none for a call that has no one input a reader looks for first. */
  subject: string | undefined;
  /** Who the call was about, as a chip after the label and before the subject, as a call about one coding agent names the agent; none for the rest. */
  chip?: ReactNode | undefined;
  /** Whether the subject is code (a command, a path), set in mono, rather than words. */
  subjectIsCode?: boolean;
  /** Whether the body says the subject whole, as a command's does, so an open row drops it. */
  subjectInBody?: boolean;
  /** Where the call ran, as a quiet tag at the line's end, for a call that ran somewhere other than its tab says ("On your Mac", or whose Mac by their disc and name); none for the rest. */
  place?: ReactNode | undefined;
}

/**
 * What a call's line says: its icon, what it did, who it was about where it
 * names someone by their chip, and where it stands. Note that the chip
 * gives way before the label does, since a name cut at its end still reads,
 * and that the subject after it takes only what is left.
 */
export function ToolLine({
  state,
  icon,
  label,
  subject,
  chip,
  subjectIsCode = true,
  place,
}: Pick<
  ToolHeaderProps,
  "state" | "icon" | "label" | "subject" | "chip" | "subjectIsCode" | "place"
>): ReactNode {
  const trailing = subject !== undefined || chip !== undefined;
  return (
    <>
      <span className="tool-icon" aria-hidden="true">
        {icon}
      </span>
      {/* Note that the label keeps its space, so the line still reads as one sentence to find, copy, and a screen reader, though the flex gap sets it. */}
      <span className="tool-words">
        {label === undefined ? null : (
          <span className="tool-label" data-chipped={chip === undefined ? undefined : ""}>
            {trailing ? `${label} ` : label}
          </span>
        )}
        {chip === undefined ? null : (
          <span className="tool-chip">
            {chip}
            {subject === undefined ? null : " "}
          </span>
        )}
        {subject === undefined ? null : (
          <span className="tool-subject" data-code={subjectIsCode ? "" : undefined}>
            {subject}
          </span>
        )}
      </span>
      {place === undefined ? null : <span className="tool-place"> {place}</span>}
      <ToolStateMark state={state} />
    </>
  );
}

/** The one line a call shows: what it did, and where it stands. */
export function ToolHeader({
  state,
  icon,
  label,
  subject,
  chip,
  subjectIsCode = true,
  subjectInBody = false,
  place,
}: ToolHeaderProps): ReactNode {
  const drawn = useDisclosureBodyDrawn();
  return (
    <FoldSummary className="tool-line">
      <ToolLine
        state={state}
        icon={icon}
        label={label}
        subject={subjectInBody && drawn ? undefined : subject}
        chip={chip}
        subjectIsCode={subjectIsCode}
        place={place}
      />
    </FoldSummary>
  );
}

/** The body under an open row: a card holding the blocks, a hairline between them, clipped to its corners, so what is in it rings inside itself. */
export function ToolContent({ children }: { children: ReactNode }): ReactNode {
  return <FoldBody className="tool-body">{children}</FoldBody>;
}

/** A block's words drawn by its kind. */
function BlockWords({ block }: { block: ToolBlock }): ReactNode {
  switch (block.kind) {
    case TOOL_BLOCK.COMMAND:
      return (
        <>
          <span className="tool-prompt">{COMMAND_PROMPT}</span>
          {block.text}
        </>
      );
    case TOOL_BLOCK.PATCH:
      return block.text.split("\n").map((line, index) => (
        <span key={index} className="tool-patch-line" data-line={patchLineKind(line)}>
          {line}
        </span>
      ));
    case TOOL_BLOCK.TEXT:
    case TOOL_BLOCK.JSON:
      return block.text;
  }
}

/** What the call was given. */
export function ToolInput({ block }: { block: ToolBlock }): ReactNode {
  return (
    <div data-tool-input="">
      <CodeBlock>
        <BlockWords block={block} />
      </CodeBlock>
    </div>
  );
}

export interface ToolOutputProps {
  /** Nothing while the call has not answered. */
  block: ToolBlock | undefined;
  errorText: string | undefined;
}

/** What the call answered, cut to its first lines, or the error it ended in; nothing while it has answered neither. */
export function ToolOutput({ block, errorText }: ToolOutputProps): ReactNode {
  const [whole, setWhole] = useState(false);
  if (block === undefined && errorText === undefined) return null;
  if (errorText !== undefined) {
    return (
      <div data-tool-output="">
        <p className="tool-error" role="alert">
          {errorText}
        </p>
      </div>
    );
  }
  if (block === undefined) return null;
  const clipped = whole ? { shown: block.text, hiddenLines: 0 } : clippedLines(block.text);
  return (
    <div data-tool-output="">
      <CodeBlock>
        <BlockWords block={{ kind: block.kind, text: clipped.shown }} />
      </CodeBlock>
      {clipped.hiddenLines > 0 ? (
        <p className="tool-more">
          <TextButton onClick={() => setWhole(true)}>
            Show {clipped.hiddenLines} more {clipped.hiddenLines === 1 ? "line" : "lines"}
          </TextButton>
        </p>
      ) : null}
    </div>
  );
}
