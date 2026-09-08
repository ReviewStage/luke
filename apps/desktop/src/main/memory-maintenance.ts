import fs from "node:fs/promises";
import path from "node:path";
import type { BrainFlushInput } from "@sidecar/brain";
import { REFUSAL_REASON, runMemoryHousekeeping } from "@sidecar/brain";
import {
  appendOnlyPromotion,
  applyConsolidationPlan,
  boundCandidateText,
  CANDIDATE_ORIGIN,
  CANDIDATE_SESSION_KIND,
  CANDIDATE_STATUS,
  type CandidateOrigin,
  type CandidateSeed,
  CONSOLIDATION_DEFAULTS,
  CONSOLIDATION_PHASE,
  CONSOLIDATION_SYSTEM_PROMPT,
  type ConsolidationResult,
  candidatesDuplicate,
  consolidationPrompt,
  conversationCandidatePath,
  DREAM_DIARY_SYSTEM_PROMPT,
  DREAMS_FILE,
  dreamDiaryEntry,
  type HousekeepingPrompt,
  hashText,
  ingestionQuery,
  isConversationCandidate,
  localDayStamp,
  MEMORY_HOUSEKEEPING_OUTCOME,
  type MemoryCandidate,
  type MemoryHousekeepingResult,
  memoryFlushPrompt,
  parseConsolidationPlan,
  prepareForIngestion,
  type RankedCandidate,
  remReflections,
  resetCapturePrompt,
  selectDeepPromotions,
  validateConsolidationPlan,
} from "@sidecar/memory";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/realtime";
import {
  DAILY_NOTES_DIRECTORY,
  readWorkspaceFile,
  WORKSPACE_FILE,
  writeWorkspaceFile,
} from "@sidecar/runtime";
import {
  type AgentRuntime,
  CONTEXT_INPUT_KIND,
  CONVERSATION_KIND,
  type ConversationRecord,
  conversationKindOf,
  RUN_END_REASON,
  type SessionKey,
} from "@sidecar/runtime-contracts";
import type {
  MemoryForgetAsk,
  MemoryForgetReport,
  RuntimeStoreClient,
} from "@sidecar/runtime-store";
import { ACT_RESULT_STATUS, type WireRecord } from "@sidecar/wire";

/**
 * Memory maintenance as the desktop composes it: the pre-compaction flush
 * hook each eligible conversation's brain is handed, the capture run before
 * an eligible private conversation starts fresh, the daily consolidation
 * sweep (light, REM, deep), and source-aware forgetting. The notebook's
 * files stay the source of truth; the store's worker keeps the candidates,
 * cursors, tombstones, preimages, and flush state, and writes MEMORY.md and
 * DREAMS.md behind its own conflict check. Every model call here is a
 * tool-free or workspace-only run over a private context that is dropped at
 * its end, on the developer's own key or through Luke's service, and nothing
 * a model wrote reaches durable memory except through the validation below
 * or the deterministic fallback.
 */

export interface MemoryMaintenanceDependencies {
  persistent: boolean;
  client: () => RuntimeStoreClient;
  /** A runtime for the housekeeping and consolidation runs, or nothing when no brain may stand. */
  createRuntime: () => AgentRuntime | undefined;
  workspaceDirectory: () => string;
  conversationDirectory: () => readonly ConversationRecord[];
  isTemporary: (sessionKey: SessionKey) => boolean;
  /** One conversation's retained History lines, the light phase's source. */
  historyLines: (sessionKey: SessionKey) => readonly ConversationEntry[];
  /** Runs work on the background lane, the shared budget consolidation completions spend. */
  background: <T>(work: () => Promise<T>) => Promise<T>;
  now: () => number;
  createId: () => string;
  report: (message: string) => void;
  /** Hears every committed notebook change, so the index syncs and recall caches clear. */
  onNotebookChanged?: () => void;
}

export interface ConsolidationSweepReport {
  readonly day: string;
  readonly staged: number;
  readonly reinforced: number;
  readonly deduped: number;
  readonly reflections: number;
  readonly promoted: number;
  readonly deepPath: string;
  readonly diaryWritten: boolean;
  readonly notes: readonly string[];
}

export interface MemoryMaintenance {
  /** The flush hook for one conversation, or nothing for one that never flushes. */
  flushHookFor: (
    sessionKey: SessionKey,
  ) => ((input: BrainFlushInput) => Promise<MemoryHousekeepingResult>) | undefined;
  /** Whether a conversation's reset captures first: main and the developer's durable private threads. */
  capturesOnReset: (sessionKey: SessionKey) => boolean;
  /** The capture run before a reset, over a copy of the conversation's context; never blocks the reset's outcome. */
  captureBeforeReset: (
    sessionKey: SessionKey,
    items: readonly WireRecord[],
  ) => Promise<MemoryHousekeepingResult>;
  /** One full sweep: light, REM, deep; nothing on a run with no store. */
  runConsolidation: () => Promise<ConsolidationSweepReport | undefined>;
  /** Source-aware forgetting; nothing on a run with no store. */
  forget: (ask: MemoryForgetAsk) => Promise<MemoryForgetReport | undefined>;
}

/** One History line as the light phase reads it: its hash, when it was said, and the seed it yields, if any. */
interface IngestibleLine {
  readonly hash: string;
  readonly recordedAt: number;
  readonly seed?: CandidateSeed;
}

interface DedupedSeeds {
  readonly seeds: CandidateSeed[];
  readonly deduped: number;
}

export const DEEP_PATH = {
  MODEL_PLAN: "validated model plan",
  APPEND_ONLY: "append-only fallback",
  NONE: "nothing promoted",
} as const;

/** How much a day's ingestion counts for; three recurring days pass the score gate, one does not. */
const INGESTION_SCORE = 0.8;
const DAY_MS = 24 * 60 * 60 * 1000;
const DIARY_OUTPUT_TOKENS = 400;
const CONSOLIDATION_OUTPUT_TOKENS = 4_000;

function originOf(kind: ConversationEntry["kind"]): CandidateOrigin {
  switch (kind) {
    case CONVERSATION_ENTRY_KIND.TYPED_ASK:
    case CONVERSATION_ENTRY_KIND.SPOKEN_ASK:
      return CANDIDATE_ORIGIN.USER;
    case CONVERSATION_ENTRY_KIND.REPLY:
    case CONVERSATION_ENTRY_KIND.ANNOUNCEMENT:
      return CANDIDATE_ORIGIN.AGENT;
    default:
      // An act's narration, a child's or a system's words relayed into the
      // thread: evidence, but never trusted by repetition.
      return CANDIDATE_ORIGIN.SYSTEM;
  }
}

function interactive(sessionKey: SessionKey): boolean {
  const kind = conversationKindOf(sessionKey);
  return kind === CONVERSATION_KIND.MAIN || kind === CONVERSATION_KIND.THREAD;
}

export function wireMemoryMaintenance(
  dependencies: MemoryMaintenanceDependencies,
): MemoryMaintenance {
  const workspace = () => ({
    read: (name: string) => readWorkspaceFile(dependencies.workspaceDirectory(), name),
    write: (name: string, content: string) =>
      writeWorkspaceFile(dependencies.workspaceDirectory(), name, content),
  });

  const eligible = (sessionKey: SessionKey): boolean =>
    dependencies.persistent && interactive(sessionKey) && !dependencies.isTemporary(sessionKey);

  const housekeeping = async (
    sessionKey: SessionKey,
    items: readonly WireRecord[],
    prompt: HousekeepingPrompt,
    dateStamp: string,
    signal: AbortSignal,
  ): Promise<MemoryHousekeepingResult> => {
    const runtime = dependencies.createRuntime();
    if (!runtime) {
      return {
        outcome: MEMORY_HOUSEKEEPING_OUTCOME.SKIPPED,
        writes: 0,
        reason: "no brain stands to run it",
      };
    }
    const result = await runMemoryHousekeeping({
      runtime,
      items,
      prompt,
      dateStamp,
      workspace: workspace(),
      signal,
      runId: dependencies.createId(),
    });
    if (result.writes > 0) dependencies.onNotebookChanged?.();
    return result;
  };

  const flushHookFor: MemoryMaintenance["flushHookFor"] = (sessionKey) => {
    if (!eligible(sessionKey)) return undefined;
    return async (input) => {
      const day = localDayStamp(dependencies.now());
      const result = await housekeeping(
        sessionKey,
        input.items,
        memoryFlushPrompt(day),
        day,
        input.signal,
      );
      try {
        await dependencies.client().recordMemoryFlush(sessionKey, {
          compactionCount: input.compactionCount,
          outcome: result.outcome,
          flushedAt: dependencies.now(),
        });
      } catch (error) {
        dependencies.report(
          `Memory flush state could not be recorded: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return result;
    };
  };

  const captureBeforeReset: MemoryMaintenance["captureBeforeReset"] = async (sessionKey, items) => {
    if (!eligible(sessionKey)) {
      return {
        outcome: MEMORY_HOUSEKEEPING_OUTCOME.SKIPPED,
        writes: 0,
        reason: "not an eligible private conversation",
      };
    }
    if (items.length === 0) {
      return { outcome: MEMORY_HOUSEKEEPING_OUTCOME.NOTHING_TO_STORE, writes: 0 };
    }
    const day = localDayStamp(dependencies.now());
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      CONSOLIDATION_DEFAULTS.CONSOLIDATION_TIMEOUT_MS,
    );
    try {
      return await housekeeping(sessionKey, items, resetCapturePrompt(day), day, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  };

  /** One tool-free completion over a fresh, dropped context; nothing when the model did not answer. */
  const toolFreeCompletion = async (
    runtime: AgentRuntime,
    prompt: string,
    input: string,
    maximumOutputTokens: number,
    signal: AbortSignal,
  ): Promise<string | undefined> => {
    const opened = await runtime.openContext(undefined, JSON.stringify({}));
    try {
      const run = runtime.start({
        runId: dependencies.createId(),
        context: opened.context,
        tools: {
          execute: async () => ({
            outputJson: JSON.stringify({
              status: ACT_RESULT_STATUS.REJECTED,
              reason: REFUSAL_REASON.NOT_OFFERED,
            }),
            status: ACT_RESULT_STATUS.REJECTED,
          }),
        },
        toolSchemas: [],
        prompt,
        input: [{ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: input }],
        ephemeral: () => [],
        maximumOutputTokens,
        signal,
        onEvent: () => undefined,
      });
      const end = await run.done;
      return end.reason === RUN_END_REASON.COMPLETED && end.text.trim().length > 0
        ? end.text
        : undefined;
    } finally {
      await Promise.resolve(opened.context.dispose()).catch(() => undefined);
    }
  };

  const eligibleConversations = (): SessionKey[] =>
    dependencies
      .conversationDirectory()
      .filter(
        (record) =>
          interactive(record.sessionKey) &&
          record.archivedAt === undefined &&
          !dependencies.isTemporary(record.sessionKey),
      )
      .map((record) => record.sessionKey);

  /** Near-duplicate seeds fold onto the first of their kind so the store reinforces one candidate. */
  const dedupe = (seeds: CandidateSeed[], held: readonly MemoryCandidate[]): DedupedSeeds => {
    const kept: CandidateSeed[] = [];
    let deduped = 0;
    for (const seed of seeds) {
      const existing = held.find((candidate) => candidatesDuplicate(candidate.text, seed.text));
      if (existing?.queries.includes(seed.query)) {
        // The same day's signal for a candidate already holding it adds no evidence.
        deduped += 1;
        continue;
      }
      if (existing) {
        kept.push({
          ...seed,
          text: existing.text,
          path: existing.path,
          startLine: existing.startLine,
          endLine: existing.endLine,
        });
        deduped += 1;
        continue;
      }
      const earlier = kept.find((other) => candidatesDuplicate(other.text, seed.text));
      if (earlier) {
        kept.push({
          ...seed,
          text: earlier.text,
          path: earlier.path,
          startLine: earlier.startLine,
          endLine: earlier.endLine,
        });
        deduped += 1;
        continue;
      }
      kept.push(seed);
    }
    return { seeds: kept, deduped };
  };

  /**
   * The light phase's conversation lines since the cursor, oldest first, each
   * with its hash and the seed it yields (none when redaction empties it or
   * the line was seen before). The sweep consumes them under its budget and
   * advances the cursor only over the lines it consumed, so a line the
   * budget left behind is read again by the next sweep rather than lost.
   */
  const conversationLines = async (
    client: RuntimeStoreClient,
    sessionKey: SessionKey,
    now: number,
  ): Promise<IngestibleLine[]> => {
    const cursor = await client.memoryIngestionCursor(sessionKey);
    const since = Math.max(cursor, now - CONSOLIDATION_DEFAULTS.LIGHT_LOOKBACK_DAYS * DAY_MS);
    const lines = dependencies
      .historyLines(sessionKey)
      .filter((entry) => (entry.recordedAt ?? 0) > since)
      .sort((a, b) => (a.recordedAt ?? 0) - (b.recordedAt ?? 0));
    const hashed = lines.map((entry) => ({
      entry,
      hash: hashText(`${entry.kind}\n${entry.words}`),
    }));
    const seen = new Set(
      await client.memoryIngestionSeen(
        sessionKey,
        hashed.map((line) => line.hash),
      ),
    );
    const result: IngestibleLine[] = [];
    for (const { entry, hash } of hashed) {
      const recordedAt = entry.recordedAt ?? now;
      if (seen.has(hash)) {
        result.push({ hash, recordedAt });
        continue;
      }
      const prepared = prepareForIngestion(entry.words);
      if (!prepared) {
        result.push({ hash, recordedAt });
        continue;
      }
      result.push({
        hash,
        recordedAt,
        seed: {
          text: prepared.text,
          path: conversationCandidatePath(sessionKey),
          startLine: 0,
          endLine: 0,
          origin: originOf(entry.kind),
          sessionKind: CANDIDATE_SESSION_KIND.INTERACTIVE,
          sourceSessionKey: sessionKey,
          ...(entry.eventId ? { sourceEventId: entry.eventId } : undefined),
          query: ingestionQuery(localDayStamp(recordedAt)),
          score: INGESTION_SCORE,
          day: localDayStamp(recordedAt),
        },
      });
    }
    return result;
  };

  /** The light phase's note seeds: each bullet or line of the recent dated notes, the diary excluded. */
  const noteSeeds = async (now: number): Promise<CandidateSeed[]> => {
    const directory = path.join(dependencies.workspaceDirectory(), DAILY_NOTES_DIRECTORY);
    let names: string[];
    try {
      names = await fs.readdir(directory);
    } catch {
      return [];
    }
    const seeds: CandidateSeed[] = [];
    for (const name of names.sort()) {
      const match = /^(\d{4}-\d{2}-\d{2})(?:-[a-z0-9-]+)?\.md$/u.exec(name);
      if (!match?.[1]) continue;
      const day = match[1];
      const dayMs = Date.parse(`${day}T00:00:00`);
      if (
        !Number.isFinite(dayMs) ||
        now - dayMs > CONSOLIDATION_DEFAULTS.LIGHT_LOOKBACK_DAYS * DAY_MS
      ) {
        continue;
      }
      let content: string;
      try {
        content = await fs.readFile(path.join(directory, name), "utf8");
      } catch {
        continue;
      }
      content.split("\n").forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith("<!--")) return;
        const prepared = prepareForIngestion(trimmed.replace(/^[-*+]\s+/u, ""));
        if (!prepared || prepared.text.length < 12) return;
        seeds.push({
          text: prepared.text,
          path: `${DAILY_NOTES_DIRECTORY}/${name}`,
          startLine: index + 1,
          endLine: index + 1,
          origin: CANDIDATE_ORIGIN.AGENT,
          sessionKind: CANDIDATE_SESSION_KIND.INTERACTIVE,
          query: ingestionQuery(day),
          score: INGESTION_SCORE,
          day,
        });
      });
    }
    return seeds;
  };

  /** Re-reads a promotion's source right before publishing; a source gone or changed is skipped. */
  const rehydrated = async (ranked: RankedCandidate): Promise<boolean> => {
    const candidate = ranked.candidate;
    if (isConversationCandidate(candidate) && candidate.sourceSessionKey) {
      // SAFETY: the source key was a session key when the candidate was staged.
      const lines = dependencies.historyLines(candidate.sourceSessionKey as SessionKey);
      return lines.some((entry) =>
        candidate.sourceEventId
          ? entry.eventId === candidate.sourceEventId
          : candidatesDuplicate(entry.words, candidate.text),
      );
    }
    const read = await readWorkspaceFile(dependencies.workspaceDirectory(), candidate.path);
    if (!read.ok) return false;
    const lines = read.content.split("\n");
    const slice = lines
      .slice(Math.max(0, candidate.startLine - 1), Math.max(candidate.startLine, candidate.endLine))
      .join(" ");
    const prepared = prepareForIngestion(slice.replace(/^[-*+]\s+/u, ""));
    return (
      prepared !== undefined &&
      candidatesDuplicate(boundCandidateText(prepared.text), candidate.text)
    );
  };

  const runConsolidation: MemoryMaintenance["runConsolidation"] = () => {
    if (!dependencies.persistent) return Promise.resolve(undefined);
    return dependencies.background(async () => {
      const client = dependencies.client();
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
        const held = await client.listMemoryCandidates();
        // The light limit bounds what one sweep stages; the cursor and the
        // seen hashes advance only over the lines actually consumed, so what
        // the budget left behind is read by the next sweep, never lost.
        let budget: number = CONSOLIDATION_DEFAULTS.LIGHT_LIMIT;
        const advances: { sessionKey: SessionKey; latest: number; hashes: string[] }[] = [];
        let gathered: CandidateSeed[] = [];
        for (const sessionKey of eligibleConversations()) {
          const lines = await conversationLines(client, sessionKey, now);
          const hashes: string[] = [];
          let latest = 0;
          for (const line of lines) {
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
        gathered = gathered.concat((await noteSeeds(now)).slice(0, Math.max(0, budget)));
        const { seeds, deduped } = dedupe(gathered, held);
        const staging = await client.stageMemoryCandidates(seeds, now);
        for (const advance of advances) {
          await client.advanceMemoryIngestion({
            sessionKey: advance.sessionKey,
            lastRecordedAt: advance.latest,
            hashes: advance.hashes,
            now,
          });
        }
        await client.reconcileMemoryPromotions(now);
        const staged = await client.listMemoryCandidates(CANDIDATE_STATUS.STAGED);
        await client.recordMemoryPhaseHits(
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
        await client.recordMemoryPhaseHits(
          CONSOLIDATION_PHASE.REM,
          recent
            .filter((candidate) => candidate.tags.some((tag) => themes.has(tag)))
            .map((candidate) => candidate.key),
          now,
        );

        // Deep: rank, gate, rehydrate, plan, validate, publish.
        const ranked = selectDeepPromotions(
          await client.listMemoryCandidates(CANDIDATE_STATUS.STAGED),
          now,
        );
        const promotions: RankedCandidate[] = [];
        for (const candidate of ranked) {
          if (await rehydrated(candidate)) promotions.push(candidate);
          else notes.push(`skipped ${candidate.candidate.key}: its source is gone or changed`);
        }
        let deepPath: string = DEEP_PATH.NONE;
        let result: ConsolidationResult | undefined;
        let promoted = 0;
        const runtime = dependencies.createRuntime();
        if (promotions.length > 0) {
          const memory = await client.readDurableMemoryFile(WORKSPACE_FILE.MEMORY);
          const existing = memory?.content ?? "";
          if (runtime) {
            const raw = await toolFreeCompletion(
              runtime,
              CONSOLIDATION_SYSTEM_PROMPT,
              consolidationPrompt(existing, promotions),
              CONSOLIDATION_OUTPUT_TOKENS,
              controller.signal,
            ).catch((error: Error) => {
              notes.push(`consolidation call failed: ${error.message}`);
              return undefined;
            });
            const plan = raw ? parseConsolidationPlan(raw, promotions) : undefined;
            const rejection = plan
              ? validateConsolidationPlan({ previous: existing, plan, promotions })
              : raw
                ? "output was not a structured plan"
                : "the model did not answer";
            if (plan && !rejection) {
              result = applyConsolidationPlan({ existingMemory: existing, plan, day });
              if (result) deepPath = DEEP_PATH.MODEL_PLAN;
              else
                notes.push(
                  "rewrite rejected: it would lose too many prior entries or exceed the budget",
                );
            } else if (rejection) {
              notes.push(`rewrite rejected: ${rejection}`);
            }
          } else {
            notes.push("no model stands; using the append-only path");
          }
          if (!result) {
            result = appendOnlyPromotion({ existingMemory: existing, promotions, day });
            if (result) deepPath = DEEP_PATH.APPEND_ONLY;
          }
          if (result && memory) {
            const published = await client.publishMemoryRewrite(
              {
                path: WORKSPACE_FILE.MEMORY,
                phase: CONSOLIDATION_PHASE.DEEP,
                expectedHash: memory.hash,
                next: result.content,
                candidateKeys: promotions.map((ranked) => ranked.candidate.key),
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
        if (runtime && (staging.staged > 0 || promoted > 0 || reflections.length > 0)) {
          narrative = await toolFreeCompletion(
            runtime,
            DREAM_DIARY_SYSTEM_PROMPT,
            JSON.stringify({
              day,
              staged: staging.staged,
              reinforced: staging.reinforced,
              reflections: reflections.map((reflection) => reflection.theme),
              promoted,
              highlights: result?.highlights ?? [],
            }),
            DIARY_OUTPUT_TOKENS,
            controller.signal,
          ).catch(() => undefined);
          if (!narrative)
            degraded = "the diary narrative could not be generated; counts stand alone";
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
        const dreams = await client.readDurableMemoryFile(DREAMS_FILE);
        let diaryWritten = false;
        if (dreams) {
          const base =
            dreams.content.length === 0 ? "# DREAMS.md\n\n" : `${dreams.content.trimEnd()}\n\n`;
          const written = await client.publishMemoryRewrite(
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
      } catch (error) {
        dependencies.report(
          `Memory consolidation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
      } finally {
        clearTimeout(timer);
      }
    });
  };

  const forget: MemoryMaintenance["forget"] = async (ask) => {
    if (!dependencies.persistent) return undefined;
    const report = await dependencies.client().forgetMemorySources(ask, dependencies.now());
    dependencies.onNotebookChanged?.();
    for (const limitation of report.limitations) {
      dependencies.report(`Memory forget limitation: ${limitation}`);
    }
    return report;
  };

  return {
    flushHookFor,
    capturesOnReset: eligible,
    captureBeforeReset,
    runConsolidation,
    forget,
  };
}
