import {
  Badge,
  CARD_CORNER,
  CARD_LOOK,
  CARD_PADDING,
  Card,
  CODE_CARD_TITLE,
  CODE_ROW,
  CodeCard,
  type CodeRow,
  DISCLOSURE_BODY,
  DisclosureBody,
  FailureNote,
  GlyphSlot,
  LineSummary,
  OneLine,
  useDisclosureBodyDrawn,
} from "@luke/ui";
import type { ReactNode } from "react";
import { copyThroughShell } from "../copy-feedback.js";
import { GLYPH_STATE, StateGlyph, stateEndMark } from "../state-glyph.js";
import { Fold, type FoldProps } from "./fold.js";

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
 * it, set in under the words, is the call's input and its answer, each a
 * `CodeCard` headed "Input" and "Answer" with the window's one Copy and its
 * one cut at 40 lines, so a long answer shows its first lines over "Show
 * all", and Copy copies the whole of it either way. What the words say is
 * the caller's decision (`tasks/tool-call-model.ts`); how a block of each
 * kind is drawn is this file's. Its look is `.tool`'s (tasks.css).
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

/** The prompt a command is drawn behind. */
const COMMAND_PROMPT = "$ ";

/** What a block's header says it is. */
const BLOCK_TITLE = {
  INPUT: "Input",
  ANSWER: "Answer",
} as const;

/** What a patch's line does, by its first characters: a line added, one removed, or one that stands. */
function patchRow(line: string): CodeRow {
  if (line.startsWith("+")) return CODE_ROW.ADDED;
  if (line.startsWith("-")) return CODE_ROW.REMOVED;
  return CODE_ROW.CONTEXT;
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
      <GlyphSlot>{icon}</GlyphSlot>
      {/* Note that the label keeps its space, so the line still reads as one sentence to find, copy, and a screen reader, though the flex gap sets it. */}
      <span className="tool-words">
        {label === undefined ? null : (
          <OneLine className={chip === undefined ? "tool-label" : "tool-label tool-label-chipped"}>
            {trailing ? `${label} ` : label}
          </OneLine>
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
      {place === undefined ? null : (
        <span className="tool-place">
          {" "}
          <Badge>{place}</Badge>
        </span>
      )}
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
    <LineSummary>
      <ToolLine
        state={state}
        icon={icon}
        label={label}
        subject={subjectInBody && drawn ? undefined : subject}
        chip={chip}
        subjectIsCode={subjectIsCode}
        place={place}
      />
    </LineSummary>
  );
}

/** The body under an open row: a card holding the blocks, a hairline between them, clipped to its corners, so what is in it rings inside itself. */
export function ToolContent({
  name,
  bare = false,
  children,
}: {
  /** The class its place names what it holds by, beside the body's own. */
  name?: string | undefined;
  /** Whether what it holds are cards of their own (`CodeCard`), which stand one over the next with no frame around them. */
  bare?: boolean;
  children: ReactNode;
}): ReactNode {
  if (bare) {
    return (
      <DisclosureBody inset={DISCLOSURE_BODY.NONE}>
        <div className="tool-body" data-bare="">
          {children}
        </div>
      </DisclosureBody>
    );
  }
  return (
    <DisclosureBody inset={DISCLOSURE_BODY.NONE}>
      <Card
        look={CARD_LOOK.TINT}
        corner={CARD_CORNER.CONTROL}
        padding={CARD_PADDING.FLUSH}
        className={name === undefined ? "tool-body" : `tool-body ${name}`}
      >
        {children}
      </Card>
    </DisclosureBody>
  );
}

/** A block as the card draws it: what its lines are, what Copy copies, and what each line does where it is a patch. */
function BlockCard({
  block,
  title,
  data,
}: {
  block: ToolBlock;
  title: string;
  data: `data-${string}`;
}): ReactNode {
  const isCommand = block.kind === TOOL_BLOCK.COMMAND;
  return (
    <CodeCard
      title={title}
      titleIs={CODE_CARD_TITLE.WORDS}
      // Note that the prompt is drawn but never copied: Copy takes the command alone.
      code={isCommand ? `${COMMAND_PROMPT}${block.text}` : block.text}
      copied={block.text === "" ? undefined : block.text}
      rows={block.kind === TOOL_BLOCK.PATCH ? block.text.split("\n").map(patchRow) : undefined}
      data={{ [data]: "" }}
      copy={copyThroughShell}
    />
  );
}

/** What the call was given. */
export function ToolInput({ block }: { block: ToolBlock }): ReactNode {
  return <BlockCard block={block} title={BLOCK_TITLE.INPUT} data="data-tool-input" />;
}

export interface ToolOutputProps {
  /** Nothing while the call has not answered. */
  block: ToolBlock | undefined;
  errorText: string | undefined;
}

/** What the call answered, cut at 40 lines by its card, or the error it ended in; nothing while it has answered neither. */
export function ToolOutput({ block, errorText }: ToolOutputProps): ReactNode {
  if (errorText !== undefined) {
    return (
      <div data-tool-output="">
        <FailureNote>{errorText}</FailureNote>
      </div>
    );
  }
  if (block === undefined) return null;
  return <BlockCard block={block} title={BLOCK_TITLE.ANSWER} data="data-tool-output" />;
}
