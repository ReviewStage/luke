import { expect, it } from "vitest";
import { pullRequestChaptersOfLive } from "./pull-request-chapters-live.js";

/**
 * pull-request-chapters-live.test.ts -- the live statement's row of a pull
 * request's newest claim is drawn as the agent's read answers it: none where
 * it was never generated, each state with the columns it draws, a failure's
 * stored kind, its stored chapters decoded with their wire schema so a key
 * the wire does not name is dropped, and a ready row without its model as
 * unavailable.
 */

const HEADS = { headSha: "c0ffee1", baseSha: "ba5e000" } as const;

/** Every column the statement selects, as the poll delivers a row, each state's own written over it. */
const STORED = {
  ...HEADS,
  failureKind: null,
  model: null,
  chapters: null,
  startedAt: 1_762_214_400_000,
} as const;

const TOLD = {
  kind: "story",
  title: "Expire invitations after a week",
  summary: "Invitations now expire.",
  hunkRefs: [{ path: "src/invitations.ts", oldStart: 1 }],
  keyChanges: [],
  risk: "low",
  riskReasons: ["One constant."],
} as const;

it.each([
  [
    "never generated",
    [],
    { pullRequest: { number: 7, generatable: true, chapters: { status: "none" } } },
  ],
  [
    "generating",
    [{ ...STORED, status: "generating" }],
    {
      pullRequest: {
        number: 7,
        generatable: true,
        chapters: { status: "generating", ...HEADS, startedAt: 1_762_214_400_000 },
      },
    },
  ],
  [
    "failed",
    [{ ...STORED, status: "failed", failureKind: "timeout" }],
    {
      pullRequest: {
        number: 7,
        generatable: true,
        chapters: { status: "failed", ...HEADS, failureKind: "timeout" },
      },
    },
  ],
  [
    "ready",
    [
      {
        ...STORED,
        status: "ready",
        model: "claude-haiku-5-5",
        chapters: [{ ...TOLD, tokens: 812 }],
      },
    ],
    {
      pullRequest: {
        number: 7,
        generatable: true,
        chapters: { status: "ready", ...HEADS, model: "claude-haiku-5-5", chapters: [TOLD] },
      },
    },
  ],
  [
    "ready with no model",
    [{ ...STORED, status: "ready", chapters: [TOLD] }],
    { failure: "unavailable" },
  ],
])("a pull request whose newest claim is %s is drawn as the read answers it", (_, rows, answer) => {
  expect(pullRequestChaptersOfLive(rows, 7, true)).toEqual(answer);
});
