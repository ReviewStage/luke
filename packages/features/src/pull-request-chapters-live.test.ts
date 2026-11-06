import { expect, it } from "vitest";
import { pullRequestChaptersOfLive } from "./pull-request-chapters-live.js";

const HEADS = { headSha: "c0ffee1", baseSha: "ba5e000" } as const;

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
  expect(pullRequestChaptersOfLive(rows, 7, { generatable: true })).toEqual(answer);
});
