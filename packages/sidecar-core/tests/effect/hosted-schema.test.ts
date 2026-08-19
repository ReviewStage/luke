import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeHostedMintAnswer,
  decodeHostedQuota,
  decodeHostedReviewAnswer,
} from "../../src/effect/hosted-schema.js";
import {
  HOSTED_CALLS_URL,
  hostedMintAnswerFromWire,
  hostedQuotaFromWire,
  hostedReviewAnswerFromWire,
} from "../../src/hosted-service.js";
import type { UnparsedWireValue } from "../../src/json.js";
import { ATTENTION_DISPOSITION } from "../../src/session.js";

const NOW = 1_800_000_000_000;
const DECIDED_AT = NOW + 5_000;
const QUOTA = { used: 3, limit: 50, remaining: 47, resetsAt: NOW + 3_600_000 };

function mintedBody(
  overrides: {
    connection?: Record<string, UnparsedWireValue>;
    quota?: UnparsedWireValue;
    omitQuota?: boolean;
  } = {},
): UnparsedWireValue {
  const body: { connection: Record<string, UnparsedWireValue>; quota?: UnparsedWireValue } = {
    connection: {
      value: "eph-secret",
      expiresAt: NOW + 60_000,
      model: "gpt-realtime-2.1",
      callsUrl: HOSTED_CALLS_URL,
      ...overrides.connection,
    },
  };
  if (!overrides.omitQuota) {
    body.quota = overrides.quota ?? QUOTA;
  }
  // SAFETY: fixture object mirrors hosted mint wire shapes under test.
  return body as UnparsedWireValue;
}

test("decodeHostedQuota accepts a complete quota and soft-fails on bad input", () => {
  assert.deepEqual(decodeHostedQuota(QUOTA), QUOTA);
  assert.equal(decodeHostedQuota(undefined), undefined);
  assert.equal(decodeHostedQuota("quota"), undefined);
  assert.equal(decodeHostedQuota([]), undefined);
  assert.equal(decodeHostedQuota({ used: 1, limit: 2 }), undefined);
  assert.equal(decodeHostedQuota({ used: -1, limit: 2, remaining: 1, resetsAt: 1 }), undefined);
  assert.equal(
    decodeHostedQuota({ used: 1, limit: 2, remaining: 1, resetsAt: Number.NaN }),
    undefined,
  );
});

test("decodeHostedQuota matches hostedQuotaFromWire", () => {
  const cases: UnparsedWireValue[] = [
    QUOTA,
    { used: 0, limit: 0, remaining: 0, resetsAt: 0 },
    { used: 1, limit: 2 },
    { used: -1, limit: 2, remaining: 1, resetsAt: 1 },
    null,
    "quota",
    [],
  ];
  for (const value of cases) {
    assert.deepEqual(decodeHostedQuota(value), hostedQuotaFromWire(value));
  }
});

test("decodeHostedMintAnswer accepts a usable credential with optional quota", () => {
  const answer = decodeHostedMintAnswer(mintedBody(), NOW);
  assert.deepEqual(answer, {
    connection: {
      value: "eph-secret",
      expiresAt: NOW + 60_000,
      model: "gpt-realtime-2.1",
      callsUrl: HOSTED_CALLS_URL,
    },
    quota: QUOTA,
  });
  assert.deepEqual(decodeHostedMintAnswer(mintedBody({ omitQuota: true }), NOW), {
    connection: {
      value: "eph-secret",
      expiresAt: NOW + 60_000,
      model: "gpt-realtime-2.1",
      callsUrl: HOSTED_CALLS_URL,
    },
  });
});

test("decodeHostedMintAnswer soft-fails on malformed or unusable mint answers", () => {
  assert.equal(decodeHostedMintAnswer(undefined, NOW), undefined);
  assert.equal(decodeHostedMintAnswer("mint", NOW), undefined);
  assert.equal(decodeHostedMintAnswer({ connection: null }, NOW), undefined);
  assert.equal(
    decodeHostedMintAnswer(
      mintedBody({
        connection: {
          value: "",
          expiresAt: NOW + 60_000,
          model: "gpt-realtime-2.1",
          callsUrl: HOSTED_CALLS_URL,
        },
      }),
      NOW,
    ),
    undefined,
  );
  assert.equal(
    decodeHostedMintAnswer(
      mintedBody({
        connection: {
          value: "eph-secret",
          expiresAt: NOW - 1,
          model: "gpt-realtime-2.1",
          callsUrl: HOSTED_CALLS_URL,
        },
      }),
      NOW,
    ),
    undefined,
  );
  assert.equal(
    decodeHostedMintAnswer(
      mintedBody({
        connection: {
          value: "eph-secret",
          expiresAt: NOW + 60_000,
          model: "gpt-realtime-2.1",
          callsUrl: "https://evil.example/v1/realtime/calls",
        },
      }),
      NOW,
    ),
    undefined,
  );
  assert.deepEqual(decodeHostedMintAnswer(mintedBody({ quota: { used: 1, limit: 2 } }), NOW), {
    connection: {
      value: "eph-secret",
      expiresAt: NOW + 60_000,
      model: "gpt-realtime-2.1",
      callsUrl: HOSTED_CALLS_URL,
    },
  });
});

test("decodeHostedMintAnswer matches hostedMintAnswerFromWire", () => {
  const cases: UnparsedWireValue[] = [
    mintedBody(),
    mintedBody({ omitQuota: true }),
    mintedBody({
      connection: {
        value: "eph-secret",
        expiresAt: NOW - 1,
        model: "gpt-realtime-2.1",
        callsUrl: HOSTED_CALLS_URL,
      },
    }),
    mintedBody({
      connection: {
        value: "eph-secret",
        expiresAt: NOW + 60_000,
        model: "gpt-realtime-2.1",
        callsUrl: "https://evil.example/v1/realtime/calls",
      },
    }),
    null,
    { connection: null },
  ];
  for (const value of cases) {
    assert.deepEqual(decodeHostedMintAnswer(value, NOW), hostedMintAnswerFromWire(value, NOW));
  }
});

test("decodeHostedReviewAnswer accepts a valid decision with optional quota", () => {
  const decision = {
    disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
    summary: "Session finished.",
  };
  assert.deepEqual(decodeHostedReviewAnswer({ decision, quota: QUOTA }, DECIDED_AT), {
    decision: {
      disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
      summary: "Session finished.",
      decidedAt: DECIDED_AT,
    },
    quota: QUOTA,
  });
  assert.deepEqual(decodeHostedReviewAnswer({ decision }, DECIDED_AT), {
    decision: {
      disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
      summary: "Session finished.",
      decidedAt: DECIDED_AT,
    },
  });
});

test("decodeHostedReviewAnswer soft-fails on malformed review answers", () => {
  assert.equal(decodeHostedReviewAnswer(undefined, DECIDED_AT), undefined);
  assert.equal(decodeHostedReviewAnswer({ decision: null }, DECIDED_AT), undefined);
  assert.equal(
    decodeHostedReviewAnswer({ decision: { disposition: "speak" } }, DECIDED_AT),
    undefined,
  );
  assert.equal(
    decodeHostedReviewAnswer(
      {
        decision: {
          disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
          summary: null,
        },
        quota: { used: 1, limit: 2 },
      },
      DECIDED_AT,
    ),
    undefined,
  );
});

test("decodeHostedReviewAnswer matches hostedReviewAnswerFromWire", () => {
  const silent = { disposition: ATTENTION_DISPOSITION.SILENT, summary: null };
  const spoken = {
    disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
    summary: "Done.",
  };
  const cases: UnparsedWireValue[] = [
    { decision: silent, quota: QUOTA },
    { decision: spoken },
    { decision: { disposition: "speak" } },
    { decision: null },
    null,
  ];
  for (const value of cases) {
    assert.deepEqual(
      decodeHostedReviewAnswer(value, DECIDED_AT),
      hostedReviewAnswerFromWire(value, DECIDED_AT),
    );
  }
});
