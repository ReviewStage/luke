import { maximumMemoryQueryLength, NOTEBOOK_MEMORY_TOOL } from "@sidecar/memory";
import type { Session, SessionIdentity } from "@sidecar/session";
import { RECORD_EXTRA_KEYS, type Schema, s } from "@sidecar/wire";
import { BRAIN_TOOL } from "./names.js";
import { toolArguments } from "./tool-module.js";

/**
 * The one tool the read prefetch's planner is offered and forced to call:
 * which of the brain's reads the turn answering a spoken ask will need, named
 * before the developer has finished asking. It is not in the brain's catalog
 * and no policy layer names it, because the model that answers a turn never
 * sees it; it is registered with the hosted service so the service holds its
 * schema and a caller never uploads one. A session is named by its position
 * in the options the planner was shown, never by an id, so nothing the
 * planner writes can reach a session the roster does not hold: the position
 * is resolved here against the identities offered, and one past the end
 * refuses the whole plan.
 */

export const PLAN_READS_TOOL_NAME = "plan_reads";

/** The most reads one plan may name: one transcript and one notebook search. */
export const PLAN_READS_MAXIMUM = 2;

/** The two reads a plan may name, by the tool each becomes in the turn's input. */
export const PREFETCH_READ_KIND = {
  TRANSCRIPT: BRAIN_TOOL.READ_TRANSCRIPT,
  MEMORY: NOTEBOOK_MEMORY_TOOL.SEARCH,
} as const;

type PrefetchReadKind = (typeof PREFETCH_READ_KIND)[keyof typeof PREFETCH_READ_KIND];

const TRANSCRIPT_READ = s.record(
  {
    kind: s.literal(PREFETCH_READ_KIND.TRANSCRIPT),
    session: s.wholeNumber({
      minimum: 1,
      description: "The option number of the session in the list you were shown.",
    }),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

const MEMORY_READ = s.record(
  {
    kind: s.literal(PREFETCH_READ_KIND.MEMORY),
    query: s.text({
      max: maximumMemoryQueryLength,
      description: "What to search the notebook for.",
    }),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

export const PLAN_READS_INPUT = s.record(
  {
    reads: s.array(s.union([TRANSCRIPT_READ, MEMORY_READ]), {
      max: PLAN_READS_MAXIMUM,
      description:
        "The reads the answer will certainly need: at most one session transcript and one " +
        "notebook search. Empty when none is needed.",
    }),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

/** The planner's tool as a registry carries it: its name, its words, and the schema its fields are declared in. */
export interface PlanReadsTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Schema<unknown>;
}

export const PLAN_READS_TOOL = {
  name: PLAN_READS_TOOL_NAME,
  description:
    "Plan the reads the answer to the developer's unfinished ask will certainly need. Name a " +
    "session transcript only when the ask is about what one listed session is doing, did, or " +
    "said, by its option number; name a notebook search only for prior decisions, people, " +
    "dates, or preferences. Plan nothing when in doubt.",
  inputSchema: PLAN_READS_INPUT,
} as const satisfies PlanReadsTool;

/** One session as the planner is shown it: a position to name it by and the fields that tell it apart. */
export interface PrefetchSessionOption {
  option: number;
  title: string;
  provider: string;
  status: string;
}

/** The sessions offered to one plan: the options the planner reads, and the identity each position resolves to. */
export interface OfferedSessions {
  options: readonly PrefetchSessionOption[];
  identities: readonly SessionIdentity[];
}

/** The roster's sessions as the planner is shown them, numbered from one in roster order. */
export function offeredSessions(sessions: readonly Session[]): OfferedSessions {
  return {
    options: sessions.map((session, index) => ({
      option: index + 1,
      title: session.title,
      provider: session.provider.displayName,
      status: session.status,
    })),
    identities: sessions.map((session) => ({
      providerId: session.providerId,
      providerSessionId: session.providerSessionId,
    })),
  };
}

export type PlannedRead =
  | { kind: typeof PREFETCH_READ_KIND.TRANSCRIPT; identity: SessionIdentity }
  | { kind: typeof PREFETCH_READ_KIND.MEMORY; query: string };

/**
 * The reads one plan call named, resolved against the sessions offered, or
 * nothing when the call is not a plan: arguments the schema refuses, a
 * position no offered session stands at. A second read of a kind already
 * named is dropped rather than refused, since the first already says what
 * the plan wanted.
 */
export function planReadsFromCall(
  argumentsJson: string,
  offered: readonly SessionIdentity[],
): readonly PlannedRead[] | undefined {
  const parsed = PLAN_READS_INPUT.parse(toolArguments(argumentsJson));
  if (!parsed) return undefined;
  const planned: PlannedRead[] = [];
  const named = new Set<PrefetchReadKind>();
  for (const read of parsed.reads) {
    if (named.has(read.kind)) continue;
    if (read.kind === PREFETCH_READ_KIND.TRANSCRIPT) {
      const identity = offered[read.session - 1];
      if (!identity) return undefined;
      planned.push({ kind: read.kind, identity });
    } else {
      planned.push({ kind: read.kind, query: read.query });
    }
    named.add(read.kind);
  }
  return planned;
}
