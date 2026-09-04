import { SESSION_STATUS, type SessionStatus } from "@sidecar/session";
import { isRecord, isWireString, text, type UnparsedWireValue } from "@sidecar/wire";
import { BRAIN_WAKE_HOOK } from "./brain-events.js";

/**
 * The digest: the one shape transcript text is reduced to before the brain
 * sees it. A smaller model reads what a session's transcript gained and fills
 * this fixed form — where the agent stopped, what the developer last asked,
 * what the agent did since, what it waits on — and the brain is handed the
 * form, never the slice. The form's fields carry no length bound of their
 * own by product decision; the summarizer call's output token cap is the one
 * ceiling. What the reader refuses falls to the deterministic fallback below,
 * which is built from roster fields alone, so no path exists by which raw
 * transcript text could ride into the brain's memory under a digest's name.
 */

export const DIGEST_STOP_STATE = {
  WORKING: "working",
  FINISHED: "finished",
  WAITING_FOR_DEVELOPER: "waiting-for-developer",
  WAITING_FOR_PERMISSION: "waiting-for-permission",
  ERRORED: "errored",
  UNKNOWN: "unknown",
} as const;

export type DigestStopState = (typeof DIGEST_STOP_STATE)[keyof typeof DIGEST_STOP_STATE];

const DIGEST_STOP_STATE_LIST: readonly string[] = Object.values(DIGEST_STOP_STATE);

export const DIGEST_SOURCE = {
  MODEL: "model",
  FALLBACK: "fallback",
} as const;

export type DigestSource = (typeof DIGEST_SOURCE)[keyof typeof DIGEST_SOURCE];

export interface BrainSessionDigest {
  stopState: DigestStopState;
  /** The developer's most recent request inside the slice, when the slice holds one. */
  lastAsk?: string;
  /** What the agent did across the slice, in the past tense. */
  didSince?: string;
  /** The question, permission, or error the agent is held on, when it is held. */
  waitingOn?: string;
}

/**
 * What one summarizer call is handed. Provider and session ids never enter
 * it: the digest names no session, and the brain attaches it to the identity
 * the roster gave the wake, so nothing a model wrote can address a session.
 */
export interface DigestInput {
  providerName: string;
  title?: string;
  status?: SessionStatus;
  hookEvent?: string;
  /** Whether the front of the slice was cut to the per-session bound. */
  truncated: boolean;
  transcript: string;
}

export const DIGEST_SCHEMA_NAME = "session_digest";

export const DIGEST_FIELD = {
  STOP_STATE: "stop_state",
  LAST_ASK: "last_ask",
  DID_SINCE: "did_since",
  WAITING_ON: "waiting_on",
} as const;

/**
 * The strict JSON schema the summarizer answers under: every property
 * required and the free-text ones nullable, which is what the Responses API's
 * strict mode demands of an optional field.
 */
export const DIGEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    DIGEST_FIELD.STOP_STATE,
    DIGEST_FIELD.LAST_ASK,
    DIGEST_FIELD.DID_SINCE,
    DIGEST_FIELD.WAITING_ON,
  ],
  properties: {
    [DIGEST_FIELD.STOP_STATE]: {
      type: "string",
      enum: Object.values(DIGEST_STOP_STATE),
      description: "Where the agent stands at the end of the slice.",
    },
    [DIGEST_FIELD.LAST_ASK]: {
      type: ["string", "null"],
      description: "The developer's most recent request in the slice, or null when it holds none.",
    },
    [DIGEST_FIELD.DID_SINCE]: {
      type: ["string", "null"],
      description:
        "What the agent did across the slice, past tense, or null when nothing happened.",
    },
    [DIGEST_FIELD.WAITING_ON]: {
      type: ["string", "null"],
      description:
        "The question, permission, or error the agent is held on, or null when it is not held.",
    },
  },
} as const;

function isDigestStopState(value: UnparsedWireValue): value is DigestStopState {
  return isWireString(value) && DIGEST_STOP_STATE_LIST.includes(value);
}

/**
 * A nullable string field as the schema allows it: a string or null, with
 * anything else refusing the whole digest, and an empty or whitespace string
 * reading as the field being absent.
 */
function optionalField(value: UnparsedWireValue): { ok: true; text?: string } | { ok: false } {
  if (value === null) return { ok: true };
  if (!isWireString(value)) return { ok: false };
  const trimmed = text(value);
  return trimmed ? { ok: true, text: trimmed } : { ok: true };
}

/**
 * Reads a digest out of what a model wrote, or nothing. Anything off the
 * schema — not a record, an unknown stop state, a field that is neither
 * string nor null — refuses the whole digest rather than repairing it, and
 * the refusal falls to the fallback.
 */
export function digestFromModel(value: UnparsedWireValue): BrainSessionDigest | undefined {
  if (!isRecord(value)) return undefined;
  const stopState = value[DIGEST_FIELD.STOP_STATE];
  if (!isDigestStopState(stopState)) return undefined;
  const lastAsk = optionalField(value[DIGEST_FIELD.LAST_ASK]);
  const didSince = optionalField(value[DIGEST_FIELD.DID_SINCE]);
  const waitingOn = optionalField(value[DIGEST_FIELD.WAITING_ON]);
  if (!lastAsk.ok || !didSince.ok || !waitingOn.ok) return undefined;
  return {
    stopState,
    ...(lastAsk.text ? { lastAsk: lastAsk.text } : undefined),
    ...(didSince.text ? { didSince: didSince.text } : undefined),
    ...(waitingOn.text ? { waitingOn: waitingOn.text } : undefined),
  };
}

export interface FallbackDigestAbout {
  status?: SessionStatus;
  hookEvent?: string;
  /** The roster's own error line for the session, when it reported one. */
  error?: string;
}

function stopStateFromStatus(status: SessionStatus | undefined): DigestStopState {
  switch (status) {
    case SESSION_STATUS.WORKING:
      return DIGEST_STOP_STATE.WORKING;
    case SESSION_STATUS.WAITING:
      return DIGEST_STOP_STATE.WAITING_FOR_DEVELOPER;
    case SESSION_STATUS.ERROR:
      return DIGEST_STOP_STATE.ERRORED;
    case SESSION_STATUS.COMPLETE:
      return DIGEST_STOP_STATE.FINISHED;
    default:
      return DIGEST_STOP_STATE.UNKNOWN;
  }
}

function stopStateFromAbout(about: FallbackDigestAbout): DigestStopState {
  switch (about.hookEvent) {
    case BRAIN_WAKE_HOOK.STOP_FAILURE:
      return DIGEST_STOP_STATE.ERRORED;
    case BRAIN_WAKE_HOOK.NOTIFICATION:
      return DIGEST_STOP_STATE.WAITING_FOR_PERMISSION;
    case BRAIN_WAKE_HOOK.SESSION_END:
      return DIGEST_STOP_STATE.FINISHED;
    default:
      return stopStateFromStatus(about.status);
  }
}

/**
 * The digest a session gets when no model wrote one: the stop state read
 * deterministically from the hook that fired and the roster status, and the
 * roster's own error line as what an errored session waits on. It is built
 * from observed fields alone and never from the transcript, so a summarizer
 * that is absent, quiet, late, or off-schema still leaves the brain holding
 * no transcript text.
 */
export function fallbackDigest(about: FallbackDigestAbout): BrainSessionDigest {
  const stopState = stopStateFromAbout(about);
  const error = text(about.error);
  return {
    stopState,
    ...(stopState === DIGEST_STOP_STATE.ERRORED && error ? { waitingOn: error } : undefined),
  };
}

/** How much a digest says, for the trace to count without carrying its words. */
export function digestChars(digest: BrainSessionDigest): number {
  return JSON.stringify(digest).length;
}

/**
 * Maps every item through `work` with at most `limit` in flight, answering in
 * the items' order. A rejected item rejects the whole map, so callers that
 * must not fail wrap their own work.
 */
export async function mapWithLimit<Item, Result>(
  items: readonly Item[],
  limit: number,
  work: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = [];
  let next = 0;
  const lanes = Math.max(1, Math.min(Math.floor(limit), items.length));
  const lane = async (): Promise<void> => {
    for (;;) {
      const index = next;
      if (index >= items.length) return;
      next += 1;
      const item = items[index];
      // SAFETY: `index` stayed below `items.length`, so the slot is populated.
      results[index] = await work(item as Item);
    }
  };
  await Promise.all(Array.from({ length: lanes }, lane));
  return results;
}
