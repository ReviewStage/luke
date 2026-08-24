import path from "node:path";
import { isRecord, oneLine, type WireRecord } from "@sidecar/wire";
import {
  canIgnoreSqliteError,
  defaultSqliteModule,
  numberFromRow,
  type SqliteDatabase,
  type SqliteModuleLoader,
} from "../shared/local-sqlite.js";
import {
  boundedTranscript,
  TRANSCRIPT_BOUNDS,
  transcriptLine,
} from "../shared/local-transcript.js";
import { withSqliteTranscript } from "../shared/sqlite-transcript.js";
import {
  ANTIGRAVITY_CONVERSATION_STORE_EXTENSION,
  ANTIGRAVITY_CONVERSATIONS_DIRECTORY,
  ANTIGRAVITY_PROFILE_DIRECTORIES,
  antigravityAgentWords,
  antigravityDeveloperWords,
  antigravityErrorWords,
  antigravityNotifyWords,
  antigravityStepToolCall,
  antigravityTaskName,
  bytesFromRow,
  CORTEX_STEP_TYPE,
  defaultAntigravityHome,
  type ProtoField,
  protoFields,
} from "./records.js";

/**
 * On-demand reading of one local Antigravity conversation's transcript, for a
 * question the developer just asked. The `steps` table of the conversation's
 * own SQLite store is the transcript — the same store the adapter reads its
 * tip from, here opened for its words: the newest steps, read through a
 * parameterized point query against the read-only handle, rendered into a
 * bounded conversation, and discarded. Nothing here is retained, watched, or
 * written; a session is re-read the next time it is asked about. Antigravity
 * keeps tool outputs in result blobs this build does not render, so a
 * rendering carries the calls and never their answers; a conversation from an
 * older build has only a `.pb` file that is not plaintext, and keeps the
 * honest refusal.
 */

const ANTIGRAVITY_SPEAKER_NAME = "Antigravity";

/** A conversation id becomes a file name, so anything else is refused. */
export const ANTIGRAVITY_SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

const ANTIGRAVITY_TRANSCRIPT_BOUNDS = {
  /** How many of the store's newest steps one read may walk. */
  MAXIMUM_STEPS: 96,
} as const;

const ANTIGRAVITY_TRANSCRIPT_COLUMN = {
  STEP_TYPE: "step_type",
  STEP_PAYLOAD: "step_payload",
  ERROR_DETAILS: "error_details",
} as const;

const ANTIGRAVITY_TRANSCRIPT_QUERY = `
  SELECT step_type, step_payload, error_details
  FROM steps
  ORDER BY idx DESC
  LIMIT ?1
`;

/** The name the store's own schema gives a task-boundary step. */
const TASK_BOUNDARY_TOOL_NAME = "task_boundary";

export interface AntigravityTranscriptRequest {
  antigravityHome?: string;
  providerSessionId: string;
  sqlite?: SqliteModuleLoader;
  maximumRenderedLength?: number;
}

/**
 * Renders one step into the lines a conversation can carry: the developer's
 * own words, the agent's reply or notification, a tool call named by the
 * store's own record, and any failure the store wrote beside it. A step this
 * build has no reading for takes no line rather than a guessed one.
 */
function linesFromStep(row: WireRecord, stepFields: readonly ProtoField[] | undefined): string[] {
  const lines: string[] = [];
  const stepType = numberFromRow(row, ANTIGRAVITY_TRANSCRIPT_COLUMN.STEP_TYPE);
  if (stepFields) {
    if (stepType === CORTEX_STEP_TYPE.USER_INPUT) {
      const said = oneLine(
        antigravityDeveloperWords(stepFields),
        TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH,
      );
      if (said) lines.push(transcriptLine.developer(said));
    } else if (stepType === CORTEX_STEP_TYPE.PLANNER_RESPONSE) {
      const said = oneLine(
        antigravityAgentWords(stepFields),
        TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH,
      );
      if (said) lines.push(transcriptLine.agent(ANTIGRAVITY_SPEAKER_NAME, said));
    } else if (stepType === CORTEX_STEP_TYPE.NOTIFY_USER) {
      const said = oneLine(
        antigravityNotifyWords(stepFields),
        TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH,
      );
      if (said) lines.push(transcriptLine.agent(ANTIGRAVITY_SPEAKER_NAME, said));
    } else if (stepType === CORTEX_STEP_TYPE.TASK_BOUNDARY) {
      const name = oneLine(antigravityTaskName(stepFields), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
      if (name) lines.push(transcriptLine.toolCall(TASK_BOUNDARY_TOOL_NAME, name));
    } else {
      const toolCall = antigravityStepToolCall(stepFields, TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
      if (toolCall) lines.push(transcriptLine.toolCall(toolCall.name, toolCall.detail));
    }
  }
  const failure = antigravityErrorWords(
    bytesFromRow(row, ANTIGRAVITY_TRANSCRIPT_COLUMN.ERROR_DETAILS),
    TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH,
  );
  if (failure) lines.push(transcriptLine.error(failure));
  return lines;
}

function readRows(database: SqliteDatabase, parameters: readonly unknown[]): WireRecord[] {
  try {
    return database
      .prepare(ANTIGRAVITY_TRANSCRIPT_QUERY)
      .all(...parameters)
      .filter((row): row is WireRecord => isRecord(row));
  } catch (error) {
    if (error instanceof Error && canIgnoreSqliteError(error)) return [];
    throw error;
  }
}

function renderedFromDatabase(database: SqliteDatabase, maximumLength: number): string | undefined {
  const rows = readRows(database, [ANTIGRAVITY_TRANSCRIPT_BOUNDS.MAXIMUM_STEPS]).toReversed();
  return boundedTranscript(
    rows.flatMap((row) => {
      const payloadBytes = bytesFromRow(row, ANTIGRAVITY_TRANSCRIPT_COLUMN.STEP_PAYLOAD);
      return linesFromStep(row, payloadBytes ? protoFields(payloadBytes) : undefined);
    }),
    maximumLength,
  );
}

/**
 * Reads one conversation's recent transcript into a bounded rendering, or
 * nothing when no profile's store holds readable steps for that id.
 */
export async function readAntigravitySessionTranscript(
  request: AntigravityTranscriptRequest,
): Promise<string | undefined> {
  if (!ANTIGRAVITY_SESSION_ID_PATTERN.test(request.providerSessionId)) return undefined;
  const antigravityHome = request.antigravityHome ?? defaultAntigravityHome();
  const sqlite = request.sqlite ?? defaultSqliteModule;
  return withSqliteTranscript(
    sqlite,
    ANTIGRAVITY_PROFILE_DIRECTORIES.map((profile) =>
      path.join(
        antigravityHome,
        profile,
        ANTIGRAVITY_CONVERSATIONS_DIRECTORY,
        `${request.providerSessionId}${ANTIGRAVITY_CONVERSATION_STORE_EXTENSION}`,
      ),
    ),
    (database) =>
      renderedFromDatabase(
        database,
        request.maximumRenderedLength ?? TRANSCRIPT_BOUNDS.MAXIMUM_RENDERED_LENGTH,
      ),
  );
}
