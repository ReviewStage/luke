import { isRecord, oneLine, recordFromJsonLine, text, type WireRecord } from "@sidecar/wire";
import {
  canIgnoreSqliteError,
  defaultSqliteModule,
  openReadOnlyDatabase,
  type SqliteDatabase,
  type SqliteModuleLoader,
  textFromRow,
} from "../shared/local-sqlite.js";
import {
  boundedTranscript,
  TRANSCRIPT_BOUNDS,
  transcriptLine,
} from "../shared/local-transcript.js";
import {
  defaultRadiusHome,
  RADIUS_EVENT_COLUMN,
  RADIUS_EVENT_KIND,
  RADIUS_MESSAGE_ROLE,
  radiusDatabasePath,
  radiusEventPayload,
  radiusToolDetail,
  radiusToolId,
  radiusToolName,
} from "./records.js";

/**
 * On-demand reading of one Radius chat's transcript, for a question the
 * developer just asked. The conversation Radius already stores is the
 * transcript — the events its turns wrote, which carry the developer's
 * prompts, the agent's replies, and the tools it ran — read bounded, rendered
 * into a bounded conversation, and discarded. Nothing here is retained,
 * watched, or written; a chat is re-read the next time it is asked about.
 *
 * The events are read rather than the `chat_messages` rows beside them: those
 * are the context Radius replays into the next turn, so they hold prose alone
 * and lag a turn behind, where the events are the turn as it happened.
 */

const RADIUS_SPEAKER_NAME = "Radius";

/** How many of a chat's newest events one transcript read may load. */
const RADIUS_TRANSCRIPT_EVENT_LIMIT = 400;

/**
 * The chat's events, newest first, across every turn it has run. The join is
 * what keeps the read to one chat: `events` is keyed by turn, and only
 * `turns` knows which conversation a turn belonged to.
 */
const RADIUS_TRANSCRIPT_EVENTS_QUERY = `
  SELECT events.kind AS kind, events.payload_json AS payload_json
  FROM events
  JOIN turns ON turns.id = events.turn_id
  WHERE turns.conversation_id = ?
  ORDER BY turns.created_at DESC, events.seq DESC
  LIMIT ?
`;

/**
 * The chat's events rendered oldest first, one line each. A tool's answer is
 * deliberately absent: Radius records a completion without the output behind
 * it, so a rendering carries the calls and not their results. A call Radius
 * announced twice takes one line, recognized by the id both events carry.
 */
export function renderRadiusEvents(events: readonly WireRecord[]): string[] {
  const lines: string[] = [];
  const rendered = new Set<string>();
  for (const row of events) {
    const kind = textFromRow(row, RADIUS_EVENT_COLUMN.KIND);
    const event = recordFromJsonLine(textFromRow(row, RADIUS_EVENT_COLUMN.PAYLOAD_JSON) ?? "");
    const payload = event ? radiusEventPayload(event) : undefined;
    if (!payload) continue;
    if (kind === RADIUS_EVENT_KIND.MESSAGE_COMPLETED) {
      const words = oneLine(text(payload.text), TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH);
      if (!words) continue;
      lines.push(
        text(payload.role) === RADIUS_MESSAGE_ROLE.USER
          ? transcriptLine.developer(words)
          : transcriptLine.agent(RADIUS_SPEAKER_NAME, words),
      );
      continue;
    }
    if (kind !== RADIUS_EVENT_KIND.TOOL_STARTED) continue;
    const name = radiusToolName(payload);
    if (!name) continue;
    const toolId = radiusToolId(payload);
    if (toolId !== undefined) {
      if (rendered.has(toolId)) continue;
      rendered.add(toolId);
    }
    lines.push(
      transcriptLine.toolCall(
        name,
        radiusToolDetail(payload, TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH),
      ),
    );
  }
  return lines;
}

function eventRows(database: SqliteDatabase, providerSessionId: string): readonly WireRecord[] {
  try {
    return database
      .prepare(RADIUS_TRANSCRIPT_EVENTS_QUERY)
      .all(providerSessionId, RADIUS_TRANSCRIPT_EVENT_LIMIT)
      .filter(isRecord);
  } catch (error) {
    if (error instanceof Error && canIgnoreSqliteError(error)) return [];
    throw error;
  }
}

export interface RadiusTranscriptRequest {
  radiusHome?: string;
  /**
   * The conversation's own id, exactly as an observation reported it. It is
   * only ever a bound parameter of the read above — never a path, and never
   * part of a statement's text — so nothing about its shape has to be assumed
   * here for the read to stay safe.
   */
  providerSessionId: string;
  maximumRenderedLength?: number;
  sqlite?: SqliteModuleLoader;
}

/**
 * Reads one chat's recent transcript into a bounded rendering, or nothing
 * when no database holds it: an absent browser, an unknown chat, and a schema
 * this build cannot read all answer the same way.
 */
export async function readRadiusChatTranscript(
  request: RadiusTranscriptRequest,
): Promise<string | undefined> {
  const radiusHome = request.radiusHome ?? defaultRadiusHome();
  const database = await openReadOnlyDatabase(
    request.sqlite ?? defaultSqliteModule,
    radiusDatabasePath(radiusHome),
  );
  if (!database) return undefined;
  try {
    const lines = renderRadiusEvents([...eventRows(database, request.providerSessionId)].reverse());
    return boundedTranscript(
      lines,
      request.maximumRenderedLength ?? TRANSCRIPT_BOUNDS.MAXIMUM_RENDERED_LENGTH,
    );
  } finally {
    database.close();
  }
}
