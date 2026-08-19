import {
  isRecord,
  isWireNumber,
  oneLine,
  recordFromJsonLine,
  text,
  type WireRecord,
} from "@sidecar/core";
import { DEVIN_ROLE, defaultDevinCliDirectory, devinDatabasePaths } from "./devin-local-adapter";
import {
  canIgnoreSqliteError,
  defaultSqliteModule,
  openReadOnlyDatabase,
  type SqliteDatabase,
  type SqliteModuleLoader,
} from "./local-sqlite";
import { boundedTranscript, TRANSCRIPT_BOUNDS, transcriptLine } from "./local-transcript";

/**
 * On-demand reading of one local Devin session's transcript, for a question
 * the developer just asked. The message nodes in the CLI's own database are
 * the transcript — the same table the adapter reads bookkeeping from, here
 * opened for its words: the main chain's newest nodes, read through
 * parameterized point queries against the read-only handle, rendered into a
 * bounded conversation, and discarded. Nothing here is retained, watched, or
 * written; a session is re-read the next time it is asked about.
 */

const DEVIN_SPEAKER_NAME = "Devin";

const DEVIN_SESSION_QUERY = `
  SELECT *
  FROM sessions
  WHERE id = ?1
`;

// The chain is walked by parent pointers from the tip the session row names,
// exactly as the adapter walks it: a rewound session leaves its abandoned
// branch as the newest nodes, and compaction re-inserts older messages, so
// the tip pointer is the one true reading of where the conversation stands.
const DEVIN_CHAIN_QUERY = `
  WITH RECURSIVE chain (node_id, parent_node_id, chat_message, depth) AS (
    SELECT node_id, parent_node_id, chat_message, 0
    FROM message_nodes
    WHERE session_id = ?1 AND node_id = ?2
    UNION ALL
    SELECT nodes.node_id, nodes.parent_node_id, nodes.chat_message, chain.depth + 1
    FROM message_nodes AS nodes
    JOIN chain ON nodes.node_id = chain.parent_node_id
    WHERE nodes.session_id = ?1 AND chain.depth < ?3
  )
  SELECT chat_message FROM chain ORDER BY depth
`;

/** For a session row from before the tip pointer: newest nodes stand in. */
const DEVIN_NEWEST_NODES_QUERY = `
  SELECT chat_message
  FROM message_nodes
  WHERE session_id = ?1
  ORDER BY node_id DESC
  LIMIT ?2
`;

const DEVIN_TRANSCRIPT_BOUNDS = {
  /** How many of the chain's newest nodes one read may walk. */
  MAXIMUM_CHAIN_WALK: 96,
} as const;

/**
 * Tool inputs whose value names the work, in the order they read best. The
 * set matches what the other transcript renderers already show — a URL is
 * deliberately not in it, because a signed URL is a credential.
 */
const DEVIN_TOOL_INPUT_KEY = [
  "description",
  "command",
  "filePath",
  "file_path",
  "pattern",
  "query",
] as const;

type DevinRow = WireRecord;

export interface DevinTranscriptRequest {
  cliDirectory?: string;
  providerSessionId: string;
  sqlite?: SqliteModuleLoader;
  maximumRenderedLength?: number;
}

/**
 * One assistant tool call, in whichever of the shapes the CLI has written it.
 * A call this build cannot name takes no line rather than a guessed one.
 */
function toolLine(call: WireRecord): string | undefined {
  const name =
    text(call.name) ??
    text(call.tool_name) ??
    (isRecord(call.function) ? text(call.function.name) : undefined);
  if (!name) return undefined;
  const rawArguments = isRecord(call.arguments)
    ? call.arguments
    : (recordFromJsonLine(text(call.arguments) ?? "") ??
      (isRecord(call.function)
        ? recordFromJsonLine(text(call.function.arguments) ?? "")
        : undefined));
  for (const key of DEVIN_TOOL_INPUT_KEY) {
    const detail = oneLine(text(rawArguments?.[key]), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
    if (detail) return transcriptLine.toolCall(name, detail);
  }
  return transcriptLine.toolCall(name);
}

/**
 * Renders one chat message into the lines a conversation can carry. System
 * nodes are the CLI's own scaffolding, not something anyone said; a tool
 * node's content is the answer a call came back with.
 */
function linesFromChatMessage(record: WireRecord): string[] {
  const role = text(record.role);
  if (role === DEVIN_ROLE.USER || role === DEVIN_ROLE.ASSISTANT) {
    const lines: string[] = [];
    const said = oneLine(text(record.content), TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH);
    if (said) {
      lines.push(
        role === DEVIN_ROLE.USER
          ? transcriptLine.developer(said)
          : transcriptLine.agent(DEVIN_SPEAKER_NAME, said),
      );
    }
    if (role === DEVIN_ROLE.ASSISTANT && Array.isArray(record.tool_calls)) {
      for (const call of record.tool_calls) {
        if (!isRecord(call)) continue;
        const line = toolLine(call);
        if (line) lines.push(line);
      }
    }
    return lines;
  }
  if (role === DEVIN_ROLE.TOOL) {
    const answer = oneLine(text(record.content), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
    return answer ? [transcriptLine.toolResult(answer)] : [];
  }
  return [];
}

function readRows(
  database: SqliteDatabase,
  query: string,
  parameters: readonly unknown[],
): DevinRow[] {
  try {
    return database
      .prepare(query)
      .all(...parameters)
      .filter((row): row is DevinRow => isRecord(row));
  } catch (error) {
    if (canIgnoreSqliteError(error)) return [];
    throw error;
  }
}

function chainRecords(
  database: SqliteDatabase,
  providerSessionId: string,
  mainChainId: number | undefined,
): WireRecord[] {
  const rows =
    mainChainId !== undefined
      ? readRows(database, DEVIN_CHAIN_QUERY, [
          providerSessionId,
          mainChainId,
          DEVIN_TRANSCRIPT_BOUNDS.MAXIMUM_CHAIN_WALK,
        ])
      : readRows(database, DEVIN_NEWEST_NODES_QUERY, [
          providerSessionId,
          DEVIN_TRANSCRIPT_BOUNDS.MAXIMUM_CHAIN_WALK,
        ]);
  const records: WireRecord[] = [];
  // Compaction re-inserts a message under a fresh node, so the tip-first walk
  // keeps each message's newest copy and drops the rest — a no-op on a chain,
  // which holds one copy, but what keeps the no-tip fallback from repeating
  // every compacted turn.
  const seenMessageIds = new Set<string>();
  for (const row of rows) {
    const record = recordFromJsonLine(text(row.chat_message) ?? "");
    if (!record) continue;
    const messageId = text(record.message_id);
    if (messageId) {
      if (seenMessageIds.has(messageId)) continue;
      seenMessageIds.add(messageId);
    }
    records.push(record);
  }
  return records.toReversed();
}

function renderedFromDatabase(
  database: SqliteDatabase,
  providerSessionId: string,
  maximumLength: number,
): string | undefined {
  const session = readRows(database, DEVIN_SESSION_QUERY, [providerSessionId])[0];
  if (!session) return undefined;
  const mainChainId = session.main_chain_id;
  const records = chainRecords(
    database,
    providerSessionId,
    isWireNumber(mainChainId) && Number.isInteger(mainChainId) ? mainChainId : undefined,
  );
  return boundedTranscript(
    records.flatMap((record) => linesFromChatMessage(record)),
    maximumLength,
  );
}

/**
 * Reads one session's recent transcript into a bounded rendering, or nothing
 * when no database holds messages for that id.
 */
export async function readDevinSessionTranscript(
  request: DevinTranscriptRequest,
): Promise<string | undefined> {
  const cliDirectory = request.cliDirectory ?? defaultDevinCliDirectory();
  const sqlite = request.sqlite ?? defaultSqliteModule;
  for (const databasePath of devinDatabasePaths(cliDirectory)) {
    const database = await openReadOnlyDatabase(sqlite, databasePath);
    if (!database) continue;
    try {
      const rendered = renderedFromDatabase(
        database,
        request.providerSessionId,
        request.maximumRenderedLength ?? TRANSCRIPT_BOUNDS.MAXIMUM_RENDERED_LENGTH,
      );
      if (rendered) return rendered;
    } finally {
      database.close();
    }
  }
  return undefined;
}
