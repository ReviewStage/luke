import type { SessionId, SessionKey } from "./identifiers.js";

/**
 * The storage contracts the runtime store implements and the host composes
 * against. Nothing here names a database: the contracts describe what a
 * durable owner of conversation state must be able to do, and the store that
 * does it lives in its own package behind them.
 */

/**
 * One line of a conversation's history as the store keeps it, separate from
 * whatever projection a surface draws. The payload is the complete event as
 * its writer recorded it; the columns beside it are what the store indexes.
 */
export interface StoredHistoryEvent {
  sessionKey: SessionKey;
  /**
   * The conversation lifetime that stood when the line was written, so lines
   * from different lifetimes of one conversation stay distinguishable once a
   * reset keeps history across them. Absent only for a line written before
   * any lifetime stood — an import from a source whose own lifetime had
   * already ended, or a line recorded before the first generation loaded.
   */
  sessionId?: SessionId;
  /** The store's own ordering, dense per session key and never reused. */
  sequence: number;
  /** The writer's value identity for the line, so an append is idempotent. */
  eventKey: string;
  kind: string;
  recordedAt: number;
  requestId?: string;
  payload: string;
}

/** What an append answered: whether the store changed, and the lines it now holds. */
export interface HistoryAppendOutcome<Entry> {
  changed: boolean;
  entries: readonly Entry[];
}
