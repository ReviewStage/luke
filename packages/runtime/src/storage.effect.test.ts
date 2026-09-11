import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import type { UnparsedWireValue, WireRecord } from "@sidecar/wire";
import { Effect } from "effect";
import { CONVERSATION_KIND, sessionKey } from "./identifiers.js";
import {
  decodeConversationArchiveRecord,
  decodeConversationRecord,
  STORAGE_DECODE_REFUSAL,
} from "./storage.effect.js";
import {
  ARCHIVE_ENCODING,
  type ConversationArchiveRecord,
  type ConversationRecord,
  conversationRecordToWire,
} from "./storage.js";

const NOW = 1_800_000_000_000;

/** A record as it reads after the wire carried it, parsed back as the untrusted value a reader takes. */
function throughText(value: WireRecord): UnparsedWireValue {
  // SAFETY: the text is this test's own serialization of a wire record; parsing it back yields a wire value.
  return JSON.parse(JSON.stringify(value)) as UnparsedWireValue;
}

describe("decodeConversationRecord", () => {
  it.effect("answers the record a valid wire value carries", () =>
    Effect.gen(function* () {
      const record: ConversationRecord = {
        sessionKey: sessionKey("agent:main:main"),
        kind: CONVERSATION_KIND.MAIN,
        name: "Luke",
        createdAt: NOW,
        lastActivityAt: NOW,
      };
      const decoded = yield* decodeConversationRecord(
        throughText(conversationRecordToWire(record)),
      );

      assert.deepEqual(decoded, record);
    }),
  );

  it.effect("fails with the conversation-record refusal for a malformed value", () =>
    Effect.gen(function* () {
      const refusal = yield* Effect.flip(decodeConversationRecord({ nope: true }));

      assert.equal(refusal._tag, "StorageDecodeRefused");
      assert.equal(refusal.code, STORAGE_DECODE_REFUSAL.CONVERSATION_RECORD);
    }),
  );
});

describe("decodeConversationArchiveRecord", () => {
  it.effect("fails with the archive-record refusal for a malformed value", () =>
    Effect.gen(function* () {
      const refusal = yield* Effect.flip(decodeConversationArchiveRecord("not a record"));

      assert.equal(refusal._tag, "StorageDecodeRefused");
      assert.equal(refusal.code, STORAGE_DECODE_REFUSAL.CONVERSATION_ARCHIVE_RECORD);
    }),
  );

  it.effect("answers the record a valid wire value carries", () =>
    Effect.gen(function* () {
      const record: ConversationArchiveRecord = {
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
        conversationLines: 3,
        transcriptEvents: 5,
      };
      const wire = throughText({
        archiveId: record.archiveId,
        sessionKey: record.sessionKey,
        kind: record.kind,
        name: record.name,
        createdAt: record.createdAt,
        deletedAt: record.deletedAt,
        encoding: record.encoding,
        sha256: record.sha256,
        byteLength: record.byteLength,
        fileName: record.fileName,
        conversationLines: record.conversationLines,
        transcriptEvents: record.transcriptEvents,
      });
      const decoded = yield* decodeConversationArchiveRecord(wire);

      assert.deepEqual(decoded, record);
    }),
  );
});
