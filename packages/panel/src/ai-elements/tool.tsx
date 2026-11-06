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
} from "@repo/ui";
import { UNREPORTED } from "@repo/ui/reported-failure";
import type { ReactNode } from "react";
import { copyThroughShell } from "../copy-feedback.js";
import { GLYPH_STATE, StateGlyph, stateEndMark } from "../state-glyph.js";
import { Fold, type FoldProps } from "./fold.js";

export const TOOL_STATE = {
  INPUT_STREAMING: "input-streaming",
  INPUT_AVAILABLE: "input-available",
  OUTPUT_AVAILABLE: "output-available",
  OUTPUT_ERROR: "output-error",
} as const;

export type ToolState = (typeof TOOL_STATE)[keyof typeof TOOL_STATE];

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

const COMMAND_PROMPT = "$ ";

const BLOCK_TITLE = {
  INPUT: "Input",
  OUTPUT: "Output",
  TERMINAL: "Terminal",
} as const;

const NO_OUTPUT = "No output";

const NONE = "(none)";

const ACKNOWLEDGMENTS: ReadonlySet<unknown> = new Set(["accepted", "Done.", "done", "ok"]);

const ACKNOWLEDGING_KEYS: ReadonlySet<string> = new Set(["ok", "success"]);

export function blockSays(block: ToolBlock, subject: string | undefined): boolean {
  if (subject === undefined || subject === "") return false;
  if (block.text === subject) return true;
  return block.kind === TOOL_BLOCK.JSON && block.text.includes(`: ${JSON.stringify(subject)}`);
}

function patchRow(line: string): CodeRow {
  if (line.startsWith("+")) return CODE_ROW.ADDED;
  if (line.startsWith("-")) return CODE_ROW.REMOVED;
  return CODE_ROW.CONTEXT;
}

const FOLD_HINT = {
  SHOW: "Show the call",
  HIDE: "Hide the call",
} as const;

const TOOL_LABEL_CLASS = "tool-label min-w-0 overflow-hidden whitespace-nowrap text-foreground";

const TOOL_BODY_CLASS = "tool-body my-tight-gap mr-0 ml-transcript-gutter";

export type ToolProps = Omit<FoldProps, "className">;

export function Tool({ children, ...props }: ToolProps): ReactNode {
  return (
    <Fold className="tool text-caption-inline" {...props}>
      {children}
    </Fold>
  );
}

export function ToolStateMark({ state }: { state: ToolState }): ReactNode {
  if (state === TOOL_STATE.OUTPUT_AVAILABLE) return null;
  if (state === TOOL_STATE.OUTPUT_ERROR) return stateEndMark(GLYPH_STATE.FAILED, false);
  return <StateGlyph state={GLYPH_STATE.WORKING} />;
}

export interface ToolHeaderProps {
  state: ToolState;
  icon: ReactNode;
  label: string | undefined;
  subject: string | undefined;
  chip?: ReactNode | undefined;
  subjectIsCode?: boolean;
  subjectInBody?: boolean;
  place?: ReactNode | undefined;
}

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
  const failed = state === TOOL_STATE.OUTPUT_ERROR;
  return (
    <>
      <GlyphSlot>{icon}</GlyphSlot>
      <span className="flex min-w-0 flex-1 items-baseline gap-tight-gap">
        {label === undefined ? null : (
          <OneLine
            className={chip === undefined ? TOOL_LABEL_CLASS : `${TOOL_LABEL_CLASS} shrink-0`}
          >
            {trailing ? `${label} ` : label.replace(/:$/u, "")}
          </OneLine>
        )}
        {failed ? (
          <span className="flex flex-none self-center">
            <ToolStateMark state={state} />
          </span>
        ) : null}
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
      {failed ? null : <ToolStateMark state={state} />}
    </>
  );
}

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

export function ToolContent({
  name,
  bare = false,
  children,
}: {
  name?: string | undefined;
  bare?: boolean;
  children: ReactNode;
}): ReactNode {
  if (bare) {
    return (
      <DisclosureBody inset={DISCLOSURE_BODY.NONE}>
        <div className={cn(TOOL_BODY_CLASS, "flex flex-col gap-tight-gap", name)} data-bare="">
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
      code={isCommand ? `${COMMAND_PROMPT}${block.text}` : block.text}
      copied={block.text === "" ? undefined : block.text}
      rows={block.kind === TOOL_BLOCK.PATCH ? block.text.split("\n").map(patchRow) : undefined}
      data={{ [data]: "" }}
      copy={copyThroughShell}
    />
  );
}

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

function leafWords(value: unknown, indent: string): string {
  if (isContainer(value)) return NONE;
  return String(value).replaceAll("\n", `\n${indent}  `);
}

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

function acknowledges(block: ToolBlock): boolean {
  if (block.kind !== TOOL_BLOCK.JSON) return false;
  const value = blockValue(block);
  if (!isContainer(value) || Array.isArray(value)) return ACKNOWLEDGMENTS.has(value);
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(
      ([key, item]) => ACKNOWLEDGMENTS.has(item) || (item === true && ACKNOWLEDGING_KEYS.has(key)),
    )
  );
}

function shownOutput(block: ToolBlock): ToolBlock | undefined {
  return acknowledges(block) ? undefined : readableBlock(block);
}

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

export function ToolInput({ block }: { block: ToolBlock }): ReactNode {
  const readable = readableBlock(block);
  if (readable.text === "") return null;
  return <BlockCard block={readable} title={BLOCK_TITLE.INPUT} data="data-tool-input" />;
}

export interface ToolOutputProps {
  block: ToolBlock | undefined;
  errorText: string | undefined;
}

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
  input: ToolBlock;
}

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
