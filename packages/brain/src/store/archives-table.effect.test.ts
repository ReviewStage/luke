import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { ARCHIVE_ENCODING, CONVERSATION_KIND, MAIN_SESSION_KEY } from "@sidecar/runtime/vocabulary";
import { Effect } from "effect";
import {
  archivePayloadEffect,
  archiveRecordEffect,
  insertArchiveEffect,
  listArchivesEffect,
  markArchivePublishedEffect,
  pendingArchiveIdsEffect,
  removeArchiveRowEffect,
} from "./archives-table.js";
import { NOW, overStore } from "./testing.js";

const PAYLOAD = new TextEncoder().encode("archived jsonl");

const insertion = (archiveId: string, overrides: { deletedAt?: number } = {}) => ({
  archiveId,
  sessionKey: MAIN_SESSION_KEY,
  kind: CONVERSATION_KIND.MAIN,
  name: "main",
  createdAt: NOW,
  deletedAt: overrides.deletedAt ?? NOW,
  encoding: ARCHIVE_ENCODING.IDENTITY,
  sha256: "deadbeef",
  byteLength: PAYLOAD.length,
  fileName: `${archiveId}.jsonl`,
  conversationLines: 1,
  transcriptEvents: 2,
  previousCutoff: undefined,
  payload: PAYLOAD,
});

describe("the archive registry over the client", () => {
  it.effect("round-trips an inserted archive through its record and its payload", () =>
    overStore(
      Effect.gen(function* () {
        yield* insertArchiveEffect(insertion("archive-a"));

        const record = yield* archiveRecordEffect("archive-a");
        const payload = yield* archivePayloadEffect("archive-a");
        const listed = yield* listArchivesEffect;

        assert.equal(record?.archiveId, "archive-a");
        assert.equal(record?.publishedAt, undefined);
        assert.deepEqual(payload, PAYLOAD);
        assert.deepEqual(
          listed.map((archive) => archive.archiveId),
          ["archive-a"],
        );
      }),
    ),
  );

  it.effect("answers nothing for a record, a payload, or a removal at an id no row names", () =>
    overStore(
      Effect.gen(function* () {
        assert.equal(yield* archiveRecordEffect("no-such-archive"), undefined);
        assert.equal(yield* archivePayloadEffect("no-such-archive"), undefined);
        assert.equal(yield* removeArchiveRowEffect("no-such-archive"), false);
      }),
    ),
  );

  it.effect("lets a published archive's payload go and drops it from the pending ids", () =>
    overStore(
      Effect.gen(function* () {
        yield* insertArchiveEffect(insertion("archive-a"));

        yield* markArchivePublishedEffect("archive-a", NOW + 1);

        const record = yield* archiveRecordEffect("archive-a");
        const payload = yield* archivePayloadEffect("archive-a");
        assert.equal(record?.publishedAt, NOW + 1);
        assert.equal(payload, undefined);
        assert.deepEqual(yield* pendingArchiveIdsEffect, []);
      }),
    ),
  );

  it.effect("lists the ids still owed a publication, oldest deletion first", () =>
    overStore(
      Effect.gen(function* () {
        yield* insertArchiveEffect(insertion("archive-newer", { deletedAt: NOW + 10 }));
        yield* insertArchiveEffect(insertion("archive-older", { deletedAt: NOW }));

        assert.deepEqual(yield* pendingArchiveIdsEffect, ["archive-older", "archive-newer"]);
      }),
    ),
  );

  it.effect("removes a registered archive's row", () =>
    overStore(
      Effect.gen(function* () {
        yield* insertArchiveEffect(insertion("archive-a"));

        assert.equal(yield* removeArchiveRowEffect("archive-a"), true);

        assert.deepEqual(yield* listArchivesEffect, []);
      }),
    ),
  );
});
