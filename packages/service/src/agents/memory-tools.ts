import type { DatabaseServices } from "@luke/database/core/query";
import {
  listMemories,
  MEMORY_OUTCOME,
  rememberMemory,
  type StoredMemory,
} from "@luke/database/models/memory-store";
import { MEMORY_BOUNDS, memoryIdSchema } from "@luke/features/memory-wire";
import { describeWire } from "@luke/wire/effect";
import { Effect, Result, Schema } from "effect";
import { ACTION_RESULT_STATUS, type UnparsedWireValue, type WireRecord } from "../core.js";
import { logStoreFailure, type StoreFailure } from "../http/store-failure.js";
import { AGENT_TOOL } from "./agent-runtime/tools.js";

/**
 * memory-tools.ts -- the planning model's `remember` and `recall`: the workspace's shared memory of settled facts, kept and searched from planning calls.
 *
 * The planning model decides what is worth keeping and when to look, and
 * nothing asks first; Settings is where members read and forget what was
 * kept. Both tools act in the workspace of the plan the call belongs to, and
 * keep a memory as the words of the member the call was admitted for; the
 * model names neither, so no input carries a workspace or an account. Every
 * member's calls in the workspace share the one memory, and no plan in
 * another workspace reads it. A memory is prior context, not a rule: the call in progress
 * wins, and a memory it contradicts is corrected in place through
 * `replaces`. Words that look like a credential are refused before the
 * store is reached, so no key, token, or password is ever kept. Every
 * outcome, a store that cannot be reached included, is a result the model
 * reads, so a memory that fails never fails the turn. Recall ranks the
 * workspace's memories, at most `MEMORY_BOUNDS.MAX_MEMORIES` of them, by how
 * many of the query's words each holds: the bound keeps that a read of one
 * workspace's rows, so no index or embedding stands behind it.
 */

/** What a memory call acts in: the plan's workspace, and the member the call was admitted for. */
export interface MemoryCall {
  readonly workspaceId: string;
  readonly userId: string;
}

const MEMORY_TOOL_BOUNDS = {
  /** The most memories one recall hands back. */
  RECALL_RESULTS: 8,
  /** The longest query read; a query is a few words, never a passage. */
  QUERY_CHARS: 300,
  /** The most distinct words of a query matched. */
  QUERY_WORDS: 16,
} as const;

/** Words too common to tell one memory from another. */
const COMMON_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "do",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "the",
  "to",
  "use",
  "we",
  "what",
  "with",
]);

/**
 * Shapes a credential takes: a private key block, a provider's token by its
 * prefix, a signed token, a URL carrying a password, a secret assigned to a
 * name, and a long opaque run mixing cases and digits as generated keys do.
 * A commit hash or a UUID, all lower case, is none of them.
 */
const CREDENTIAL_SHAPES: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/u,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/u,
  /\bglpat-[A-Za-z0-9_-]{20,}/u,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bAIza[A-Za-z0-9_-]{30,}/u,
  /\bnpm_[A-Za-z0-9]{30,}/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/u,
  /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/iu,
  /\b(?:password|passwd|passphrase|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)\b\s*[:=]\s*\S{6,}/iu,
];

/** A run long and mixed enough to be a generated secret rather than a word. */
const OPAQUE_RUN = /[A-Za-z0-9+/=_-]{32,}/gu;

const REMEMBER_INPUT = Schema.Struct({
  text: describeWire(
    Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(MEMORY_BOUNDS.MAX_CHARS)),
    "The fact or convention, as one self-contained statement a later plan can read without " +
      'this call, such as "The web server\'s tests run on PGlite through `test:store`."',
  ),
  replaces: Schema.optionalKey(
    describeWire(
      memoryIdSchema,
      "The id of the memory this one corrects, as recall answered it; leave it out for a new memory.",
    ),
  ),
});

const RECALL_INPUT = Schema.Struct({
  query: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(Schema.isMaxLength(MEMORY_TOOL_BOUNDS.QUERY_CHARS)),
      "A few words naming what to look for, such as the area, tool, or convention at hand; " +
        "leave it out for the memories kept most recently.",
    ),
  ),
});

const readRemember = Schema.decodeUnknownResult(REMEMBER_INPUT);
const readRecall = Schema.decodeUnknownResult(RECALL_INPUT);

/** Why a memory call did nothing, in words the model can act on. */
const MEMORY_REFUSAL = {
  UNREADABLE_REMEMBER: `Not remembered: give the memory as text of at most ${MEMORY_BOUNDS.MAX_CHARS} characters.`,
  UNREADABLE_RECALL: `Not recalled: give the query as text of at most ${MEMORY_TOOL_BOUNDS.QUERY_CHARS} characters.`,
  CREDENTIAL:
    "Not remembered: it looks like it holds a credential. Never keep a key, token, or " +
    "password; keep the fact without it.",
  NOT_FOUND:
    "Not remembered: the memory it replaces no longer exists, as a member may have " +
    "forgotten it. Remember it without replaces if it still matters.",
  FULL:
    `Not remembered: the workspace already holds ${MEMORY_BOUNDS.MAX_MEMORIES} memories. ` +
    "Correct an existing memory with replaces instead.",
  UNAVAILABLE: "Memory is unavailable right now; carry on without it.",
} as const;

/** The tools as a planning model is offered them: each its name, its words, and its input schema. */
export const REMEMBER_TOOL = {
  name: AGENT_TOOL.REMEMBER,
  description:
    "Keep a fact or convention for the workspace's later plans, in any repository. Every member " +
    "of the workspace shares what you keep: a decision the team settled, how the team builds, " +
    "tests, or ships, a constraint someone stated, or a fact you confirmed in the code that a " +
    "later plan would otherwise have to rediscover. Keep only what was settled, will still hold " +
    "next time, and helps the team, never a guess, an idea still being weighed, this plan's own " +
    "task detail, a remark personal to one member, or anything that would be a credential, key, " +
    "token, or password. When what was said contradicts a memory recall answered, pass that " +
    "memory's id as replaces with the corrected statement, so the old one is rewritten rather " +
    "than kept beside it. Do it quietly: never ask the developer whether to keep something and " +
    "never mention a memory you kept unless they ask. Answers `accepted` with the outcome " +
    "(kept, already_kept, corrected) and the memory, or `rejected` with the reason.",
  inputSchema: REMEMBER_INPUT,
} as const;

export const RECALL_TOOL = {
  name: AGENT_TOOL.RECALL,
  description:
    "Search what you remembered from the workspace's earlier planning calls, any member's: " +
    "settled facts and conventions about the team's work. Call it once the task comes into focus, with a few words for " +
    "the area at hand, and again when a new area comes up; with no query it answers the " +
    "memories kept most recently. Treat what it answers as prior context, not as rules: the " +
    "developer's words in this call win, and a memory they contradict is corrected with " +
    "remember's replaces. Answers `accepted` with the matching memories, each with its id and " +
    "when it was last kept, and how many memories the workspace holds.",
  inputSchema: RECALL_INPUT,
} as const;

/** Both tools by name, which only the planning model's own session may run. */
export const MEMORY_TOOL_NAMES: ReadonlySet<string> = new Set([
  REMEMBER_TOOL.name,
  RECALL_TOOL.name,
]);

function rejected(reason: string): WireRecord {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** A memory as the model reads it. */
function memoryRecord(memory: StoredMemory): WireRecord {
  return { id: memory.id, text: memory.text, updatedAt: new Date(memory.updatedAt).toISOString() };
}

/** Whether words look like they hold a credential, so they are never kept. */
function looksLikeCredential(text: string): boolean {
  if (CREDENTIAL_SHAPES.some((shape) => shape.test(text))) return true;
  return (text.match(OPAQUE_RUN) ?? []).some(
    (run) => /[a-z]/u.test(run) && /[A-Z]/u.test(run) && /[0-9]/u.test(run),
  );
}

/** A text's words as recall compares them: lower case, letters and digits alone. */
function wordsOf(text: string): readonly string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * The memories a query finds, best first: each scored by how many of the
 * query's distinct words begin one of its own, so "deploy" finds
 * "deployment", ties going to the one kept most recently. A query with no
 * telling word answers the most recent; one that finds nothing answers none.
 */
function rankMemories(
  memories: readonly StoredMemory[],
  query: string | undefined,
): readonly StoredMemory[] {
  const asked = [...new Set(wordsOf(query ?? ""))]
    .filter((word) => !COMMON_WORDS.has(word))
    .slice(0, MEMORY_TOOL_BOUNDS.QUERY_WORDS);
  if (asked.length === 0) return memories.slice(0, MEMORY_TOOL_BOUNDS.RECALL_RESULTS);
  return memories
    .map((memory, recency) => {
      const own = wordsOf(memory.text);
      const score = asked.filter((word) => own.some((held) => held.startsWith(word))).length;
      return { memory, score, recency };
    })
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score || a.recency - b.recency)
    .slice(0, MEMORY_TOOL_BOUNDS.RECALL_RESULTS)
    .map((scored) => scored.memory);
}

/** A store that could not be reached is the one refusal, logged for the operator and said to the model, so the turn carries on. */
const orUnavailable = <R>(
  effect: Effect.Effect<WireRecord, StoreFailure, R>,
): Effect.Effect<WireRecord, never, R> =>
  Effect.catch(effect, (failure) =>
    Effect.as(logStoreFailure(failure), rejected(MEMORY_REFUSAL.UNAVAILABLE)),
  );

/** One call of `remember` in the call's workspace, as the member's words: the memory kept or corrected, or why nothing was. */
export function runRemember(
  call: MemoryCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  const asked = readRemember(input);
  if (Result.isFailure(asked)) return Effect.succeed(rejected(MEMORY_REFUSAL.UNREADABLE_REMEMBER));
  const { text, replaces } = asked.success;
  if (looksLikeCredential(text)) return Effect.succeed(rejected(MEMORY_REFUSAL.CREDENTIAL));
  return orUnavailable(
    Effect.map(
      rememberMemory(call.workspaceId, call.userId, text, replaces),
      (outcome): WireRecord => {
        switch (outcome.kind) {
          case MEMORY_OUTCOME.NOT_FOUND:
            return rejected(MEMORY_REFUSAL.NOT_FOUND);
          case MEMORY_OUTCOME.FULL:
            return rejected(MEMORY_REFUSAL.FULL);
          default:
            return {
              status: ACTION_RESULT_STATUS.ACCEPTED,
              outcome: outcome.kind,
              memory: memoryRecord(outcome.memory),
            };
        }
      },
    ),
  );
}

/** One call of `recall` in the call's workspace: its memories the query finds, and how many it holds. */
export function runRecall(
  call: MemoryCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  const asked = readRecall(input);
  if (Result.isFailure(asked)) return Effect.succeed(rejected(MEMORY_REFUSAL.UNREADABLE_RECALL));
  return orUnavailable(
    Effect.map(listMemories(call.workspaceId), (memories) => ({
      status: ACTION_RESULT_STATUS.ACCEPTED,
      memories: rankMemories(memories, asked.success.query).map(memoryRecord),
      total: memories.length,
    })),
  );
}
