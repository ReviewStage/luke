import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT_EVENT } from "@sidecar/analytics";
import { INTRODUCTION_SEED_BOUNDS, LIVE_SESSION_OUTCOME, SEED_ROLE } from "@sidecar/live";
import type { IntroductionSessionSource, LiveSessionCreateInput } from "@sidecar/voice";
import { IntroductionSession } from "./introduction-session";

const SDP = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n";

function fakeSource(answers: boolean[]) {
  const creates: LiveSessionCreateInput[] = [];
  const closes: string[] = [];
  let count = 0;
  const source: IntroductionSessionSource = {
    async create(input) {
      creates.push(input);
      count += 1;
      if (answers[count - 1] === false) return undefined;
      const sessionId = `sess_${count}`;
      return { sessionId, sdpAnswer: "v=0\r\nanswer\r\n", close: () => closes.push(sessionId) };
    },
    diagnostics: () => ({
      apiKeyConfigured: false,
      fixtureMode: false,
      model: "gpt-live-1",
      voice: "marin",
      sidebandAttached: false,
      lastOutcome: LIVE_SESSION_OUTCOME.NOT_ATTEMPTED,
    }),
  };
  return { source, creates, closes };
}

test("an offer seeds the session with the bounded titles and holds the connection", async () => {
  const { source, creates, closes } = fakeSource([true]);
  const counted: string[] = [];
  const session = new IntroductionSession({
    source,
    recordProductEvent: (name) => counted.push(name),
  });

  const titles = Array.from({ length: INTRODUCTION_SEED_BOUNDS.TITLES + 2 }, (_, i) => `T${i}`);
  const answer = await session.open({ sdp: SDP, titles });

  assert.deepEqual(answer, { sessionId: "sess_1", sdpAnswer: "v=0\r\nanswer\r\n" });
  assert.equal(creates[0]?.sdpOffer, SDP);
  assert.equal(creates[0]?.input.length, 1);
  assert.equal(creates[0]?.input[0]?.role, SEED_ROLE.DEVELOPER);
  assert.equal(
    creates[0]?.input[0]?.content[0].text.split("\n").length - 1,
    INTRODUCTION_SEED_BOUNDS.TITLES,
  );
  assert.deepEqual(counted, [PRODUCT_EVENT.VOICE_CALL_START]);
  assert.equal(session.standing, true);
  assert.deepEqual(closes, []);

  session.end();
  assert.deepEqual(closes, ["sess_1"]);
  assert.equal(session.standing, false);
  session.end();
  assert.deepEqual(closes, ["sess_1"]);
});

test("a second offer hangs up the first session, and a refusal holds and counts nothing", async () => {
  const { source, closes } = fakeSource([true, true, false]);
  const counted: string[] = [];
  const session = new IntroductionSession({
    source,
    recordProductEvent: (name) => counted.push(name),
  });

  await session.open({ sdp: SDP, titles: [] });
  await session.open({ sdp: SDP, titles: [] });
  assert.deepEqual(closes, ["sess_1"]);
  assert.equal(session.standing, true);

  assert.equal(await session.open({ sdp: SDP, titles: [] }), undefined);
  assert.deepEqual(closes, ["sess_1", "sess_2"]);
  assert.equal(session.standing, false);
  assert.equal(counted.length, 2);
});
