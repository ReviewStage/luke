import path from "node:path";
import {
  isWireString,
  text,
  unparsedWire,
  type WireBoundaryInput,
  wholeNumber,
  wireRecord,
} from "@sidecar/wire";
import {
  fileStats,
  readDirectory,
  type SessionFileCandidate,
} from "../shared/local-session-adapter.js";

/**
 * Where Cursor's CLI keeps each chat's own record: `chats/<hash>/<chat id>/`,
 * the hash naming the folder the chat ran in. Each chat directory holds a
 * small metadata file and the conversation itself as a blob store. Only the
 * metadata is read: the store's conversation is a blob graph this build
 * cannot read faithfully, and the metadata already carries what a row needs —
 * the name Cursor gave the chat, the exact folder it ran in, and when it last
 * moved.
 */
export const CURSOR_CHAT_STORE_DIRECTORY = "chats";
const CURSOR_CHAT_META_FILE = "meta.json";
const CURSOR_CHAT_STORE_FILE = "store.db";
/** SQLite's write-ahead log, which is what moves while a turn is running. */
const CURSOR_CHAT_STORE_JOURNAL_SUFFIX = "-wal";

/**
 * The one metadata version this build can read. Cursor stamps each record
 * with its schema, so a future shape is skipped rather than misread.
 */
const CURSOR_CHAT_META_SCHEMA_VERSION = 1;

const CURSOR_CHAT_META_FIELD = {
  SCHEMA_VERSION: "schemaVersion",
  HAS_CONVERSATION: "hasConversation",
  TITLE: "title",
  CWD: "cwd",
  UPDATED_AT: "updatedAtMs",
} as const;

/** What one chat's metadata record says about it. */
export interface CursorChatStoreMeta {
  title?: string;
  cwd?: string;
  updatedAtMs?: number;
}

/**
 * Reads one chat's metadata record. A record this build cannot parse, one
 * stamped with a schema it does not know, or one whose chat has no
 * conversation at all answers nothing — a chat Cursor itself says holds no
 * conversation has nothing to draw a row from.
 */
export function readCursorChatStoreMeta(source: string): CursorChatStoreMeta | undefined {
  let parsed: WireBoundaryInput;
  try {
    parsed = JSON.parse(source);
  } catch {
    return undefined;
  }
  const record = wireRecord(unparsedWire(parsed));
  if (!record) return undefined;
  if (record[CURSOR_CHAT_META_FIELD.SCHEMA_VERSION] !== CURSOR_CHAT_META_SCHEMA_VERSION) {
    return undefined;
  }
  if (record[CURSOR_CHAT_META_FIELD.HAS_CONVERSATION] !== true) return undefined;
  const meta: CursorChatStoreMeta = {};
  const title = text(record[CURSOR_CHAT_META_FIELD.TITLE]);
  if (title) meta.title = title;
  const cwd = record[CURSOR_CHAT_META_FIELD.CWD];
  if (isWireString(cwd) && path.isAbsolute(cwd)) meta.cwd = cwd;
  const updatedAtMs = wholeNumber(record[CURSOR_CHAT_META_FIELD.UPDATED_AT]);
  if (updatedAtMs !== undefined) meta.updatedAtMs = updatedAtMs;
  return meta;
}

/**
 * One chat directory per session, named after the session, with the metadata
 * file as the candidate's own file. The candidate's clock is the newest of
 * the metadata and the conversation store's files, because the store — its
 * journal above all — is what moves while a turn runs, and the metadata
 * alone is rewritten too rarely to say the chat is doing anything.
 */
export async function chatStoreSessionsIn(
  sessionsDirectory: string,
): Promise<SessionFileCandidate[]> {
  const entries = await readDirectory(sessionsDirectory);
  const candidates = await Promise.all(
    entries.map(async (entry) => {
      const providerSessionId = entry.name.trim();
      if (!providerSessionId) return undefined;
      const chatDirectory = path.join(sessionsDirectory, entry.name);
      const metaStats = await fileStats(path.join(chatDirectory, CURSOR_CHAT_META_FILE));
      if (!metaStats?.isFile()) return undefined;
      const storePath = path.join(chatDirectory, CURSOR_CHAT_STORE_FILE);
      const [storeStats, journalStats] = await Promise.all([
        fileStats(storePath),
        fileStats(`${storePath}${CURSOR_CHAT_STORE_JOURNAL_SUFFIX}`),
      ]);
      return {
        filePath: path.join(chatDirectory, CURSOR_CHAT_META_FILE),
        providerSessionId,
        mtimeMs: Math.max(metaStats.mtimeMs, storeStats?.mtimeMs ?? 0, journalStats?.mtimeMs ?? 0),
      };
    }),
  );
  return candidates.filter(
    (candidate): candidate is SessionFileCandidate => candidate !== undefined,
  );
}
