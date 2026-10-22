import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openHostedStoreTestDatabase } from "@luke/database/testing";
import { VOICE_CLOSE_REASON } from "@luke/database/voice-vocabulary";
import { LIVE_DEFAULTS } from "@luke/live";
import { Effect, Redacted } from "effect";
import { afterAll, onTestFinished, test } from "vitest";
import { fakeSessionRecord, savedOpenAiKeys, startFakeOpenAi } from "../testing/voice-fakes.js";
import { createLiveUpstream } from "./openai.js";
import { sweepVoiceOrphans, VOICE_DETACH_GRACE_MS } from "./orphan-sweep.js";

/**
 * The sweep ending a call whose device never came back, on the key the call
 * was created on: its owner's own OpenAI key, never Luke's. An owner who
 * holds none now has the session left stamped for a later sweep rather than
 * reached on any other key. OpenAI is faked at its own door; synthetic
 * accounts and keys throughout.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const OWNER = "user-orphan-owner";
const OWNER_KEY = "sk-proj-owner-own-key-0000";
const STARTED_AT = 1_000_000;
const NOW = STARTED_AT + VOICE_DETACH_GRACE_MS + 1;

/** One call the owner left detached, and the record and OpenAI the sweep meets it in. */
async function orphaned(keys: Readonly<Record<string, string>>) {
  const openAi = await startFakeOpenAi();
  onTestFinished(() => openAi.close());
  const record = fakeSessionRecord();
  await database.run(
    record.register({
      userId: OWNER,
      sessionId: "live_orphan",
      attachId: "attach-gone",
      model: LIVE_DEFAULTS.MODEL,
    }),
  );
  const swept: string[] = [];
  record.detached = () =>
    Effect.succeed([
      {
        userId: OWNER,
        sessionId: "live_orphan",
        voiceSessionId: randomUUID(),
        startedAt: STARTED_AT,
      },
    ]);
  record.sweepLater = (input) => Effect.sync(() => void swept.push(input.sessionId));
  const keyOf = savedOpenAiKeys(keys);
  const sweep = () =>
    database.run(
      sweepVoiceOrphans(
        {
          upstreamOf: (userId) =>
            Effect.map(keyOf(userId), (key) =>
              key === undefined
                ? undefined
                : createLiveUpstream({ apiKey: Redacted.value(key), baseUrl: openAi.baseUrl }),
            ),
          record,
          recordSeconds: () => Effect.die(new Error("no session here records seconds")),
        },
        { now: NOW },
      ),
    );
  return { openAi, record, swept, sweep };
}

test("an orphan is reached on its owner's own OpenAI key", async () => {
  const { openAi, record, sweep } = await orphaned({ [OWNER]: OWNER_KEY });
  openAi.attachStatus = 404;

  const outcome = await sweep();

  assert.deepEqual(
    openAi.attachAsks.map((attach) => attach.authorization),
    [`Bearer ${OWNER_KEY}`],
  );
  assert.deepEqual(outcome, { closed: 0, lost: 1, pending: 0, failed: 0 });
  assert.deepEqual(record.closes, [
    { sessionId: "live_orphan", seconds: 0, reason: VOICE_CLOSE_REASON.CONNECTION_LOST },
  ]);
});

test("an orphan whose owner holds no OpenAI key now is left for a later sweep, reached on no other key", async () => {
  const { openAi, record, swept, sweep } = await orphaned({});

  const outcome = await sweep();

  assert.equal(openAi.attachAsks.length, 0);
  assert.deepEqual(outcome, { closed: 0, lost: 0, pending: 1, failed: 0 });
  assert.deepEqual(swept, ["live_orphan"]);
  assert.deepEqual(record.closes, []);
});
