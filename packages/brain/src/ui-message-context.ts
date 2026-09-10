import { UI_MESSAGE_ITEM_FORMAT } from "@sidecar/runtime";
import {
  type CheckpointFormat,
  type ContextAssembly,
  type ContextBootstrap,
  type ContextEngine,
  type ContextMark,
  checkpointFormatTag,
  type RuntimeCheckpoint,
  sameCheckpointFormat,
} from "@sidecar/runtime/vocabulary";
import {
  type CompactionMetadata,
  isStoredToolPart,
  MESSAGE_ROLE,
  type StoredToolPart,
  TOOL_PART_STATE,
} from "@sidecar/session";
import { readStoredUIMessages, type StoredUIMessage } from "@sidecar/session/ui-messages";
import {
  isWireString,
  SCHEMA_REFUSAL,
  type SchemaPath,
  type SchemaRead,
  type SchemaRefusal,
  type UnparsedWireValue,
  type WireRecord,
  wireRecord,
} from "@sidecar/wire";
import {
  convertToModelMessages,
  isReasoningUIPart,
  isTextUIPart,
  type ModelMessage,
  type ProviderMetadata,
  type ToolSet,
  type UIDataTypes,
  type UIMessagePart,
  type UITools,
} from "ai";

/**
 * The model's input derived from the conversation's stored rows. Under the
 * storage plan a conversation is its `UIMessage` rows and nothing else: there
 * is no checkpoint beside them, a compaction is an assistant message whose
 * metadata names the first row it kept, and the input one inference is shown
 * is the AI SDK's `convertToModelMessages` over the rows from the latest
 * compaction on. The same derivation seeds a fresh runtime session from the
 * record and decides what is shown and counted, so it is a pure function
 * here and the engine below is one caller of it.
 *
 * Two rules stand between the rows and the model. Provider metadata a part
 * carries for replay — a reasoning part's opaque item above all, and the item
 * ids on a text or a tool call — is replayed whole when it names the
 * provider this inference runs on and the row's turn ran on its model, and
 * dropped whole otherwise, the summary and the call staying as the record's
 * words; a provider or model change therefore drops every opaque item cleanly
 * rather than handing the model half of one. And a call the record left
 * unanswered — a writer that died between the call and its result — is
 * answered with the lost-result record before conversion, so the model is
 * never handed a dangling call and never replays the action. The SDK keeps
 * reasoning beside the calls it preceded and each call beside its result by
 * construction: an assistant row's parts convert in order, split at each
 * `step-start` into one assistant message followed by the tool message that
 * answers its calls.
 */

/**
 * One row as the derivation reads it: the stored message, and the model its
 * turn ran on when the turn recorded one (`turns.model`, joined by the row's
 * turn). Without the model, no replay metadata on the row can be proven
 * current, and none is replayed.
 */
export interface ContextRow {
  readonly message: StoredUIMessage;
  readonly model?: string;
}

/** The inference the derived input is bound for: whose provider metadata may replay, on which model. */
export interface ReplayTarget {
  readonly provider: string;
  readonly model: string;
}

export interface ModelInputOptions {
  /** The registered tools, by the name a part spells; the SDK renders each result under its tool's declaration. */
  readonly tools: ToolSet;
  readonly replay: ReplayTarget;
  /** What a call the record left unanswered is answered with. */
  readonly lostResultJson: string;
}

function compactionOf(row: ContextRow): CompactionMetadata | undefined {
  return row.message.role === MESSAGE_ROLE.ASSISTANT ? row.message.metadata.compaction : undefined;
}

interface CompactionCut {
  readonly compaction: ContextRow;
  /** The compaction row's index. */
  readonly at: number;
  /** Where the kept tail begins: the row the compaction named as first kept, or the row after the compaction when the set does not hold it. */
  readonly from: number;
}

/** Where the latest compaction, by written order, cuts the rows; nothing when no row is one. */
function compactionCut(rows: readonly ContextRow[]): CompactionCut | undefined {
  const at = rows.findLastIndex((row) => compactionOf(row) !== undefined);
  const compaction = rows[at];
  if (at < 0 || compaction === undefined) return undefined;
  const firstKeptId = compactionOf(compaction)?.first_kept_message_id;
  const firstKept = rows.findIndex((row) => row.message.id === firstKeptId);
  return { compaction, at, from: firstKept < 0 ? at + 1 : firstKept };
}

/**
 * The rows still worth holding, in the order they were written: the latest
 * compaction message and every row from the one it named as first kept.
 * Written order is kept on purpose, because the latest compaction is the
 * last one written, and a kept tail may hold an earlier compaction of its
 * own; reordering here would let that earlier one read as the latest on the
 * next cut.
 */
export function retainedRows(rows: readonly ContextRow[]): readonly ContextRow[] {
  const cut = compactionCut(rows);
  if (!cut) return rows;
  return rows.filter((_row, index) => index === cut.at || index >= cut.from);
}

/**
 * The rows the model reads, in the order it reads them. The latest
 * compaction message stands in for every row before the one it named as
 * first kept, so it comes first, then every row from the first kept one on
 * in written order. A marker naming a row the set does not hold keeps what
 * follows the compaction; no compaction keeps everything. The same rows in,
 * retained or not, give the same derivation out.
 */
export function rowsSinceCompaction(rows: readonly ContextRow[]): readonly ContextRow[] {
  const cut = compactionCut(rows);
  if (!cut) return rows;
  return [cut.compaction, ...rows.slice(cut.from).filter((row) => row !== cut.compaction)];
}

/** Whether metadata a part carries for replay may travel: it names this inference's provider, and the row's turn ran on its model. */
function replayable(
  metadata: ProviderMetadata | undefined,
  row: ContextRow,
  replay: ReplayTarget,
): boolean {
  return (
    metadata !== undefined && Object.hasOwn(metadata, replay.provider) && row.model === replay.model
  );
}

type StoredPart = UIMessagePart<UIDataTypes, UITools>;

type SettledToolPart = Extract<
  StoredToolPart,
  { state: typeof TOOL_PART_STATE.OUTPUT_AVAILABLE | typeof TOOL_PART_STATE.OUTPUT_ERROR }
>;

/** Whether the record holds the call's answer: an unanswered call, or an answer still preliminary, is one the writer never finished. */
function isSettled(part: StoredToolPart): part is SettledToolPart {
  switch (part.state) {
    case TOOL_PART_STATE.OUTPUT_ERROR:
      return true;
    case TOOL_PART_STATE.OUTPUT_AVAILABLE:
      return part.preliminary !== true;
    case TOOL_PART_STATE.INPUT_STREAMING:
    case TOOL_PART_STATE.INPUT_AVAILABLE:
      return false;
  }
}

/** The tool part as the model reads it: settled, and carrying its replay metadata whole or not at all. */
function preparedToolPart(
  part: StoredToolPart,
  row: ContextRow,
  options: ModelInputOptions,
): SettledToolPart {
  const replayed = replayable(part.callProviderMetadata, row, options.replay);
  const call = {
    type: part.type,
    toolCallId: part.toolCallId,
    input: part.input,
    ...(part.providerExecuted !== undefined
      ? { providerExecuted: part.providerExecuted }
      : undefined),
    ...(replayed && part.callProviderMetadata !== undefined
      ? { callProviderMetadata: part.callProviderMetadata }
      : undefined),
  };
  if (!isSettled(part)) {
    return { ...call, state: TOOL_PART_STATE.OUTPUT_ERROR, errorText: options.lostResultJson };
  }
  const result =
    replayed && part.resultProviderMetadata !== undefined
      ? { resultProviderMetadata: part.resultProviderMetadata }
      : undefined;
  return part.state === TOOL_PART_STATE.OUTPUT_ERROR
    ? { ...call, state: part.state, errorText: part.errorText, ...result }
    : { ...call, state: part.state, output: part.output, ...result };
}

function preparedPart(part: StoredPart, row: ContextRow, options: ModelInputOptions): StoredPart {
  if (isReasoningUIPart(part) || isTextUIPart(part)) {
    if (
      part.providerMetadata === undefined ||
      replayable(part.providerMetadata, row, options.replay)
    ) {
      return part;
    }
    const { providerMetadata: _dropped, ...words } = part;
    return words;
  }
  return isStoredToolPart(part) ? preparedToolPart(part, row, options) : part;
}

function preparedMessage(row: ContextRow, options: ModelInputOptions): StoredUIMessage {
  if (row.message.role !== MESSAGE_ROLE.ASSISTANT) return row.message;
  return {
    ...row.message,
    parts: row.message.parts.map((part) => preparedPart(part, row, options)),
  };
}

/** How many calls the rows leave unanswered, each of which the derivation answers with the lost result. */
function unansweredCalls(rows: readonly ContextRow[]): number {
  let count = 0;
  for (const row of rows) {
    for (const part of row.message.parts) {
      if (isStoredToolPart(part) && !isSettled(part)) count += 1;
    }
  }
  return count;
}

/**
 * The input one inference is shown, derived from the rows: the SDK's model
 * messages over the rows since the latest compaction, each prepared under
 * the two rules above.
 */
export function modelInputFrom(
  rows: readonly ContextRow[],
  options: ModelInputOptions,
): Promise<ModelMessage[]> {
  const messages = rowsSinceCompaction(rows).map((row) => preparedMessage(row, options));
  return convertToModelMessages(messages, { tools: options.tools });
}

/** The two fields a row travels under between the store and the engine. */
const ROW_FIELD = { MESSAGE: "message", MODEL: "model" } as const;

function refuse(refusal: SchemaRefusal, path: SchemaPath): SchemaRead<never> {
  return { ok: false, refusal, path };
}

/**
 * Reads rows back from their wire form: each item's message through the
 * session package's reader, which holds it to the vocabulary and to the
 * registered tools, and its model as a non-empty string when it carries one.
 * The refusal names the item and the field, so a store can tell a malformed
 * row from one naming a tool this build no longer registers.
 */
export async function readContextRows(
  items: readonly WireRecord[],
  tools: ToolSet,
): Promise<SchemaRead<ContextRow[]>> {
  const messages: WireRecord[] = [];
  const models: (string | undefined)[] = [];
  for (const [index, item] of items.entries()) {
    const message = wireRecord(item[ROW_FIELD.MESSAGE]);
    if (message === undefined) return refuse(SCHEMA_REFUSAL.MALFORMED, [index, ROW_FIELD.MESSAGE]);
    const model = item[ROW_FIELD.MODEL];
    if (model !== undefined && !(isWireString(model) && model.length > 0)) {
      return refuse(SCHEMA_REFUSAL.MALFORMED, [index, ROW_FIELD.MODEL]);
    }
    messages.push(message);
    models.push(model);
  }
  const read = await readStoredUIMessages(messages, tools);
  if (!read.ok) {
    const [index, ...rest] = read.path;
    return refuse(read.refusal, index === undefined ? [] : [index, ROW_FIELD.MESSAGE, ...rest]);
  }
  return {
    ok: true,
    value: read.value.map((message, index) => {
      const model = models[index];
      return model === undefined ? { message } : { message, model };
    }),
  };
}

function toWireRecord(value: StoredUIMessage | ModelMessage): WireRecord {
  // SAFETY: a stored message is what the store holds as JSON and a model message is what a provider
  // carries as JSON, so a JSON round trip answers the wire shape of either.
  const record = wireRecord(JSON.parse(JSON.stringify(value)) as UnparsedWireValue);
  if (record === undefined) throw new Error("a message serializes as a record");
  return record;
}

function rowToWire(row: ContextRow): WireRecord {
  return {
    [ROW_FIELD.MESSAGE]: toWireRecord(row.message),
    ...(row.model !== undefined ? { [ROW_FIELD.MODEL]: row.model } : undefined),
  };
}

/** What the engine refuses, because it reads rows and writes none. */
export const UI_MESSAGE_ENGINE_REFUSAL = {
  INGEST:
    "the UIMessage engine reads stored rows and writes none: a turn's inputs reach it as rows through bootstrap, never through ingest",
  ADOPT:
    "the UIMessage engine adopts no items: a fork's inherited history and a housekeeping copy are rows the store writes, and the derivation reads them",
  FOREIGN_MARK: "the UIMessage engine rolls back only to a mark it took itself",
} as const;

export interface UIMessageContextEngineOptions {
  /** The runtime the engine's stamp names, as the Responses engine is stamped. */
  readonly runtime: { readonly id: string; readonly version: number };
  readonly tools: ToolSet;
  readonly replay: ReplayTarget;
}

/**
 * The context engine over stored UIMessages: `@sidecar/runtime`'s
 * `BUILTIN_CONTEXT_ENGINE.UI_MESSAGES`. Its retained items are the
 * conversation's rows, each the message and the model its turn ran on, and
 * its assembly is `modelInputFrom` over them. It writes no row: the rows a
 * turn produces are the store writer's, from the run's event stream, so the
 * loop's `ingest` and a provider's compaction window are refused rather than
 * silently dropped, and rows enter at bootstrap alone. Its checkpoint is the
 * rows themselves, handed back as they came, because on this path there is
 * nothing else to persist; a host over this engine keeps rows, not a
 * checkpoint. It is behind `@sidecar/brain/ui-message-context` rather than
 * the barrel because it reaches the AI SDK at run time, which a bundle that
 * only names the engine's id must not resolve.
 */
export class UIMessageContextEngine implements ContextEngine {
  readonly checkpointFormat: CheckpointFormat;
  readonly #options: UIMessageContextEngineOptions;
  #rows: readonly ContextRow[] = [];
  #lostResultJson: string | undefined;
  readonly #marks = new WeakMap<readonly WireRecord[], readonly ContextRow[]>();

  constructor(options: UIMessageContextEngineOptions) {
    this.#options = options;
    this.checkpointFormat = {
      runtime: options.runtime.id,
      runtimeVersion: options.runtime.version,
      format: UI_MESSAGE_ITEM_FORMAT.format,
      formatVersion: UI_MESSAGE_ITEM_FORMAT.version,
    };
  }

  /**
   * An empty checkpoint loads as nothing. A compatible one loads its rows
   * through the vocabulary's reader and counts the calls the derivation will
   * answer with the lost result; the rows themselves are kept as they came,
   * because the record is not repaired by being read. A checkpoint of
   * another stamp, or rows the reader refuses, loads nothing and says why.
   */
  async bootstrap(
    checkpoint: RuntimeCheckpoint | undefined,
    lostResultJson: string,
  ): Promise<ContextBootstrap> {
    this.#lostResultJson = lostResultJson;
    this.#rows = [];
    if (!checkpoint) return { loaded: true, repaired: 0 };
    if (!sameCheckpointFormat(checkpoint.format, this.checkpointFormat)) {
      return {
        loaded: false,
        reason: `checkpoint ${checkpointFormatTag(checkpoint.format)} is not readable by ${checkpointFormatTag(this.checkpointFormat)}`,
        repaired: 0,
      };
    }
    const read = await readContextRows(checkpoint.items, this.#options.tools);
    if (!read.ok) {
      return {
        loaded: false,
        reason: `rows refused: ${read.refusal} at ${read.path.join(".")}`,
        repaired: 0,
      };
    }
    this.#rows = read.value;
    return { loaded: true, repaired: unansweredCalls(read.value) };
  }

  ingest(): void {
    throw new Error(UI_MESSAGE_ENGINE_REFUSAL.INGEST);
  }

  /** The derived input, then the ephemeral text as user messages, so the derived prefix stays cacheable. */
  async assemble(assembly: ContextAssembly): Promise<readonly WireRecord[]> {
    const lostResultJson = this.#lostResultJson;
    // Rows arrive only at bootstrap, where the lost result does too; before it there is nothing to derive.
    const derived: readonly ModelMessage[] =
      lostResultJson === undefined
        ? []
        : await modelInputFrom(this.#rows, {
            tools: this.#options.tools,
            replay: this.#options.replay,
            lostResultJson,
          });
    const ephemeral: readonly ModelMessage[] = assembly.ephemeral.map((content) => ({
      role: MESSAGE_ROLE.USER,
      content,
    }));
    return [...derived, ...ephemeral].map(toWireRecord);
  }

  /** Drops the rows the derivation no longer reads, keeping the rest in written order; answers how many went. */
  compact(): number {
    const kept = retainedRows(this.#rows);
    const dropped = this.#rows.length - kept.length;
    this.#rows = kept;
    return dropped;
  }

  adopt(): void {
    throw new Error(UI_MESSAGE_ENGINE_REFUSAL.ADOPT);
  }

  afterTurn(): void {}

  mark(): ContextMark {
    const items = this.#rows.map(rowToWire);
    this.#marks.set(items, this.#rows);
    return { items };
  }

  rollback(mark: ContextMark): void {
    const rows = this.#marks.get(mark.items);
    if (rows === undefined) throw new Error(UI_MESSAGE_ENGINE_REFUSAL.FOREIGN_MARK);
    this.#rows = rows;
  }

  checkpoint(): RuntimeCheckpoint {
    return { format: this.checkpointFormat, items: this.#rows.map(rowToWire) };
  }

  dispose(): void {
    this.#rows = [];
  }
}
