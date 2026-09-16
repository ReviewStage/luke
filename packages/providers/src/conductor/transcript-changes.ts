import {
  ACTION_RESULT_STATUS,
  type ProviderTranscriptChange,
  type ProviderTranscriptChangesResult,
  type TranscriptChangesRequest,
} from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";
import { Effect } from "effect";
import type { AdapterFailure } from "../shared/adapter-failure.js";
import type { CloudPass } from "../shared/cloud-pass.js";
import { recordsFromPage, textFromRecord } from "../shared/cloud-wire.js";
import { type ReportedSessions, readRefusal } from "./conversation.js";
import { CONDUCTOR_TIMESTAMP_LITERAL_PATTERN, UUID_PATTERN } from "./vocabulary.js";
import { CONDUCTOR_READ_TRANSCRIPT_CHANGES, CONDUCTOR_ROUTE, CONDUCTOR_SQL_FIELD } from "./wire.js";

/**
 * Which of the roster's chats gained transcript since an instant, through
 * the documented read-only query endpoint over `session_transcripts_view`
 * and its `transcript_updated_at` column. The document is fixed by this
 * build: the ids spliced into it are the caller's, each a UUID the latest
 * roster reported, and the instant is one this build serialised itself, so
 * nothing a provider controls reaches the query. The answer names chats and
 * instants and not a word of any chat; the words are the incremental
 * transcript read's, under its own cursor. This is a credential-bound read
 * like the conversation's, never an observation pass's: the pass judges a
 * chat from what Conductor reports about it and asks nothing of this view
 * but the agent kind.
 */

const NOT_AN_INSTANT = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: "That transcript mark is not an instant this build sends.",
} as const;

const NO_CHANGES: ProviderTranscriptChangesResult = {
  status: ACTION_RESULT_STATUS.ACCEPTED,
  changes: [],
};

/** The instants `Date` can hold, past which `toISOString` throws rather than answers. */
const MAXIMUM_INSTANT_MS = 8.64e15;

/** The digits of an instant's fraction past the millisecond, which `Date` keeps none of. */
const SUB_MILLISECOND_DIGITS = /\.\d{3}(\d+)/;

/**
 * The row's instant, rounded up to the millisecond where the provider keeps
 * finer: the mark is written back as milliseconds and compared with `>`, so
 * an instant cut short would name its own row as changed on every read.
 */
function changeInstant(row: WireRecord): number | undefined {
  const value = textFromRecord(row, CONDUCTOR_SQL_FIELD.TRANSCRIPT_UPDATED_AT);
  if (!value) return undefined;
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return undefined;
  const finer = SUB_MILLISECOND_DIGITS.exec(value)?.[1];
  return finer !== undefined && /[1-9]/.test(finer) ? instant + 1 : instant;
}

/** The instant as the document carries it, or nothing where the mark is not one this build would write. */
function sinceLiteral(since: number): string | undefined {
  if (!Number.isSafeInteger(since) || since < 0 || since > MAXIMUM_INSTANT_MS) return undefined;
  const literal = new Date(since).toISOString();
  return CONDUCTOR_TIMESTAMP_LITERAL_PATTERN.test(literal) ? literal : undefined;
}

/** The one document, from the ids and the instant already admitted. */
function changesDocument(ids: readonly string[], since: string | undefined): string {
  const list = ids.map((id) => `'${id}'`).join(", ");
  const { PREFIX, SINCE, SINCE_SUFFIX, SUFFIX } = CONDUCTOR_READ_TRANSCRIPT_CHANGES;
  return since === undefined
    ? `${PREFIX}${list}${SUFFIX}`
    : `${PREFIX}${list}${SINCE}${since}${SINCE_SUFFIX}`;
}

/** The rows as changes, oldest first, each instant rounded up to the millisecond; a row with no parseable instant, or naming a chat not asked about, is dropped. */
function changesFromRows(body: WireRecord, known: ReadonlySet<string>): ProviderTranscriptChange[] {
  const changes: ProviderTranscriptChange[] = [];
  for (const row of recordsFromPage(body, CONDUCTOR_SQL_FIELD.ROWS)) {
    const providerSessionId = textFromRecord(row, CONDUCTOR_SQL_FIELD.SESSION_ID);
    const updatedAt = changeInstant(row);
    if (providerSessionId === undefined || updatedAt === undefined) continue;
    if (!known.has(providerSessionId)) continue;
    changes.push({ providerSessionId, updatedAt });
  }
  changes.sort((left, right) => left.updatedAt - right.updatedAt);
  return changes;
}

export const readConductorTranscriptChanges = /* @__PURE__ */ Effect.fn(
  "readConductorTranscriptChanges",
)(
  function* (
    pass: CloudPass,
    reported: ReportedSessions,
    request: TranscriptChangesRequest,
  ): Effect.fn.Return<ProviderTranscriptChangesResult, AdapterFailure> {
    // Only a UUID the latest roster reported enters the document; anything else the caller named is
    // not a chat this build will ask about, and a document with no ids is not sent at all.
    const known = new Set(reported().map((observation) => observation.providerSessionId));
    const ids = [...new Set(request.providerSessionIds)].filter(
      (id) => UUID_PATTERN.test(id) && known.has(id),
    );
    if (ids.length === 0) return NO_CHANGES;
    const since = request.since === undefined ? undefined : sinceLiteral(request.since);
    if (request.since !== undefined && since === undefined) return NOT_AN_INSTANT;
    let body: WireRecord = {};
    yield* pass.credentialBoundRead(
      CONDUCTOR_ROUTE.SQL,
      undefined,
      { document: changesDocument(ids, since) },
      (answer) => {
        body = answer;
      },
    );
    return { status: ACTION_RESULT_STATUS.ACCEPTED, changes: changesFromRows(body, new Set(ids)) };
  },
  Effect.catch(
    (failure: AdapterFailure): Effect.Effect<ProviderTranscriptChangesResult> =>
      Effect.succeed(readRefusal(failure, "transcript changes")),
  ),
);
