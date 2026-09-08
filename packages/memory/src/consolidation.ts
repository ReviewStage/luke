/**
 * Consolidation, ported in shape from OpenClaw `b7528507`'s dreaming, in its
 * parts: the candidate shape and its seeds, the recall signals, the
 * six-signal deep ranking and its gates, the promotion and lineage markers,
 * the plan a tool-free model call answers and its validation, application,
 * and append-only fallback, and the REM reflections and Dream Diary. This
 * module names them together for the callers that read consolidation whole.
 */

export {
  boundCandidateText,
  CANDIDATE_ORIGIN,
  CANDIDATE_SESSION_KIND,
  CANDIDATE_STATUS,
  type CandidateOrigin,
  type CandidateSeed,
  type CandidateSessionKind,
  type CandidateStatus,
  CONSOLIDATION_DEFAULTS,
  CONSOLIDATION_PHASE,
  CONVERSATION_PATH_PREFIX,
  type ConsolidationPhase,
  candidateFromSeed,
  candidateKeyFor,
  conversationCandidatePath,
  DREAMS_FILE,
  ingestionQuery,
  isConsolidationCandidateEligible,
  isConversationCandidate,
  isPromotionOriginBlocked,
  type MemoryCandidate,
  memoryCandidateFromWire,
  reinforceCandidate,
} from "./candidate.js";
export {
  DEEP_RANKING_WEIGHTS,
  type DeepRanking,
  passesDeepGates,
  type RankedCandidate,
  rankCandidate,
  selectDeepPromotions,
} from "./deep-ranking.js";
export {
  consolidationJob,
  DREAM_DIARY_SYSTEM_PROMPT,
  type DreamDiaryEntry,
  dreamDiaryEntry,
  type RemReflection,
  remReflections,
} from "./diary.js";
export {
  candidateSourceRef,
  lineageMarker,
  memoryEntries,
  promotedCandidateKeys,
  promotedEntry,
  promotionMarker,
  promotionMarkerKey,
  removePromotedEntries,
} from "./markers.js";
export {
  appendOnlyPromotion,
  applyConsolidationPlan,
  CONSOLIDATION_ACTION,
  CONSOLIDATION_SYSTEM_PROMPT,
  type ConsolidationAction,
  type ConsolidationOperation,
  type ConsolidationPlan,
  type ConsolidationResult,
  consolidationPrompt,
  parseConsolidationPlan,
  validateConsolidationPlan,
} from "./plan.js";
export { candidatesDuplicate, type RecallSignalResult, recallSignalSeeds } from "./signals.js";
export { conceptTags } from "./tokenize.js";
