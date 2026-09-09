import assert from "node:assert/strict";
import test from "node:test";
import type { UnparsedWireValue, WireRecord } from "@sidecar/wire";
import { CONVERSATION_KIND, sessionKey } from "./identifiers.js";
import {
  ARCHIVE_ENCODING,
  ARCHIVE_REASON,
  type ConversationRecord,
  conversationRecordFromWire,
  conversationRecordToWire,
  type HistoryArchiveRecord,
  historyArchiveRecordFromWire,
} from "./storage.js";

const NOW = 1_800_000_000_000;

/** A record as it reads after the wire carried it, parsed back as the untrusted value a reader takes. */
function throughText(value: WireRecord): UnparsedWireValue {
  // SAFETY: the text is this test's own serialization of a wire record; parsing it back yields a wire value.
  return JSON.parse(JSON.stringify(value)) as UnparsedWireValue;
}

test("a conversation record survives the wire whole, with every optional field present or absent", () => {
  const full: ConversationRecord = {
    sessionKey: sessionKey("agent:main:thread:1"),
    kind: CONVERSATION_KIND.THREAD,
    name: "A thread",
    createdAt: NOW,
    lastActivityAt: NOW + 5,
    archivedAt: NOW + 6,
    archiveReason: ARCHIVE_REASON.USER,
    pinnedAt: NOW + 1,
    sessionId: "gen-1",
    temporary: true,
  };
  const bare: ConversationRecord = {
    sessionKey: sessionKey("agent:main:main"),
    kind: CONVERSATION_KIND.MAIN,
    name: "Luke",
    createdAt: NOW,
    lastActivityAt: NOW,
  };
  for (const record of [full, bare]) {
    const wire = throughText(conversationRecordToWire(record));
    assert.deepEqual(conversationRecordFromWire(wire), record);
  }
});

test("an archive record reads back whole from its stored row, published or not yet", () => {
  const published: HistoryArchiveRecord = {
    archiveId: "archive-1",
    sessionKey: sessionKey("agent:main:main"),
    kind: CONVERSATION_KIND.MAIN,
    name: "Luke",
    createdAt: NOW,
    deletedAt: NOW + 10,
    encoding: ARCHIVE_ENCODING.ZSTD,
    sha256: "abc",
    byteLength: 42,
    fileName: "agent%3Amain%3Amain.jsonl.deleted.1.archive-1.zst",
    publishedAt: NOW + 11,
    historyLines: 3,
    transcriptEvents: 7,
  };
  const { publishedAt: _published, ...pending } = published;
  for (const record of [published, pending]) {
    assert.deepEqual(historyArchiveRecordFromWire(throughText({ ...record })), record);
  }
});
