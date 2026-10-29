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
  cn,
  DISCLOSURE_BODY,
  DisclosureBody,
  FAILURE_NOTE_TIME,
  FailureNote,
  GlyphSlot,
  LineSummary,
  NOTE_LINE_LOOK,
  NoteLine,
  OneLine,
  Tooltip,
  useDisclosurePreviewShown,
  useDisclosureState,
} from "@luke/ui";
import { UNREPORTED } from "@luke/ui/reported-failure";
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
 * subject the body says whole, as a command's input is the command and a
 * read's its path, is the closed row's preview, and the open row says its
 * verb alone (`blockSays`), even while a find draws the body hidden. The
 * verb is in the full ink and the icon and the subject in the muted one,
 * so a reader scans what each call did and the subject reads as its
 * preview, fading where the line cuts it rather than ending on an
 * ellipsis. There is no chevron: the icon leads, a hover fill says the
 * line opens, and its hint says what a press does, as a line that opens a
 * tab says what it opens. The body under
 * it, set in under the words, is the call's input and its answer, each a
 * `CodeCard` headed "Input" and "Output" with the window's one Copy and its
 * one cut at 40 lines, so a long answer shows its first lines over "Show
 * all", and Copy copies the whole of it either way; a command is one
 * "Terminal" card instead, its prompt line over what it printed, as a shell
 * shows them. JSON reads as words (`readableBlock`), an answer that only
 * acknowledges is left out, and an empty one says "No output". What the
 * words say is the caller's decision (`tasks/tool-call-model.ts`); how a
 * block of each kind is drawn is this file's. Its look is `.tool`'s
 * (tasks.css).
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
  OUTPUT: "Output",
  TERMINAL: "Terminal",
} as const;

/** What an answer of nothing says in its card's place. */
const NO_OUTPUT = "No output";

/** What an empty list reads as. */
const NONE = "(none)";

/** The words that only acknowledge a call, which tell a reader nothing the row does not. */
const ACKNOWLEDGEMENTS: ReadonlySet<unknown> = new Set(["accepted", "Done.", "done", "ok"]);

/** The keys whose `true` only acknowledges a call, as `{ "ok": true }` does; `true` under any other key is an answer. */
const ACKNOWLEDGING_KEYS: ReadonlySet<string> = new Set(["ok", "success"]);

/**
 * Whether a block says a call's subject whole, so the row previewing it
 * gives way while the body is drawn: a block that is the subject, as a
 * read's input is its path, or JSON holding it as one of its values, as a
 * search's input holds its pattern. Note that words made from the input
 * rather than copied from it, as a page's name is made from its address,
 * are not said by it, so they stay.
 */
export function blockSays(block: ToolBlock, subject: string | undefined): boolean {
  if (subject === undefined || subject === "") return false;
  if (block.text === subject) return true;
  return block.kind === TOOL_BLOCK.JSON && block.text.includes(`: ${JSON.stringify(subject)}`);
}

/** What a patch's line does, by its first characters: a line added, one removed, or one that stands. */
function patchRow(line: string): CodeRow {
  if (line.startsWith("+")) return CODE_ROW.ADDED;
  if (line.startsWith("-")) return CODE_ROW.REMOVED;
  return CODE_ROW.CONTEXT;
}

/** What the hover over a call's folding line says a press does, by whether the fold stands open. */
const FOLD_HINT = {
  SHOW: "Show the call",
  HIDE: "Hide the call",
} as const;

/**
 * The call's label, in the full ink over the line's muted one, cut to the
 * line. Note that a chip after it gives way first (`shrink-0`), since a name
 * cut at its end still reads.
 */
const TOOL_LABEL_CLASS = "tool-label min-w-0 overflow-hidden whitespace-nowrap text-foreground";

/**
 * The body under an open line, set in past its icon to the line's words,
 * where a call's body, a model's reasoning, and a call's pictures stand
 * (`--transcript-gutter`, tasks.css): `@luke/ui`'s tinted card holding what a
 * call sent, a hairline between its blocks, or cards of their own one over
 * the next with no frame around them.
 */
const TOOL_BODY_CLASS = "tool-body my-tight-gap mr-0 ml-transcript-gutter";

export type ToolProps = Omit<FoldProps, "className">;

export function Tool({ children, ...props }: ToolProps): ReactNode {
  return (
    <Fold className="tool text-caption-inline" {...props}>
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
  /** Whether the body says the subject whole, as a command's or a read's does (`blockSays`), so an open row drops it. */
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
      <span className="flex min-w-0 flex-1 items-baseline gap-tight-gap">
        {label === undefined ? null : (
          <OneLine
            className={chip === undefined ? TOOL_LABEL_CLASS : `${TOOL_LABEL_CLASS} shrink-0`}
          >
            {/* Note that a verb drops its colon where nothing follows it, as an open row's whose body says its subject. */}
            {trailing ? `${label} ` : label.replace(/:$/u, "")}
          </OneLine>
        )}
        {chip === undefined ? null : (
          <span className="tool-chip flex min-w-0 max-w-tool-chip flex-initial whitespace-nowrap">
            {chip}
            {subject === undefined ? null : " "}
          </span>
        )}
        {subject === undefined ? null : (
          <span
            className="tool-subject min-w-0 flex-1 overflow-hidden whitespace-nowrap data-code:font-mono data-code:text-caption-inline"
            data-code={subjectIsCode ? "" : undefined}
          >
            {subject}
          </span>
        )}
      </span>
      {place === undefined ? null : (
        <span className="tool-place flex flex-none">
          {" "}
          <Badge>{place}</Badge>
        </span>
      )}
      <ToolStateMark state={state} />
    </>
  );
}

/**
 * A call's folding line, which opens and closes its fold, hanging the hint
 * that says so, as a line that opens a tab hangs what it opens; the caller
 * draws what stands in it, and finds it by the marks it hands.
 */
export function ToolSummary({
  children,
  ...marks
}: {
  children: ReactNode;
  [mark: `data-${string}`]: string | undefined;
}): ReactNode {
  const { open } = useDisclosureState();
  return (
    <Tooltip label={open ? FOLD_HINT.HIDE : FOLD_HINT.SHOW}>
      <LineSummary {...marks}>{children}</LineSummary>
    </Tooltip>
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
  const previewed = useDisclosurePreviewShown(subjectInBody);
  return (
    <ToolSummary>
      <ToolLine
        state={state}
        icon={icon}
        label={label}
        subject={previewed ? subject : undefined}
        chip={chip}
        subjectIsCode={subjectIsCode}
        place={place}
      />
    </ToolSummary>
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
        <div className={`${TOOL_BODY_CLASS} flex flex-col gap-tight-gap`} data-bare="">
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
        className={cn(TOOL_BODY_CLASS, "[&>*+*]:border-t [&>*+*]:border-border", name)}
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

/** A JSON block's value, or its text where it is no JSON, as a string answer is drawn as it is. */
function blockValue(block: ToolBlock): unknown {
  try {
    return JSON.parse(block.text);
  } catch {
    return block.text;
  }
}

function isContainer(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

/** A value that stands on its key's line: a scalar, its later lines set in under the first, or an empty list or record as "(none)". */
function leafWords(value: unknown, indent: string): string {
  if (isContainer(value)) return NONE;
  return String(value).replaceAll("\n", `\n${indent}  `);
}

/** A JSON value as indented `key: value` lines and `- item` lines, with no braces or quotes. */
function readableLines(value: unknown, indent: string): string[] {
  if (Array.isArray(value) && value.length === 0) return [`${indent}${NONE}`];
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const [first = "", ...rest] = readableLines(item, `${indent}  `);
      return [`${indent}- ${first.trimStart()}`, ...rest];
    });
  }
  if (!isContainer(value)) return [`${indent}${leafWords(value, indent)}`];
  return Object.entries(value).flatMap(([key, item]) =>
    isContainer(item) && Object.keys(item).length > 0
      ? [`${indent}${key}:`, ...readableLines(item, `${indent}  `)]
      : [`${indent}${key}: ${leafWords(item, indent)}`],
  );
}

/**
 * A block as a reader reads it: JSON as indented words, a record holding
 * one string as that string, and every other kind as it is. Note that it
 * knows no tool: what one tool's answer means is `tool-call-model.ts`'s.
 */
function readableBlock(block: ToolBlock): ToolBlock {
  if (block.kind !== TOOL_BLOCK.JSON) return block;
  const value = blockValue(block);
  if (!isContainer(value)) return block;
  const [only, ...more] = Object.values(value);
  if (!Array.isArray(value) && typeof only === "string" && more.length === 0) {
    return { kind: TOOL_BLOCK.TEXT, text: only };
  }
  return { kind: TOOL_BLOCK.TEXT, text: readableLines(value, "").join("\n") };
}

/**
 * Whether a JSON answer only acknowledges the call, as "accepted",
 * `{ "status": "accepted" }` or `{ "ok": true }` does. Note that `true`
 * acknowledges only under `ok` or `success`, because `{ "exists": true }`
 * is the call's answer.
 */
function acknowledges(block: ToolBlock): boolean {
  if (block.kind !== TOOL_BLOCK.JSON) return false;
  const value = blockValue(block);
  if (!isContainer(value) || Array.isArray(value)) return ACKNOWLEDGEMENTS.has(value);
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(
      ([key, item]) => ACKNOWLEDGEMENTS.has(item) || (item === true && ACKNOWLEDGING_KEYS.has(key)),
    )
  );
}

/** The block an answer's card draws, read as words; nothing where the answer only acknowledges the call. */
function shownOutput(block: ToolBlock): ToolBlock | undefined {
  return acknowledges(block) ? undefined : readableBlock(block);
}

/**
 * The words a call's body draws, as a find counts them before the body is
 * drawn: a command's line and what it printed, then its error; or the
 * input read as words, then the error or else the answer as its card or
 * its "No output" line says it. Note that it reads each block as the cards
 * below do, so a find counts what a reader sees.
 */
export function bodyWords(
  input: ToolBlock | undefined,
  output: ToolBlock | undefined,
  errorText: string | undefined,
): readonly string[] {
  if (input?.kind === TOOL_BLOCK.COMMAND) {
    const printed = output === undefined ? "" : readableBlock(output).text;
    return [input.text, printed, errorText ?? ""].filter((words) => words !== "");
  }
  const shown = output === undefined ? undefined : shownOutput(output);
  const answer = shown === undefined || shown.text.trim() !== "" ? shown?.text : NO_OUTPUT;
  const inputWords = input === undefined ? "" : readableBlock(input).text;
  return [inputWords, errorText ?? answer ?? ""].filter((words) => words !== "");
}

/** What the call was given, read as words; nothing where it was given nothing. */
export function ToolInput({ block }: { block: ToolBlock }): ReactNode {
  const readable = readableBlock(block);
  if (readable.text === "") return null;
  return <BlockCard block={readable} title={BLOCK_TITLE.INPUT} data="data-tool-input" />;
}

export interface ToolOutputProps {
  /** Nothing while the call has not answered. */
  block: ToolBlock | undefined;
  errorText: string | undefined;
}

/**
 * What the call answered, read as words and cut at 40 lines by its card, or
 * the error it ended in, or a muted line where it answered nothing; nothing
 * while it has answered neither, or where it only acknowledged the call.
 */
export function ToolOutput({ block, errorText }: ToolOutputProps): ReactNode {
  if (errorText !== undefined) {
    return (
      <div data-tool-output="">
        <FailureNote failure={UNREPORTED.TOOL} time={FAILURE_NOTE_TIME.PAST}>
          {errorText}
        </FailureNote>
      </div>
    );
  }
  const readable = block === undefined ? undefined : shownOutput(block);
  if (readable === undefined) return null;
  if (readable.text.trim() === "") {
    return (
      <div data-tool-output="" data-empty="">
        <NoteLine look={NOTE_LINE_LOOK.INSET}>{NO_OUTPUT}</NoteLine>
      </div>
    );
  }
  return <BlockCard block={readable} title={BLOCK_TITLE.OUTPUT} data="data-tool-output" />;
}

export interface ToolTerminalProps extends ToolOutputProps {
  /** The command, a `TOOL_BLOCK.COMMAND` block. */
  input: ToolBlock;
}

/**
 * A command and what it printed as one card, as a shell shows them: the
 * prompt line, then its output, and the error it ended in under the card.
 * Note that Copy takes the command alone, without its prompt or output.
 */
export function ToolTerminal({ input, block, errorText }: ToolTerminalProps): ReactNode {
  const printed = block === undefined ? "" : readableBlock(block).text.trimEnd();
  const prompt = `${COMMAND_PROMPT}${input.text}`;
  return (
    <>
      <CodeCard
        title={BLOCK_TITLE.TERMINAL}
        titleIs={CODE_CARD_TITLE.WORDS}
        code={printed === "" ? prompt : `${prompt}\n${printed}`}
        copied={input.text === "" ? undefined : input.text}
        data={{ "data-tool-terminal": "" }}
        copy={copyThroughShell}
      />
      <ToolOutput block={undefined} errorText={errorText} />
    </>
  );
}
