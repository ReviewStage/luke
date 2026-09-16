import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { LiveRecord } from "../live-session/live-record.js";
import { LiveRecordTag, liveRecordLayer } from "./live-record.js";

const fakeRecord: LiveRecord = {
  upsertSpokenRow: () => Effect.succeed(true),
  writeDeveloperUtterance: () => Effect.succeed(true),
};

describe("liveRecordLayer", () => {
  it.effect("hands the same record object back through the tag", () =>
    Effect.gen(function* () {
      const record = yield* LiveRecordTag;
      assert.equal(record, fakeRecord);
    }).pipe(Effect.provide(liveRecordLayer(fakeRecord))),
  );
});
