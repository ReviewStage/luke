import assert from "node:assert/strict";
import test from "node:test";
import { CRON_SCHEDULE_KIND } from "@sidecar/runtime";
import { MAIN_SESSION_KEY } from "@sidecar/runtime-contracts";
import {
  appendOnlyPromotion,
  applyConsolidationPlan,
  CANDIDATE_ORIGIN,
  CANDIDATE_SESSION_KIND,
  CANDIDATE_STATUS,
  type CandidateSeed,
  CONSOLIDATION_ACTION,
  CONSOLIDATION_DEFAULTS,
  candidateFromSeed,
  consolidationJob,
  DEEP_RANKING_WEIGHTS,
  isConsolidationCandidateEligible,
  isPromotionOriginBlocked,
  type MemoryCandidate,
  memoryCandidateFromWire,
  parseConsolidationPlan,
  promotedCandidateKeys,
  promotedEntry,
  promotionMarker,
  type RankedCandidate,
  rankCandidate,
  reinforceCandidate,
  removePromotedEntries,
  remReflections,
  selectDeepPromotions,
  validateConsolidationPlan,
} from "./consolidation.js";
import {
  isAppendOnlyRewrite,
  isDailyNotePathForDay,
  MEMORY_FLUSH_DEFAULTS,
  memoryFlushPrompt,
  memoryFlushThreshold,
  shouldRunMemoryFlush,
} from "./flush.js";
import {
  prepareForIngestion,
  RECALLED_CONTEXT_MARKER,
  REDACTED_TOKEN,
  redactSensitiveText,
  stripRecalledContext,
} from "./redaction.js";

const NOW = Date.UTC(2026, 8, 8, 3);
const DAY = 24 * 60 * 60 * 1000;

test("the pinned flush and consolidation defaults match OpenClaw b7528507", () => {
  assert.deepEqual(
    [MEMORY_FLUSH_DEFAULTS.SOFT_THRESHOLD_TOKENS, MEMORY_FLUSH_DEFAULTS.FORCE_TRANSCRIPT_BYTES],
    [4_000, 2 * 1024 * 1024],
  );
  assert.deepEqual(
    [
      CONSOLIDATION_DEFAULTS.FREQUENCY_CRON,
      CONSOLIDATION_DEFAULTS.DEEP_MIN_SCORE,
      CONSOLIDATION_DEFAULTS.DEEP_MIN_RECALL_COUNT,
      CONSOLIDATION_DEFAULTS.DEEP_MIN_UNIQUE_QUERIES,
      CONSOLIDATION_DEFAULTS.DEEP_LIMIT,
      CONSOLIDATION_DEFAULTS.DEEP_MAX_PRIOR_ENTRY_LOSS_FRACTION,
      CONSOLIDATION_DEFAULTS.DEEP_RECENCY_HALF_LIFE_DAYS,
      CONSOLIDATION_DEFAULTS.DEEP_MAX_PROMOTED_SNIPPET_TOKENS,
      CONSOLIDATION_DEFAULTS.LIGHT_DEDUPE_SIMILARITY,
    ],
    ["0 3 * * *", 0.75, 3, 3, 10, 0.25, 14, 160, 0.9],
  );
  assert.deepEqual(Object.values(DEEP_RANKING_WEIGHTS), [0.3, 0.24, 0.15, 0.15, 0.1, 0.06]);
  const job = consolidationJob(NOW);
  assert.equal(job.id, "memory-consolidation");
  assert.equal(job.sessionKey, MAIN_SESSION_KEY);
  assert.deepEqual(job.schedule, { kind: CRON_SCHEDULE_KIND.CRON, expression: "0 3 * * *" });
});

test("the flush fires a soft margin under the compaction threshold, on the byte trigger, and once per cycle", () => {
  assert.equal(memoryFlushThreshold(400_000, 20_000), 376_000);
  assert.equal(memoryFlushThreshold(10_000, 2_500), 7_500 - 3_750);
  const base = {
    contextWindowTokens: 400_000,
    reserveTokens: 20_000,
    transcriptBytes: 1_000,
    compactionCount: 0,
  };
  assert.equal(shouldRunMemoryFlush({ ...base, contextTokens: 375_999 }), false);
  assert.equal(shouldRunMemoryFlush({ ...base, contextTokens: 376_000 }), true);
  assert.equal(
    shouldRunMemoryFlush({ ...base, contextTokens: 376_000, lastFlushCompactionCount: 0 }),
    false,
    "flushed already in this cycle",
  );
  assert.equal(
    shouldRunMemoryFlush({
      ...base,
      contextTokens: 376_000,
      compactionCount: 1,
      lastFlushCompactionCount: 0,
    }),
    true,
    "a new cycle flushes again",
  );
  assert.equal(
    shouldRunMemoryFlush({ ...base, contextTokens: 100, transcriptBytes: 2 * 1024 * 1024 }),
    true,
    "the byte trigger flushes whatever the count",
  );
});

test("a housekeeping write is bounded to today's note and to appending", () => {
  assert.equal(isDailyNotePathForDay("memory/2026-09-08.md", "2026-09-08"), true);
  assert.equal(isDailyNotePathForDay("memory/2026-09-08-standup.md", "2026-09-08"), true);
  assert.equal(isDailyNotePathForDay("memory/2026-09-07.md", "2026-09-08"), false);
  assert.equal(isDailyNotePathForDay("MEMORY.md", "2026-09-08"), false);
  assert.equal(isAppendOnlyRewrite("", "- new\n"), true);
  assert.equal(isAppendOnlyRewrite("- old\n", "- old\n- new\n"), true);
  assert.equal(isAppendOnlyRewrite("- old", "- old\n- new\n"), true);
  assert.equal(isAppendOnlyRewrite("- old\n", "- new\n"), false);
  assert.equal(isAppendOnlyRewrite("- old\n", "- ol"), false);
  const prompt = memoryFlushPrompt("2026-09-08");
  assert.equal(prompt.notePath, "memory/2026-09-08.md");
  assert.match(prompt.ask, /memory\/2026-09-08\.md/u);
  assert.match(prompt.system, /read-only/u);
});

test("recalled-context blocks are stripped and sensitive material is redacted before ingestion", () => {
  const text = [
    "The developer prefers pnpm.",
    `${RECALLED_CONTEXT_MARKER} 2026-09-08T00:00:00.000Z`,
    "Earlier they said they use yarn.",
    "",
    "Contact me at dev@example.com or +1 (555) 123-4567; key sk-abcdefghijklmnopqrstuvwxyz.",
  ].join("\n");
  const stripped = stripRecalledContext(text);
  assert.equal(stripped.includes("yarn"), false);
  assert.equal(stripped.includes("prefers pnpm"), true);
  const redacted = redactSensitiveText(stripped);
  assert.equal(redacted.redactions >= 3, true);
  assert.equal(redacted.text.includes("dev@example.com"), false);
  assert.equal(redacted.text.includes("sk-abc"), false);
  assert.equal(redacted.text.includes(REDACTED_TOKEN), true);
  assert.equal(prepareForIngestion(`${RECALLED_CONTEXT_MARKER}\nonly recalled`), undefined);
  assert.equal(prepareForIngestion("password: hunter2"), undefined);
});

function seed(overrides: Partial<CandidateSeed> = {}): CandidateSeed {
  return {
    text: "The developer prefers pnpm over npm for every workspace install",
    path: "memory/2026-09-06.md",
    startLine: 3,
    endLine: 3,
    origin: CANDIDATE_ORIGIN.USER,
    sessionKind: CANDIDATE_SESSION_KIND.INTERACTIVE,
    query: "ingest:2026-09-06",
    score: 0.8,
    day: "2026-09-06",
    ...overrides,
  };
}

function recurring(origin: CandidateSeed["origin"] = CANDIDATE_ORIGIN.USER): MemoryCandidate {
  let candidate = candidateFromSeed(seed({ origin }), NOW - 2 * DAY);
  candidate = reinforceCandidate(
    candidate,
    seed({ origin, query: "ingest:2026-09-07", day: "2026-09-07" }),
    NOW - DAY,
  );
  return reinforceCandidate(
    candidate,
    seed({ origin, query: "ingest:2026-09-08", day: "2026-09-08" }),
    NOW,
  );
}

test("deep ranking promotes a fact recurring on three days under three queries and not a one-off", () => {
  const durable = recurring();
  const ranked = rankCandidate(durable, NOW);
  assert.equal(ranked.score >= CONSOLIDATION_DEFAULTS.DEEP_MIN_SCORE, true, `${ranked.score}`);
  assert.equal(durable.recallCount, 3);
  assert.equal(durable.queries.length, 3);
  const oneOff = candidateFromSeed(seed(), NOW);
  assert.equal(rankCandidate(oneOff, NOW).score < CONSOLIDATION_DEFAULTS.DEEP_MIN_SCORE, true);
  const selected = selectDeepPromotions([durable, oneOff], NOW);
  assert.deepEqual(
    selected.map((entry) => entry.candidate.key),
    [durable.key],
  );
  const wire = memoryCandidateFromWire(JSON.parse(JSON.stringify(durable)));
  assert.deepEqual(wire, durable);
});

test("external and system evidence never promotes however often it recurs, and a child's origin taints a merge", () => {
  const external = recurring(CANDIDATE_ORIGIN.EXTERNAL);
  const system = recurring(CANDIDATE_ORIGIN.SYSTEM);
  assert.equal(isPromotionOriginBlocked(external), true);
  assert.equal(isPromotionOriginBlocked(system), true);
  assert.equal(rankCandidate(external, NOW).score >= CONSOLIDATION_DEFAULTS.DEEP_MIN_SCORE, true);
  assert.deepEqual(selectDeepPromotions([external, system], NOW), []);
  const trusted = recurring();
  const tainted = reinforceCandidate(trusted, seed({ origin: CANDIDATE_ORIGIN.SYSTEM }), NOW);
  assert.equal(tainted.origin, CANDIDATE_ORIGIN.SYSTEM);
  assert.equal(isConsolidationCandidateEligible(tainted), false);
  const background = candidateFromSeed(
    seed({
      path: "conversation:agent:main:subagent:x",
      sessionKind: CANDIDATE_SESSION_KIND.BACKGROUND,
    }),
    NOW,
  );
  assert.equal(isConsolidationCandidateEligible(background), false);
});

function ranked(candidate: MemoryCandidate): RankedCandidate {
  return { candidate, ranking: rankCandidate(candidate, NOW) };
}

test("a model plan is parsed against the candidates, validated against the prior entries, and applied within the loss limit", () => {
  const durable = recurring();
  const first = ranked(durable);
  const promotions = [first];
  const existing = "# MEMORY.md\n\n- The developer likes tabs\n- The developer uses zsh\n";
  assert.equal(parseConsolidationPlan("not json", promotions), undefined);
  assert.equal(
    parseConsolidationPlan(
      JSON.stringify({
        operations: [{ candidateKey: "unknown", action: "added", priorEntries: [] }],
      }),
      promotions,
    ),
    undefined,
  );
  const plan = parseConsolidationPlan(
    `\`\`\`json\n${JSON.stringify({
      operations: [{ candidateKey: durable.key, action: "added", priorEntries: [] }],
    })}\n\`\`\``,
    promotions,
  );
  assert.ok(plan);
  assert.equal(plan.operations[0]?.resultEntry, promotedEntry(first));
  assert.equal(validateConsolidationPlan({ previous: existing, plan, promotions }), undefined);
  const applied = applyConsolidationPlan({ existingMemory: existing, plan, day: "2026-09-08" });
  assert.ok(applied);
  assert.equal(applied.added, 1);
  assert.ok(applied.content.includes(promotionMarker(durable.key)));
  assert.ok(applied.content.includes("Source: memory/2026-09-06.md#L3-L3"));
  assert.ok(applied.content.includes("- The developer likes tabs"));
  assert.deepEqual(promotedCandidateKeys(applied.content), [durable.key]);

  const invalidPrior = parseConsolidationPlan(
    JSON.stringify({
      operations: [
        {
          candidateKey: durable.key,
          action: "merged",
          priorEntries: ["- Something never written"],
        },
      ],
    }),
    promotions,
  );
  assert.ok(invalidPrior);
  assert.match(
    validateConsolidationPlan({ previous: existing, plan: invalidPrior, promotions }) ?? "",
    /invalid prior-entry evidence/u,
  );
  const unrelatedMerge = parseConsolidationPlan(
    JSON.stringify({
      operations: [
        {
          candidateKey: durable.key,
          action: "merged",
          priorEntries: ["- The developer likes tabs"],
        },
      ],
    }),
    promotions,
  );
  assert.ok(unrelatedMerge);
  assert.match(
    validateConsolidationPlan({ previous: existing, plan: unrelatedMerge, promotions }) ?? "",
    /unrelated prior entry/u,
  );
  const noLineage = parseConsolidationPlan(
    JSON.stringify({
      operations: [
        {
          candidateKey: durable.key,
          action: "superseded",
          priorEntries: ["- The developer likes tabs"],
        },
      ],
    }),
    promotions,
  );
  assert.ok(noLineage);
  assert.match(
    validateConsolidationPlan({ previous: existing, plan: noLineage, promotions }) ?? "",
    /without matching lineage/u,
  );
});

test("a rewrite that would lose too many prior entries, or exceed the budget, is refused and the append-only path stands in", () => {
  const durable = recurring();
  const first = ranked(durable);
  const promotions = [first];
  const existing = "# MEMORY.md\n\n- The developer likes tabs\n- The developer uses zsh\n";
  const lossy = {
    operations: [
      {
        candidateKey: durable.key,
        action: CONSOLIDATION_ACTION.MERGED,
        resultEntry: promotedEntry(first),
        priorEntries: ["- The developer likes tabs", "- The developer uses zsh"],
      },
    ],
  };
  assert.equal(
    applyConsolidationPlan({ existingMemory: existing, plan: lossy, day: "2026-09-08" }),
    undefined,
    "two of two prior entries is past the quarter allowed",
  );
  assert.equal(
    appendOnlyPromotion({
      existingMemory: existing,
      promotions,
      day: "2026-09-08",
      maximumChars: 10,
    }),
    undefined,
    "past the budget nothing is written",
  );
  const fallback = appendOnlyPromotion({ existingMemory: existing, promotions, day: "2026-09-08" });
  assert.ok(fallback);
  assert.equal(fallback.added, 1);
  assert.ok(fallback.content.startsWith(existing.trimEnd()));
  assert.equal(
    applyConsolidationPlan({
      existingMemory: fallback.content,
      plan: {
        operations: lossy.operations.map((op) => ({
          ...op,
          action: CONSOLIDATION_ACTION.ADDED,
          priorEntries: [],
        })),
      },
      day: "2026-09-08",
    }),
    undefined,
    "a candidate already promoted is not promoted twice",
  );
});

test("forgetting removes the entries a source produced by their markers and reports what a manual edit left unattributable", () => {
  const durable = recurring();
  const other = candidateFromSeed(
    seed({ text: "The developer keeps meetings before noon", path: "memory/2026-09-05.md" }),
    NOW,
  );
  const content = [
    "# MEMORY.md",
    "",
    "- Hand-written line",
    "",
    "## Consolidated Memory (2026-09-08)",
    "",
    promotionMarker(durable.key),
    promotedEntry(ranked(durable)),
    promotionMarker(other.key),
    promotedEntry(ranked(other)),
    "- Edited by hand, marker gone Source: memory/2026-09-01.md#L2-L2",
    "",
  ].join("\n");
  const scrubbed = removePromotedEntries(content, new Set([durable.key]));
  assert.equal(scrubbed.removed, 1);
  assert.equal(scrubbed.unattributed, 1);
  assert.equal(scrubbed.content.includes(promotionMarker(durable.key)), false);
  assert.equal(scrubbed.content.includes("prefers pnpm"), false);
  assert.ok(scrubbed.content.includes(promotionMarker(other.key)));
  assert.ok(scrubbed.content.includes("before noon"));
  assert.ok(scrubbed.content.includes("Edited by hand"));
});

test("REM reflections name themes that recur across candidates and nothing from a lone one", () => {
  const candidates = [
    recurring(),
    candidateFromSeed(
      seed({
        text: "pnpm workspace installs stay pinned to the lockfile",
        path: "memory/2026-09-07.md",
      }),
      NOW,
    ),
    candidateFromSeed(
      seed({
        text: "Something entirely unrelated about a holiday",
        path: "memory/2026-09-07.md",
        startLine: 9,
        endLine: 9,
      }),
      NOW,
    ),
  ];
  const reflections = remReflections(candidates, 10, 0.5);
  assert.ok(
    reflections.some((reflection) => reflection.theme === "workspace" && reflection.count === 2),
    JSON.stringify(reflections),
  );
  assert.equal(
    reflections.some((reflection) => reflection.theme === "holiday"),
    false,
  );
  assert.equal(candidates[0]?.status, CANDIDATE_STATUS.STAGED);
});
