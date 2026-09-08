import fs from "node:fs/promises";
import path from "node:path";
import { DAILY_NOTES_DIRECTORY, readWorkspaceFile, WORKSPACE_FILE } from "@sidecar/runtime";
import { DAY_MS, type SessionKey } from "@sidecar/runtime-contracts";
import {
  boundCandidateText,
  CANDIDATE_STATUS,
  type CandidateSeed,
  type CandidateStatus,
  CONSOLIDATION_DEFAULTS,
  CONSOLIDATION_PHASE,
  type ConsolidationPhase,
  DREAMS_FILE,
  isConversationCandidate,
  type MemoryCandidate,
} from "./candidate.js";
import type { RankedCandidate } from "./deep-ranking.js";
import { selectDeepPromotions } from "./deep-ranking.js";
import { DREAM_DIARY_SYSTEM_PROMPT, dreamDiaryEntry, remReflections } from "./diary.js";
import { localDayStamp } from "./flush.js";
import {
  boundNoteLine,
  dedupe,
  type IngestibleHistoryLine,
  ingestibleLines,
  type NoteFile,
  noteSeeds,
  recentHistoryLines,
} from "./ingestion.js";
import {
  appendOnlyPromotion,
  applyConsolidationPlan,
  CONSOLIDATION_SYSTEM_PROMPT,
  type ConsolidationResult,
  consolidationPrompt,
  parseConsolidationPlan,
  validateConsolidationPlan,
} from "./plan.js";
import { prepareForIngestion } from "./redaction.js";
import { candidatesDuplicate } from "./signals.js";

/**
 * The daily consolidation sweep — light, REM, deep — over ports the host
 * supplies: the store's candidate, cursor, and rewrite methods; each eligible
 * conversation's History lines; and one tool-free model completion. The
 * notebook's files stay the source of truth, the store writes MEMORY.md and
 * DREAMS.md behind its own conflict check, and nothing a model wrote reaches
 * durable memory except through the plan's validation or the deterministic
 * fallback.
 */

export const DEEP_PATH = {
  MODEL_PLAN: "validated model plan",
  APPEND_ONLY: "append-only fallback",
  NONE: "nothing promoted",
} as const;

export type DeepPath = (typeof DEEP_PATH)[keyof typeof DEEP_PATH];

/**
 * The share of the light limit the dated notes may take ahead of the
 * conversations, so a full History budget cannot keep a completed note from
 * being staged until it ages out of the lookback; whatever either side
 * leaves goes to the other.
 */
export const NOTE_BUDGET_SHARE = 0.5;

const DIARY_OUTPUT_TOKENS = 400;
const CONSOLIDATION_OUTPUT_TOKENS = 4_000;

export interface ConsolidationSweepReport {
  readonly day: string;
  readonly staged: number;
  readonly reinforced: number;
  readonly deduped: number;
  readonly reflections: number;
  readonly promoted: number;
  readonly deepPath: DeepPath;
  readonly diaryWritten: boolean;
  readonly notes: readonly string[];
}

/** The store as the sweep reads and writes it; the runtime store's client satisfies it as it stands. */
export interface ConsolidationSweepStore {
  listMemoryCandidates(status?: CandidateStatus): Promise<readonly MemoryCandidate[]>;
  memoryIngestionCursor(sessionKey: SessionKey): Promise<number>;
  memoryIngestionSeen(sessionKey: SessionKey, hashes: readonly string[]): Promise<readonly string[]>;
  stageMemoryCandidates(
    seeds: readonly CandidateSeed[],
    now: number,
  ): Promise<{ readonly staged: number; readonly reinforced: number }>;
  advanceMemoryIngestion(params: {
    sessionKey: SessionKey;
    lastRecordedAt: number;
    hashes: readonly string[];
    now: number;
  }): Promise<unknown>;
  reconcileMemoryPromotions(now: number): Promise<unknown>;
  recordMemoryPhaseHits(
    phase: ConsolidationPhase,
    keys: readonly string[],
    now: number,
  ): Promise<unknown>;
  readDurableMemoryFile(
    name: string,
  ): Promise<{ readonly content: string; readonly hash: string } | undefined>;
  publishMemoryRewrite(
    ask: {
      readonly path: string;
      readonly phase: ConsolidationPhase;
      readonly expectedHash: string;
      readonly next: string;
      readonly candidateKeys: readonly string[];
    },
    now: number,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>;
}

/** One tool-free completion the host runs over a private, dropped context. */
export interface ToolFreeAsk {
  readonly prompt: string;
  readonly input: string;
  readonly maximumOutputTokens: number;
  readonly signal: AbortSignal;
}

export interface ConsolidationSweepDependencies {
  readonly store: ConsolidationSweepStore;
  readonly workspaceDirectory: () => string;
  /** The conversations whose History the light phase reads. */
  readonly eligibleConversations: () => readonly SessionKey[];
  readonly historyLines: (sessionKey: SessionKey) => readonly IngestibleHistoryLine[];
  /** The model, or nothing when no brain may stand; the deep phase then takes the append-only path. */
  readonly completeToolFree: ((ask: ToolFreeAsk) => Promise<string | undefined>) | undefined;
  readonly now: () => number;
  /** Hears every committed notebook change, so the index syncs and recall caches clear. */
  readonly onNotebookChanged?: () => void;
}

export interface DeepRewriteDecision {
  readonly result?: ConsolidationResult;
  readonly deepPath: DeepPath;
  readonly notes: readonly string[];
}

/**
 * How the deep phase rewrites MEMORY.md, decided over what the model
 * answered: a plan that parses and validates is applied; anything else —
 * no model, no answer, an unreadable or invalid plan, an application that
 * would lose too much — falls back to the append-only path.
 */
export function decideDeepRewrite(params: {
  readonly existing: string;
  readonly promotions: readonly RankedCandidate[];
  readonly day: string;
  /** The model's raw answer; absent when no model stood or the call failed. */
  readonly raw: string | undefined;
  readonly modelStood: boolean;
}): DeepRewriteDecision {
  const notes: string[] = [];
  let result: ConsolidationResult | undefined;
  let deepPath: DeepPath = DEEP_PATH.NONE;
  if (params.modelStood) {
    const plan = params.raw ? parseConsolidationPlan(params.raw, params.promotions) : undefined;
    const rejection = plan
      ? validateConsolidationPlan({
          previous: params.existing,
          plan,
          promotions: params.promotions,
        })
      : params.raw
        ? "output was not a structured plan"
        : "the model did not answer";
    if (plan && !rejection) {
      result = applyConsolidationPlan({ existingMemory: params.existing, plan, day: params.day });
      if (result) deepPath = DEEP_PATH.MODEL_PLAN;
      else notes.push("rewrite rejected: it would lose too many prior entries or exceed the budget");
    } else if (rejection) {
      notes.push(`rewrite rejected: ${rejection}`);
    }
  } else {
    notes.push("no model stands; using the append-only path");
  }
  if (!result) {
    result = appendOnlyPromotion({
      existingMemory: params.existing,
      promotions: params.promotions,
      day: params.day,
    });
    if (result) deepPath = DEEP_PATH.APPEND_ONLY;
  }
  return { ...(result ? { result } : undefined), deepPath, notes };
}

async function readNoteFiles(workspaceDirectory: string): Promise<NoteFile[]> {
  const directory = path.join(workspaceDirectory, DAILY_NOTES_DIRECTORY);
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch {
    return [];
  }
  const files: NoteFile[] = [];
  for (const name of names) {
    try {
      files.push({ name, content: await fs.readFile(path.join(directory, name), "utf8") });
    } catch {
      // A note that vanished between the listing and the read is read by the next sweep.
    }
  }
  return files;
}

/** Re-reads a promotion's source right before publishing; a source gone or changed is skipped. */
async function rehydrated(
  dependencies: ConsolidationSweepDependencies,
  ranked: RankedCandidate,
): Promise<boolean> {
  const candidate = ranked.candidate;
  if (isConversationCandidate(candidate) && candidate.sourceSessionKey) {
    // SAFETY: the source key was a session key when the candidate was staged.
    const lines = dependencies.historyLines(candidate.sourceSessionKey as SessionKey);
    return lines.some((line) =>
      candidate.sourceEventId
        ? line.eventId === candidate.sourceEventId
        : candidatesDuplicate(line.words, candidate.text),
    );
  }
  const read = await readWorkspaceFile(dependencies.workspaceDirectory(), candidate.path);
  if (!read.ok) return false;
  const lines = read.content.split("\n");
  const slice = lines
    .slice(Math.max(0, candidate.startLine - 1), Math.max(candidate.startLine, candidate.endLine))
    .join(" ");
  const prepared = prepareForIngestion(boundNoteLine(slice));
  return (
    prepared !== undefined && candidatesDuplicate(boundCandidateText(prepared.text), candidate.text)
  );
}

/** One full sweep: light, REM, deep, and the diary. Throws when the store or a read fails; the host reports it. */
export async function runConsolidationSweep(
  dependencies: ConsolidationSweepDependencies,
): Promise<ConsolidationSweepReport> {
  const { store } = dependencies;
  const now = dependencies.now();
  const day = localDayStamp(now);
  const notes: string[] = [];
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    CONSOLIDATION_DEFAULTS.CONSOLIDATION_TIMEOUT_MS * 3,
  );
  try {
    // Light: stage and dedupe recent short-term material; nothing durable is written.
    const held = await store.listMemoryCandidates();
    // The light limit bounds what one sweep stages; the cursor and the
    // seen hashes advance only over the lines actually consumed, so what
    // the budget left behind is read by the next sweep, never lost. The
    // notes have no cursor — a note line already held costs no budget,
    // and one not yet held is read again next sweep — so they take their
    // share first, and the conversations the rest.
    const noteCandidates = noteSeeds(
      await readNoteFiles(dependencies.workspaceDirectory()),
      now,
    ).filter((seed) => !held.some((candidate) => candidatesDuplicate(candidate.text, seed.text)));
    const noteShare = Math.min(
      noteCandidates.length,
      Math.floor(CONSOLIDATION_DEFAULTS.LIGHT_LIMIT * NOTE_BUDGET_SHARE),
    );
    let budget: number = CONSOLIDATION_DEFAULTS.LIGHT_LIMIT - noteShare;
    const advances: { sessionKey: SessionKey; latest: number; hashes: string[] }[] = [];
    let gathered: CandidateSeed[] = noteCandidates.slice(0, noteShare);
    for (const sessionKey of dependencies.eligibleConversations()) {
      const recent = recentHistoryLines(
        dependencies.historyLines(sessionKey),
        await store.memoryIngestionCursor(sessionKey),
        now,
      );
      const seen = new Set(
        await store.memoryIngestionSeen(
          sessionKey,
          recent.map((entry) => entry.hash),
        ),
      );
      const hashes: string[] = [];
      let latest = 0;
      for (const line of ingestibleLines(sessionKey, recent, seen, now)) {
        if (line.seed && budget <= 0) break;
        hashes.push(line.hash);
        latest = Math.max(latest, line.recordedAt);
        if (line.seed) {
          gathered.push(line.seed);
          budget -= 1;
        }
      }
      if (hashes.length > 0) advances.push({ sessionKey, latest, hashes });
    }
    gathered = gathered.concat(noteCandidates.slice(noteShare, noteShare + Math.max(0, budget)));
    const { seeds, deduped } = dedupe(gathered, held);
    const staging = await store.stageMemoryCandidates(seeds, now);
    for (const advance of advances) {
      await store.advanceMemoryIngestion({
        sessionKey: advance.sessionKey,
        lastRecordedAt: advance.latest,
        hashes: advance.hashes,
        now,
      });
    }
    await store.reconcileMemoryPromotions(now);
    const staged = await store.listMemoryCandidates(CANDIDATE_STATUS.STAGED);
    await store.recordMemoryPhaseHits(
      CONSOLIDATION_PHASE.LIGHT,
      staged
        .filter(
          (candidate) =>
            now - candidate.lastSeenAt <= CONSOLIDATION_DEFAULTS.LIGHT_LOOKBACK_DAYS * DAY_MS,
        )
        .map((candidate) => candidate.key),
      now,
    );

    // REM: reflections over the recent week's candidates; a hit for each candidate a theme names.
    const recent = staged.filter(
      (candidate) =>
        now - candidate.lastSeenAt <= CONSOLIDATION_DEFAULTS.REM_LOOKBACK_DAYS * DAY_MS,
    );
    const reflections = remReflections(recent);
    const themes = new Set(reflections.map((reflection) => reflection.theme));
    await store.recordMemoryPhaseHits(
      CONSOLIDATION_PHASE.REM,
      recent
        .filter((candidate) => candidate.tags.some((tag) => themes.has(tag)))
        .map((candidate) => candidate.key),
      now,
    );

    // Deep: rank, gate, rehydrate, plan, validate, publish.
    const ranked = selectDeepPromotions(
      await store.listMemoryCandidates(CANDIDATE_STATUS.STAGED),
      now,
    );
    const promotions: RankedCandidate[] = [];
    for (const candidate of ranked) {
      if (await rehydrated(dependencies, candidate)) promotions.push(candidate);
      else notes.push(`skipped ${candidate.candidate.key}: its source is gone or changed`);
    }
    let deepPath: DeepPath = DEEP_PATH.NONE;
    let result: ConsolidationResult | undefined;
    let promoted = 0;
    const model = dependencies.completeToolFree;
    if (promotions.length > 0) {
      const memory = await store.readDurableMemoryFile(WORKSPACE_FILE.MEMORY);
      const existing = memory?.content ?? "";
      const raw = model
        ? await model({
            prompt: CONSOLIDATION_SYSTEM_PROMPT,
            input: consolidationPrompt(existing, promotions),
            maximumOutputTokens: CONSOLIDATION_OUTPUT_TOKENS,
            signal: controller.signal,
          }).catch((error: Error) => {
            notes.push(`consolidation call failed: ${error.message}`);
            return undefined;
          })
        : undefined;
      const decision = decideDeepRewrite({
        existing,
        promotions,
        day,
        raw,
        modelStood: model !== undefined,
      });
      notes.push(...decision.notes);
      result = decision.result;
      deepPath = decision.deepPath;
      if (result && memory) {
        const published = await store.publishMemoryRewrite(
          {
            path: WORKSPACE_FILE.MEMORY,
            phase: CONSOLIDATION_PHASE.DEEP,
            expectedHash: memory.hash,
            next: result.content,
            candidateKeys: promotions.map((entry) => entry.candidate.key),
          },
          now,
        );
        if (published.ok) {
          promoted = promotions.length;
          dependencies.onNotebookChanged?.();
        } else {
          notes.push(`MEMORY.md not rewritten: ${published.reason}`);
          deepPath = DEEP_PATH.NONE;
          result = undefined;
        }
      }
    }

    // The Dream Diary: reviewable, never a promotion source.
    let narrative: string | undefined;
    let degraded: string | undefined;
    if (model && (staging.staged > 0 || promoted > 0 || reflections.length > 0)) {
      narrative = await model({
        prompt: DREAM_DIARY_SYSTEM_PROMPT,
        input: JSON.stringify({
          day,
          staged: staging.staged,
          reinforced: staging.reinforced,
          reflections: reflections.map((reflection) => reflection.theme),
          promoted,
          highlights: result?.highlights ?? [],
        }),
        maximumOutputTokens: DIARY_OUTPUT_TOKENS,
        signal: controller.signal,
      }).catch(() => undefined);
      if (!narrative) degraded = "the diary narrative could not be generated; counts stand alone";
    }
    const diary = dreamDiaryEntry({
      day,
      staged: staging.staged + staging.reinforced,
      deduped,
      reflections,
      promoted,
      added: result?.added ?? 0,
      merged: result?.merged ?? 0,
      superseded: result?.superseded ?? 0,
      highlights: result?.highlights ?? [],
      deepPath,
      ...(narrative ? { narrative } : undefined),
      ...(degraded ? { degraded } : undefined),
    });
    const dreams = await store.readDurableMemoryFile(DREAMS_FILE);
    let diaryWritten = false;
    if (dreams) {
      const base =
        dreams.content.length === 0 ? `# ${DREAMS_FILE}\n\n` : `${dreams.content.trimEnd()}\n\n`;
      const written = await store.publishMemoryRewrite(
        {
          path: DREAMS_FILE,
          phase: CONSOLIDATION_PHASE.DEEP,
          expectedHash: dreams.hash,
          next: `${base}${diary}`,
          candidateKeys: [],
        },
        now,
      );
      diaryWritten = written.ok;
      if (!written.ok) notes.push(`DREAMS.md not written: ${written.reason}`);
    }
    return {
      day,
      staged: staging.staged,
      reinforced: staging.reinforced,
      deduped,
      reflections: reflections.length,
      promoted,
      deepPath,
      diaryWritten,
      notes,
    };
  } finally {
    clearTimeout(timer);
  }
}
