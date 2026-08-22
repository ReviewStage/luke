import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord, oneLine, text, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";

/**
 * The vocabulary of Antigravity's session store, shared by the adapter that
 * observes it and the transcript read that renders it. Antigravity keeps its
 * agent state under `~/.gemini/<profile>/` — one profile per surface: the
 * Agent Manager app's, the IDE's, and the terminal CLI's — and everything
 * this code reads is protocol buffers, because that is what the app writes
 * for itself. Three recordings matter: `agyhub_summaries_proto.pb`, the
 * Agent Manager's own index of every conversation (title, run status,
 * workspace, the steps holding for permission, the agent's latest
 * notification), which only that app writes; `conversations/<id>.db`, a
 * SQLite store whose `steps` table holds each conversation's turns as
 * serialized step messages, which every surface writes; and
 * `annotations/<id>.pbtxt`, the developer's own bookkeeping about one
 * conversation, where a rename lands. Conversations from older builds sit
 * beside them as `<id>.pb` files this build cannot read — they are not
 * plaintext protobuf — and those keep the honest refusal.
 *
 * The field numbers and enum values below are Antigravity's own, read from
 * the schema descriptors its binary embeds (`exa.jetski_cortex_pb`,
 * `exa.cortex_pb`, `gemini_coder`); the names beside them are the schema's
 * own field names. Nothing here guesses at a field a build stopped writing —
 * an absent field is an absent fact.
 */

const GEMINI_DIRECTORY_NAME = ".gemini";

/**
 * One profile per Antigravity surface; each observes independently, and the
 * profile a conversation lives under is what says which app can open it.
 */
export const ANTIGRAVITY_PROFILE = {
  MANAGER: "antigravity",
  IDE: "antigravity-ide",
  CLI: "antigravity-cli",
} as const;

export type AntigravityProfile = (typeof ANTIGRAVITY_PROFILE)[keyof typeof ANTIGRAVITY_PROFILE];

export const ANTIGRAVITY_PROFILE_DIRECTORIES: readonly AntigravityProfile[] =
  Object.values(ANTIGRAVITY_PROFILE);

export const ANTIGRAVITY_SUMMARIES_FILE = "agyhub_summaries_proto.pb";

export const ANTIGRAVITY_CONVERSATIONS_DIRECTORY = "conversations";

export const ANTIGRAVITY_ANNOTATIONS_DIRECTORY = "annotations";

export const ANTIGRAVITY_ANNOTATIONS_EXTENSION = ".pbtxt";

export const ANTIGRAVITY_CONVERSATION_STORE_EXTENSION = ".db";

export function defaultAntigravityHome(): string {
  return path.join(os.homedir(), GEMINI_DIRECTORY_NAME);
}

/**
 * The summaries index is one bounded file the app rewrites in place — tens of
 * kilobytes on a busy machine — so a cap far above that is a corruption guard
 * rather than a budget.
 */
export const ANTIGRAVITY_SUMMARIES_MAXIMUM_BYTES = 8 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Protocol buffer wire reading. The app's schemas are compiled into its own
// binary rather than published, so this is a plain wire-format reader over
// the field numbers named below — no schema, no registry, no dependency. It
// reads the three wire shapes those fields use and refuses whole on anything
// malformed, because half a reading of a binary format is a guess.
// ---------------------------------------------------------------------------

const PROTO_WIRE_TYPE = {
  VARINT: 0,
  FIXED64: 1,
  BYTES: 2,
  FIXED32: 5,
} as const;

/** One decoded field: a varint's number, or a length-delimited field's bytes. */
export interface ProtoField {
  fieldNumber: number;
  varint?: number;
  bytes?: Uint8Array;
}

interface VarintReading {
  value: number;
  next: number;
}

/**
 * A varint, decoded into a JavaScript number. The values this code reads —
 * enum members, step counts, timestamp seconds and nanos — all sit far below
 * 2^53, so number precision is not a constraint any field here can hit.
 */
function readVarint(bytes: Uint8Array, offset: number): VarintReading | undefined {
  let value = 0;
  let multiplier = 1;
  for (let index = 0; index < 10; index += 1) {
    const position = offset + index;
    if (position >= bytes.length) return undefined;
    const byte = bytes[position];
    if (byte === undefined) return undefined;
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return { value, next: position + 1 };
    multiplier *= 128;
  }
  return undefined;
}

/**
 * Every field of one message, in order. Anything malformed — a truncated
 * varint, a length past the end, a wire type this code has no reading for —
 * refuses the whole message rather than returning the fields before the
 * damage.
 */
export function protoFields(bytes: Uint8Array): ProtoField[] | undefined {
  const fields: ProtoField[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const tag = readVarint(bytes, offset);
    if (!tag) return undefined;
    const fieldNumber = Math.floor(tag.value / 8);
    const wireType = tag.value % 8;
    if (fieldNumber < 1) return undefined;
    offset = tag.next;
    if (wireType === PROTO_WIRE_TYPE.VARINT) {
      const varint = readVarint(bytes, offset);
      if (!varint) return undefined;
      fields.push({ fieldNumber, varint: varint.value });
      offset = varint.next;
    } else if (wireType === PROTO_WIRE_TYPE.BYTES) {
      const length = readVarint(bytes, offset);
      if (!length || length.next + length.value > bytes.length) return undefined;
      fields.push({ fieldNumber, bytes: bytes.subarray(length.next, length.next + length.value) });
      offset = length.next + length.value;
    } else if (wireType === PROTO_WIRE_TYPE.FIXED64) {
      if (offset + 8 > bytes.length) return undefined;
      offset += 8;
    } else if (wireType === PROTO_WIRE_TYPE.FIXED32) {
      if (offset + 4 > bytes.length) return undefined;
      offset += 4;
    } else {
      return undefined;
    }
  }
  return fields;
}

function protoBytes(fields: readonly ProtoField[], fieldNumber: number): Uint8Array | undefined {
  return fields.find((field) => field.fieldNumber === fieldNumber && field.bytes !== undefined)
    ?.bytes;
}

function protoBytesList(fields: readonly ProtoField[], fieldNumber: number): readonly Uint8Array[] {
  return fields
    .filter((field) => field.fieldNumber === fieldNumber)
    .map((field) => field.bytes)
    .filter((bytes): bytes is Uint8Array => bytes !== undefined);
}

function protoVarint(fields: readonly ProtoField[], fieldNumber: number): number | undefined {
  return fields.find((field) => field.fieldNumber === fieldNumber && field.varint !== undefined)
    ?.varint;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** A string field's words, or nothing when the bytes are not UTF-8. */
function protoText(fields: readonly ProtoField[], fieldNumber: number): string | undefined {
  const bytes = protoBytes(fields, fieldNumber);
  if (bytes === undefined) return undefined;
  try {
    const words = utf8.decode(bytes);
    return words.length > 0 ? words : undefined;
  } catch {
    return undefined;
  }
}

const TIMESTAMP_FIELD = { SECONDS: 1, NANOS: 2 } as const;

const MILLISECONDS_PER_SECOND = 1_000;
const NANOSECONDS_PER_MILLISECOND = 1_000_000;

/** A `google.protobuf.Timestamp` message field, as epoch milliseconds. */
function protoTimestampMs(fields: readonly ProtoField[], fieldNumber: number): number | undefined {
  const bytes = protoBytes(fields, fieldNumber);
  if (bytes === undefined) return undefined;
  const stamp = protoFields(bytes);
  if (!stamp) return undefined;
  const seconds = protoVarint(stamp, TIMESTAMP_FIELD.SECONDS);
  if (seconds === undefined) return undefined;
  const nanos = protoVarint(stamp, TIMESTAMP_FIELD.NANOS) ?? 0;
  return seconds * MILLISECONDS_PER_SECOND + Math.floor(nanos / NANOSECONDS_PER_MILLISECOND);
}

// ---------------------------------------------------------------------------
// Antigravity's own field numbers and enum values, from its embedded schemas.
// ---------------------------------------------------------------------------

/** `jetbox_summaries_pb.SummariesState`. */
const SUMMARIES_STATE_FIELD = { SUMMARY_ENTRY: 1 } as const;

/** One map entry: the conversation id and its summary. */
const SUMMARY_ENTRY_FIELD = { CONVERSATION_ID: 1, SUMMARY: 2 } as const;

/** `exa.jetski_cortex_pb.CascadeTrajectorySummary`. */
const TRAJECTORY_SUMMARY_FIELD = {
  TITLE: 1,
  LAST_MODIFIED_TIME: 3,
  STATUS: 5,
  CREATED_TIME: 7,
  WAITING_STEPS: 8,
  WORKSPACES: 9,
  LAST_USER_INPUT_TIME: 10,
  LATEST_NOTIFY_USER_STEP: 12,
  ANNOTATIONS: 15,
  KILLED: 23,
} as const;

/** `exa.cortex_pb.CortexWorkspaceMetadata`. */
const WORKSPACE_METADATA_FIELD = { FOLDER_URI: 1, BRANCH: 4 } as const;

/** `exa.jetski_cortex_pb.ConversationAnnotations`. */
const ANNOTATIONS_FIELD = { TITLE: 1, ARCHIVED: 4 } as const;

/** `exa.jetski_cortex_pb.CortexTrajectoryStepWithIndex`. */
const STEP_WITH_INDEX_FIELD = { STEP: 1 } as const;

/** `exa.cortex_pb.CortexTrajectoryMetadata`, as the conversation store keeps it. */
const TRAJECTORY_METADATA_FIELD = { WORKSPACES: 1 } as const;

/** `gemini_coder.Step`, for the payloads this code renders. */
const STEP_FIELD = {
  METADATA: 5,
  USER_INPUT: 19,
  PLANNER_RESPONSE: 20,
  RUN_COMMAND: 28,
  CHECKPOINT: 30,
  TASK_BOUNDARY: 93,
  NOTIFY_USER: 94,
} as const;

/** `exa.cortex_pb.CortexStepCheckpoint`, where the generated title lands. */
const CHECKPOINT_FIELD = { USER_INTENT: 4, CONVERSATION_TITLE: 10 } as const;

/** `exa.cortex_pb.CortexStepUserInput`. */
const USER_INPUT_FIELD = { QUERY: 1, RESPONSE: 2 } as const;

/** `exa.cortex_pb.CortexStepPlannerResponse`. */
const PLANNER_RESPONSE_FIELD = { RESPONSE: 1 } as const;

/** `exa.cortex_pb.CortexStepRunCommand`. */
const RUN_COMMAND_FIELD = { COMMAND_LINE: 23, PROPOSED_COMMAND_LINE: 25 } as const;

/** `exa.cortex_pb.CortexStepNotifyUser`. */
const NOTIFY_USER_FIELD = { CONTENT: 2 } as const;

/** `exa.cortex_pb.CortexStepTaskBoundary`. */
const TASK_BOUNDARY_FIELD = { NAME: 1 } as const;

/** `exa.cortex_pb.CortexStepMetadata`. */
const STEP_METADATA_FIELD = { TOOL_CALL: 4 } as const;

/** `exa.codeium_common_pb.ChatToolCall`: the tool's own name and JSON inputs. */
const TOOL_CALL_FIELD = { NAME: 2, ARGUMENTS: 3 } as const;

/** `exa.cortex_pb.CortexErrorDetails`. */
const ERROR_DETAILS_FIELD = { USER_MESSAGE: 1, SHORT_ERROR: 2 } as const;

/** `exa.cortex_pb.CascadeRunStatus`: whether the agent loop is running. */
export const CASCADE_RUN_STATUS = {
  IDLE: 1,
  RUNNING: 2,
  CANCELING: 3,
  BUSY: 4,
} as const;

/** `exa.cortex_pb.CortexStepStatus`, for the steps this code consults. */
export const CORTEX_STEP_STATUS = {
  PENDING: 1,
  RUNNING: 2,
  DONE: 3,
  ERROR: 7,
  GENERATING: 8,
  WAITING: 9,
  QUEUED: 11,
} as const;

/** `exa.cortex_pb.CortexStepType`, for the steps this code renders. */
export const CORTEX_STEP_TYPE = {
  USER_INPUT: 14,
  PLANNER_RESPONSE: 15,
  RUN_COMMAND: 21,
  CHECKPOINT: 23,
  TASK_BOUNDARY: 81,
  NOTIFY_USER: 82,
} as const;

/**
 * Tool inputs whose value names the work, in the order they read best. The
 * keys are Antigravity's own argument names — it writes tool inputs as JSON
 * under Pascal-case keys — and a URL is deliberately not among them, because
 * a signed URL is a credential and no other adapter sends one anywhere.
 */
export const ANTIGRAVITY_TOOL_INPUT_KEY = [
  "CommandLine",
  "AbsolutePath",
  "Query",
  "Pattern",
] as const;

// ---------------------------------------------------------------------------
// Readings over those fields.
// ---------------------------------------------------------------------------

/** BLOB columns of the conversation store, which the wire vocabulary has no member for. */
export function bytesFromRow(row: WireRecord, key: string): Uint8Array | undefined {
  // SAFETY: node:sqlite surfaces BLOB columns as Uint8Array; instanceof is the validation.
  const value = row[key] as unknown;
  return value instanceof Uint8Array ? value : undefined;
}

/** One conversation as the summaries index describes it. */
export interface AntigravitySessionSummary {
  conversationId: string;
  /** The name the app gave the conversation, or the developer's own rename. */
  title?: string;
  /** A `CASCADE_RUN_STATUS` member, or a value this build does not know. */
  runStatus?: number;
  /** The developer stopped the run outright; the turn is over. */
  killed: boolean;
  /** Filed away in the app; the app's own listing no longer shows it. */
  archived: boolean;
  /** The newest of the summary's own clocks. */
  observedAtMs?: number;
  folderPath?: string;
  branch?: string;
  /** At least one step is holding on a question only the developer can answer. */
  holding: boolean;
  /** The tool the holding step wants to run, named by the app's own record. */
  holdingActivity?: string;
  /** The agent's latest notification to the developer, verbatim. */
  notifyWords?: string;
}

/** A `file://` URI as a local path, or nothing for one this build cannot read. */
function pathFromFileUri(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

function newestOf(...stamps: readonly (number | undefined)[]): number | undefined {
  const known = stamps.filter((stamp): stamp is number => stamp !== undefined);
  return known.length > 0 ? Math.max(...known) : undefined;
}

/**
 * The tool one step names, from the step's own metadata: the tool call's own
 * name, and the input that says what it is about to do — a command's own
 * words for a command, the first named input otherwise.
 */
export function antigravityStepToolCall(
  stepFields: readonly ProtoField[],
  maximumDetailLength: number,
): { name: string; detail?: string } | undefined {
  const metadataBytes = protoBytes(stepFields, STEP_FIELD.METADATA);
  const metadata = metadataBytes ? protoFields(metadataBytes) : undefined;
  const toolCallBytes = metadata ? protoBytes(metadata, STEP_METADATA_FIELD.TOOL_CALL) : undefined;
  const toolCall = toolCallBytes ? protoFields(toolCallBytes) : undefined;
  const name = toolCall ? oneLine(protoText(toolCall, TOOL_CALL_FIELD.NAME), 80) : undefined;
  if (!name) return undefined;
  const detail =
    antigravityCommandLine(stepFields, maximumDetailLength) ??
    toolDetailFromArguments(
      protoText(toolCall ?? [], TOOL_CALL_FIELD.ARGUMENTS),
      maximumDetailLength,
    );
  return detail ? { name, detail } : { name };
}

/** The command a run-command step wants to run, in the app's own record. */
function antigravityCommandLine(
  stepFields: readonly ProtoField[],
  maximumLength: number,
): string | undefined {
  const bytes = protoBytes(stepFields, STEP_FIELD.RUN_COMMAND);
  const runCommand = bytes ? protoFields(bytes) : undefined;
  if (!runCommand) return undefined;
  return oneLine(
    protoText(runCommand, RUN_COMMAND_FIELD.COMMAND_LINE) ??
      protoText(runCommand, RUN_COMMAND_FIELD.PROPOSED_COMMAND_LINE),
    maximumLength,
  );
}

function toolDetailFromArguments(
  argumentsJson: string | undefined,
  maximumLength: number,
): string | undefined {
  if (!argumentsJson) return undefined;
  let parsed: UnparsedWireValue;
  try {
    // SAFETY: JSON.parse returns a runtime value; isRecord narrows it below.
    parsed = JSON.parse(argumentsJson) as UnparsedWireValue;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  for (const key of ANTIGRAVITY_TOOL_INPUT_KEY) {
    const detail = oneLine(text(parsed[key]), maximumLength);
    if (detail) return detail;
  }
  return undefined;
}

/** The workspace one `CortexWorkspaceMetadata`-shaped message names. */
export interface AntigravityWorkspace {
  folderPath?: string;
  branch?: string;
}

/**
 * The workspace a conversation store's own trajectory metadata names — the
 * same record the summaries index carries per conversation, kept in the
 * store's metadata table for the surfaces that write no index. A
 * conversation opened in no folder records none.
 */
export function antigravityTrajectoryWorkspace(bytes: Uint8Array): AntigravityWorkspace {
  const metadata = protoFields(bytes);
  const workspaceBytes = metadata
    ? protoBytes(metadata, TRAJECTORY_METADATA_FIELD.WORKSPACES)
    : undefined;
  const workspace = workspaceBytes ? protoFields(workspaceBytes) : undefined;
  if (!workspace) return {};
  const folderPath = pathFromFileUri(protoText(workspace, WORKSPACE_METADATA_FIELD.FOLDER_URI));
  const branch = protoText(workspace, WORKSPACE_METADATA_FIELD.BRANCH);
  return {
    ...(folderPath !== undefined ? { folderPath } : undefined),
    ...(branch !== undefined ? { branch } : undefined),
  };
}

/** What the developer typed into one user-input step. */
export function antigravityDeveloperWords(stepFields: readonly ProtoField[]): string | undefined {
  const bytes = protoBytes(stepFields, STEP_FIELD.USER_INPUT);
  const userInput = bytes ? protoFields(bytes) : undefined;
  if (!userInput) return undefined;
  return (
    protoText(userInput, USER_INPUT_FIELD.RESPONSE) ?? protoText(userInput, USER_INPUT_FIELD.QUERY)
  );
}

/** The agent's own reply text in one planner-response step. */
export function antigravityAgentWords(stepFields: readonly ProtoField[]): string | undefined {
  const bytes = protoBytes(stepFields, STEP_FIELD.PLANNER_RESPONSE);
  const response = bytes ? protoFields(bytes) : undefined;
  return response ? protoText(response, PLANNER_RESPONSE_FIELD.RESPONSE) : undefined;
}

/** The agent's notification to the developer in one notify-user step. */
export function antigravityNotifyWords(stepFields: readonly ProtoField[]): string | undefined {
  const bytes = protoBytes(stepFields, STEP_FIELD.NOTIFY_USER);
  const notify = bytes ? protoFields(bytes) : undefined;
  return notify ? protoText(notify, NOTIFY_USER_FIELD.CONTENT) : undefined;
}

/**
 * The conversation's own generated title, as one checkpoint step records it:
 * the same name the summaries index and every surface's picker show, kept
 * here by the surfaces that write no index. The intent field is where the
 * app writes it today; the title field, when a build fills it, is the
 * sharper of the two.
 */
export function antigravityCheckpointTitle(stepFields: readonly ProtoField[]): string | undefined {
  const bytes = protoBytes(stepFields, STEP_FIELD.CHECKPOINT);
  const checkpoint = bytes ? protoFields(bytes) : undefined;
  if (!checkpoint) return undefined;
  return (
    protoText(checkpoint, CHECKPOINT_FIELD.CONVERSATION_TITLE) ??
    protoText(checkpoint, CHECKPOINT_FIELD.USER_INTENT)
  );
}

/** The task a task-boundary step opened or closed, by the app's own name for it. */
export function antigravityTaskName(stepFields: readonly ProtoField[]): string | undefined {
  const bytes = protoBytes(stepFields, STEP_FIELD.TASK_BOUNDARY);
  const boundary = bytes ? protoFields(bytes) : undefined;
  return boundary ? protoText(boundary, TASK_BOUNDARY_FIELD.NAME) : undefined;
}

/** The words of a failure the app recorded, mildest reading first. */
export function antigravityErrorWords(
  errorBytes: Uint8Array | undefined,
  maximumLength: number,
): string | undefined {
  const details = errorBytes ? protoFields(errorBytes) : undefined;
  if (!details) return undefined;
  return oneLine(
    protoText(details, ERROR_DETAILS_FIELD.USER_MESSAGE) ??
      protoText(details, ERROR_DETAILS_FIELD.SHORT_ERROR),
    maximumLength,
  );
}

/** The inner step of one waiting-steps entry. */
function stepFieldsFromIndexedStep(bytes: Uint8Array): readonly ProtoField[] | undefined {
  const indexed = protoFields(bytes);
  const stepBytes = indexed ? protoBytes(indexed, STEP_WITH_INDEX_FIELD.STEP) : undefined;
  return stepBytes ? protoFields(stepBytes) : undefined;
}

const SUMMARY_ACTIVITY_MAXIMUM_LENGTH = 80;

function summaryFrom(
  conversationId: string,
  summaryFields: readonly ProtoField[],
): AntigravitySessionSummary {
  const annotationsBytes = protoBytes(summaryFields, TRAJECTORY_SUMMARY_FIELD.ANNOTATIONS);
  const annotations = annotationsBytes ? protoFields(annotationsBytes) : undefined;
  const workspaceBytes = protoBytes(summaryFields, TRAJECTORY_SUMMARY_FIELD.WORKSPACES);
  const workspace = workspaceBytes ? protoFields(workspaceBytes) : undefined;
  const waitingSteps = protoBytesList(summaryFields, TRAJECTORY_SUMMARY_FIELD.WAITING_STEPS);
  const holdingStep = waitingSteps
    .map((bytes) => stepFieldsFromIndexedStep(bytes))
    .find((step): step is readonly ProtoField[] => step !== undefined);
  const holdingActivity = holdingStep
    ? antigravityStepToolCall(holdingStep, SUMMARY_ACTIVITY_MAXIMUM_LENGTH)
    : undefined;
  const notifyStepBytes = protoBytes(
    summaryFields,
    TRAJECTORY_SUMMARY_FIELD.LATEST_NOTIFY_USER_STEP,
  );
  const notifyStep = notifyStepBytes ? stepFieldsFromIndexedStep(notifyStepBytes) : undefined;
  const title =
    (annotations ? protoText(annotations, ANNOTATIONS_FIELD.TITLE) : undefined) ??
    protoText(summaryFields, TRAJECTORY_SUMMARY_FIELD.TITLE);
  const notifyWords = notifyStep ? antigravityNotifyWords(notifyStep) : undefined;
  return {
    conversationId,
    ...(title !== undefined ? { title } : undefined),
    runStatus: protoVarint(summaryFields, TRAJECTORY_SUMMARY_FIELD.STATUS),
    killed: protoVarint(summaryFields, TRAJECTORY_SUMMARY_FIELD.KILLED) === 1,
    archived:
      (annotations ? protoVarint(annotations, ANNOTATIONS_FIELD.ARCHIVED) : undefined) === 1,
    observedAtMs: newestOf(
      protoTimestampMs(summaryFields, TRAJECTORY_SUMMARY_FIELD.LAST_MODIFIED_TIME),
      protoTimestampMs(summaryFields, TRAJECTORY_SUMMARY_FIELD.LAST_USER_INPUT_TIME),
      protoTimestampMs(summaryFields, TRAJECTORY_SUMMARY_FIELD.CREATED_TIME),
    ),
    folderPath: pathFromFileUri(
      workspace ? protoText(workspace, WORKSPACE_METADATA_FIELD.FOLDER_URI) : undefined,
    ),
    branch: workspace ? protoText(workspace, WORKSPACE_METADATA_FIELD.BRANCH) : undefined,
    holding: waitingSteps.length > 0,
    ...(holdingActivity
      ? {
          holdingActivity: holdingActivity.detail
            ? `${holdingActivity.name}: ${holdingActivity.detail}`
            : holdingActivity.name,
        }
      : undefined),
    ...(notifyWords !== undefined ? { notifyWords } : undefined),
  };
}

/**
 * The address a row press hands the operating system, by the surface that
 * holds the conversation. Neither app documents a conversation-level deep
 * link, so each address is the nearest thing its app's own protocol handler
 * actually routes, verified against the running apps: the Agent Manager
 * focuses (or launches) on any URL under its registered `antigravity:`
 * scheme — the `/c/<id>` path is the app's own conversation route, carried
 * so the link sharpens by itself the day the handler learns it — and the
 * IDE opens the named folder's window under the `antigravity-ide://file`
 * form every VS Code-derived editor routes. An IDE conversation whose
 * workspace is unknown, and every CLI conversation — a terminal is not
 * addressable, like the other terminal agents — reports no address at all.
 */
export function antigravitySessionLink(
  profile: AntigravityProfile,
  conversationId: string,
  folderPath: string | undefined,
): string | undefined {
  if (profile === ANTIGRAVITY_PROFILE.MANAGER) return `antigravity://c/${conversationId}`;
  if (profile === ANTIGRAVITY_PROFILE.IDE && folderPath) {
    return `antigravity-ide://file${encodeURI(folderPath)}`;
  }
  return undefined;
}

/**
 * The `title:` field of one conversation's annotations file, where a rename
 * lands for the surfaces that keep no summaries index. The file is text
 * protobuf, whose one string shape this reads: a double-quoted value with
 * backslash escapes. A title using an escape beyond the plain three is a
 * title this build cannot read faithfully, and reads as none.
 */
export function antigravityAnnotationTitle(document: string): string | undefined {
  const match = /(?:^|[\s{])title:\s*"((?:[^"\\\n]|\\.)*)"/u.exec(document);
  if (!match?.[1]) return undefined;
  const escaped = match[1];
  let title = "";
  for (let index = 0; index < escaped.length; index += 1) {
    const character = escaped[index];
    if (character !== "\\") {
      title += character;
      continue;
    }
    index += 1;
    const next = escaped[index];
    if (next === "n") title += "\n";
    else if (next === '"' || next === "\\") title += next;
    else return undefined;
  }
  return title.trim() || undefined;
}

/**
 * Every conversation the summaries index holds, in the index's own order. A
 * file this build cannot read whole — truncated mid-write, or a schema move
 * away from the wire shapes read here — is refused whole, and the pass
 * observes nothing rather than a partial roster posing as the full one.
 */
export function parseAntigravitySummaries(
  bytes: Uint8Array,
): AntigravitySessionSummary[] | undefined {
  const state = protoFields(bytes);
  if (!state) return undefined;
  const summaries: AntigravitySessionSummary[] = [];
  for (const entryBytes of protoBytesList(state, SUMMARIES_STATE_FIELD.SUMMARY_ENTRY)) {
    const entry = protoFields(entryBytes);
    if (!entry) return undefined;
    const conversationId = protoText(entry, SUMMARY_ENTRY_FIELD.CONVERSATION_ID);
    const summaryBytes = protoBytes(entry, SUMMARY_ENTRY_FIELD.SUMMARY);
    if (!conversationId || summaryBytes === undefined) continue;
    const summaryFields = protoFields(summaryBytes);
    if (!summaryFields) return undefined;
    summaries.push(summaryFrom(conversationId, summaryFields));
  }
  return summaries;
}
