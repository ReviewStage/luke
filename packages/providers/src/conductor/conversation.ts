import {
  ACTION_RESULT_STATUS,
  CONVERSATION_MESSAGE_AUTHOR,
  type ConversationPage,
  OMISSION_MARKER,
  type ProviderConversationMessage,
  type ProviderConversationResult,
  type ProviderSessionObservation,
  type ProviderTranscriptResult,
  type ProviderTranscriptSinceResult,
} from "@sidecar/session";
import { oneLine, type WireRecord } from "@sidecar/wire";
import { ADAPTER_FAILURE, AdapterFailure } from "../shared/adapter-failure.js";
import type { CloudPass } from "../shared/cloud-pass.js";
import { isDefined, recordsFromPage, textFromRecord } from "../shared/cloud-wire.js";
import {
  boundedTranscript,
  TRANSCRIPT_BOUNDS,
  transcriptLine,
} from "../shared/jsonl-transcript.js";
import { CONDUCTOR_PROVIDER_NAME, UUID_PATTERN } from "./vocabulary.js";
import {
  CONDUCTOR_CONVERSATION_BOUNDS,
  CONDUCTOR_FIELD,
  CONDUCTOR_QUERY,
  CONDUCTOR_ROUTE_SEGMENT,
  CONDUCTOR_STORED_MESSAGE_FIELD,
  conversationMessageFromRecord,
} from "./wire.js";

/**
 * One observed chat's stored conversation, through the documented transcript
 * read `GET …/sessions/{id}/messages`, never from an observation pass. Three
 * callers ask for it. A conversation screen reads the way a chat screen does:
 * opened plain it answers the newest page, walking to the transcript's end
 * because the endpoint pages ascending; handed `beforeOffset` it answers the
 * older history just before what the screen holds; handed `afterMessageId`
 * it answers only what is newer, behind the endpoint's own polling cursor.
 * The brain's whole transcript read takes the same newest page, and its
 * incremental read takes what is newer than the cursor its last read handed
 * back — the same `after` the screen polls with — each rendered in the line
 * vocabulary every local transcript reader speaks, so one shape describes an
 * agent wherever it runs. Every mode keeps only the messages the store itself
 * attributes, and everything else is dropped unread. The page is answered to
 * the caller and nothing is kept here: the conversation stays the provider's.
 */

/**
 * The newest offset a read of each session already reached, per credential.
 * It is the whole reason a re-opened chat costs one request: the walk starts
 * where the last read stopped instead of seeking the end again.
 */
export interface ConductorConversationEnds {
  reached: Map<string, number>;
}

export function conductorConversationEnds(): ConductorConversationEnds {
  return { reached: new Map() };
}

/** One documented stored-messages read, with the query the mode composed. */
async function messagesPage(
  pass: CloudPass,
  providerSessionId: string,
  query: Readonly<Record<string, string>>,
): Promise<WireRecord> {
  let body: WireRecord = {};
  await pass.credentialBoundRead(
    [
      CONDUCTOR_ROUTE_SEGMENT.V0,
      CONDUCTOR_ROUTE_SEGMENT.SESSIONS,
      providerSessionId,
      CONDUCTOR_ROUTE_SEGMENT.MESSAGES,
    ],
    query,
    undefined,
    (answer) => {
      body = answer;
    },
  );
  return body;
}

/**
 * The poll: everything newer than the cursor the last answer handed back,
 * walked forward behind the endpoint's own `after` to the fixed bounds.
 */
async function readNewerMessages(
  pass: CloudPass,
  providerSessionId: string,
  afterMessageId: string,
): Promise<ProviderConversationResult> {
  const messages: ProviderConversationMessage[] = [];
  let cursor = afterMessageId;
  let hasMore = false;
  for (let page = 0; page < CONDUCTOR_CONVERSATION_BOUNDS.MAXIMUM_PAGES; page += 1) {
    const body = await messagesPage(pass, providerSessionId, {
      [CONDUCTOR_QUERY.LIMIT]: String(CONDUCTOR_CONVERSATION_BOUNDS.PAGE_SIZE),
      [CONDUCTOR_QUERY.AFTER]: cursor,
    });
    const records = recordsFromPage(body, CONDUCTOR_FIELD.DATA);
    // An empty page that still claims more would walk in place forever, so
    // the claim is only believed of a page that moved the cursor.
    if (records.length === 0) {
      hasMore = false;
      break;
    }
    for (const record of records) {
      const message = conversationMessageFromRecord(record);
      if (message) messages.push(message);
    }
    const lastId = newestStoredId(records);
    hasMore = body[CONDUCTOR_FIELD.HAS_MORE] === true;
    if (!lastId) break;
    cursor = lastId;
    if (!hasMore || messages.length >= CONDUCTOR_CONVERSATION_BOUNDS.MAXIMUM_MESSAGES) break;
  }
  return { status: ACTION_RESULT_STATUS.ACCEPTED, messages, lastMessageId: cursor, hasMore };
}

/** One page the tail walk read, as the two things the answer is built from. */
interface WalkedPage {
  readonly offset: number;
  /** The poll's cursor if this is the newest page the walk reached. */
  readonly newestStoredId: string | undefined;
  readonly messages: readonly ProviderConversationMessage[];
  /** Stored records, attributed or not: what the walk advances its offset by. */
  readonly length: number;
}

/** The newest stored message a page carried, attributed or not: the poll's cursor. */
function newestStoredId(records: readonly WireRecord[]): string | undefined {
  const newest = records[records.length - 1];
  return newest ? textFromRecord(newest, CONDUCTOR_STORED_MESSAGE_FIELD.ID) : undefined;
}

/**
 * One page of older history ending at `endOffset`, read the way a chat screen
 * scrolls: fixed-width windows paged backward by offset arithmetic until
 * enough attributed messages stand or the window budget is spent, answered
 * with where the page began so the next scroll can continue. It never names a
 * poll cursor, because history must not move a poll backward.
 */
async function readConversationPage(
  pass: CloudPass,
  providerSessionId: string,
  endOffset: number,
): Promise<ProviderConversationResult> {
  const messages: ProviderConversationMessage[] = [];
  let chunkEnd = endOffset;
  for (
    let window = 0;
    window < CONDUCTOR_CONVERSATION_BOUNDS.MAXIMUM_HISTORY_WINDOWS &&
    chunkEnd > 0 &&
    messages.length < CONDUCTOR_CONVERSATION_BOUNDS.HISTORY_TARGET_MESSAGES;
    window += 1
  ) {
    const chunkStart = Math.max(0, chunkEnd - CONDUCTOR_CONVERSATION_BOUNDS.PAGE_SIZE);
    const body = await messagesPage(pass, providerSessionId, {
      [CONDUCTOR_QUERY.LIMIT]: String(chunkEnd - chunkStart),
      [CONDUCTOR_QUERY.OFFSET]: String(chunkStart),
    });
    messages.unshift(
      ...recordsFromPage(body, CONDUCTOR_FIELD.DATA)
        .map(conversationMessageFromRecord)
        .filter(isDefined),
    );
    chunkEnd = chunkStart;
  }
  return {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    messages,
    hasMore: false,
    firstOffset: chunkEnd,
    hasOlder: chunkEnd > 0,
  };
}

/**
 * The newest page of a chat, and where its stored transcript currently ends.
 *
 * The endpoint pages ascending and reports no total, so the end is walked to
 * rather than sought: the walk starts one page before the end a previous read
 * of this session already reached — zero the first time — asks for one page
 * there, and stops as soon as a page comes back short or says no more remain.
 * A re-opened chat therefore costs exactly one request, and a first open at
 * most `MAXIMUM_HISTORY_WINDOWS`. The pages the walk read *are* the newest
 * ones, so the tail is assembled from them and no further request is made. A
 * transcript longer than the walk's budget answers with the deepest page it
 * reached; the poll that follows walks forward to the true newest on its own,
 * exactly as it did when the probe seek this replaced fell short.
 *
 * Every request in the walk carries only the fixed page size and an offset
 * this walk composed, so nothing stored can steer one.
 */
async function readTailPage(
  pass: CloudPass,
  ends: ConductorConversationEnds,
  providerSessionId: string,
): Promise<ProviderConversationResult> {
  const walk = async (from: number) => {
    const pages: WalkedPage[] = [];
    let offset = from;
    for (
      let window = 0;
      window < CONDUCTOR_CONVERSATION_BOUNDS.MAXIMUM_HISTORY_WINDOWS;
      window += 1
    ) {
      const body = await messagesPage(pass, providerSessionId, {
        [CONDUCTOR_QUERY.LIMIT]: String(CONDUCTOR_CONVERSATION_BOUNDS.PAGE_SIZE),
        [CONDUCTOR_QUERY.OFFSET]: String(offset),
      });
      const records = recordsFromPage(body, CONDUCTOR_FIELD.DATA);
      pages.push({
        offset,
        newestStoredId: newestStoredId(records),
        messages: records.map(conversationMessageFromRecord).filter(isDefined),
        length: records.length,
      });
      offset += records.length;
      if (records.length === 0 || body[CONDUCTOR_FIELD.HAS_MORE] !== true) break;
    }
    return { pages, end: offset };
  };

  // One page back from the end the last read of this session reached, so a
  // re-opened chat asks once and gets the newest page — starting at the end
  // itself would answer an empty page and show the developer nothing.
  const reached = ends.reached.get(providerSessionId) ?? 0;
  const from = Math.max(0, reached - CONDUCTOR_CONVERSATION_BOUNDS.PAGE_SIZE);
  let walked = await walk(from);
  // A cached offset now sitting past the transcript — a chat cleared on
  // Conductor's own surface — is the one backtrack, and it is bounded to one.
  if (from > 0 && walked.pages.every((page) => page.length === 0)) {
    ends.reached.delete(providerSessionId);
    walked = await walk(0);
  }
  rememberEnd(ends, providerSessionId, walked.end);

  // The kept pages are the newest the walk read, enough of them to carry the
  // history target; the rest is what an older-history scroll will ask for.
  const kept: WalkedPage[] = [];
  let attributed = 0;
  for (let index = walked.pages.length - 1; index >= 0; index -= 1) {
    const page = walked.pages[index];
    if (!page) continue;
    kept.unshift(page);
    attributed += page.messages.length;
    if (attributed >= CONDUCTOR_CONVERSATION_BOUNDS.HISTORY_TARGET_MESSAGES) break;
  }
  const firstOffset = kept[0]?.offset ?? walked.end;
  // The newest stored message of the whole walk, attributed or not: the poll
  // resumes exactly where this read stopped.
  const lastMessageId = walked.pages
    .map((page) => page.newestStoredId)
    .filter(isDefined)
    .at(-1);
  return {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    messages: kept.flatMap((page) => page.messages),
    hasMore: false,
    firstOffset,
    hasOlder: firstOffset > 0,
    ...(lastMessageId ? { lastMessageId } : undefined),
  };
}

/** Least-recently-reached first, so the cache stays a cache and not a ledger. */
function rememberEnd(
  ends: ConductorConversationEnds,
  providerSessionId: string,
  end: number,
): void {
  ends.reached.delete(providerSessionId);
  ends.reached.set(providerSessionId, end);
  while (ends.reached.size > CONDUCTOR_CONVERSATION_BOUNDS.END_CACHE_ENTRIES) {
    const oldest = ends.reached.keys().next();
    if (oldest.done) break;
    ends.reached.delete(oldest.value);
  }
}

/**
 * What an agent message is spoken as when the pass could not map the chat's
 * agent kind: Conductor is the one that stored it, so Conductor's name stands
 * rather than a guess at whose words they are.
 */
const CONDUCTOR_SPEAKER_NAME = CONDUCTOR_PROVIDER_NAME;

/** A read Conductor refused, named without echoing the provider's own words. */
function readRefusal(failure: AdapterFailure, subject: string) {
  return {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason:
      failure.failure === ADAPTER_FAILURE.UNAUTHORIZED
        ? `${CONDUCTOR_PROVIDER_NAME} rejected the configured API key.`
        : `${CONDUCTOR_PROVIDER_NAME} did not answer, so the ${subject} could not be read.`,
  };
}

const NOT_REPORTED = {
  status: ACTION_RESULT_STATUS.UNSUPPORTED,
  reason: "That session is not one the latest observation pass reported.",
} as const;

/** The roster a brain read answers for: what the latest pass reported, or what a host holding the roster itself hands in. */
export type ReportedSessions = () => readonly ProviderSessionObservation[];

/** The session behind a brain read, or nothing: a read reaches the provider, so only a reported UUID may. */
function reportedSession(
  reported: ReportedSessions,
  providerSessionId: string,
): ProviderSessionObservation | undefined {
  if (!UUID_PATTERN.test(providerSessionId)) return undefined;
  return reported().find((candidate) => candidate.providerSessionId === providerSessionId);
}

/** Attributed messages as transcript lines: the developer's in the shared lead, the agent's under its own name. */
function transcriptLines(
  observation: ProviderSessionObservation,
  messages: readonly ProviderConversationMessage[],
): string[] {
  const speaker = observation.agent?.displayName ?? CONDUCTOR_SPEAKER_NAME;
  return messages.flatMap((message) => {
    const words = oneLine(message.text, TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH);
    if (!words) return [];
    return [
      message.author === CONVERSATION_MESSAGE_AUTHOR.USER
        ? transcriptLine.developer(words)
        : transcriptLine.agent(speaker, words),
    ];
  });
}

/**
 * The brain's whole-transcript read of one cloud chat: the newest page of its
 * stored conversation, rendered one attributed message per line. It reaches
 * the provider, so it answers only for a session the latest pass reported,
 * the same guard the conversation read stands behind. A tail that history
 * precedes opens with the omission marker, so the reader knows the chat did
 * not begin there; a chat with no attributed message yet is not found rather
 * than rendered empty.
 */
export async function readConductorTranscript(
  pass: CloudPass,
  ends: ConductorConversationEnds,
  reported: ReportedSessions,
  providerSessionId: string,
): Promise<ProviderTranscriptResult> {
  const observation = reportedSession(reported, providerSessionId);
  if (!observation) return NOT_REPORTED;
  let tail: ProviderConversationResult;
  try {
    tail = await readTailPage(pass, ends, providerSessionId);
  } catch (error) {
    if (error instanceof AdapterFailure) return readRefusal(error, "transcript");
    throw error;
  }
  if (tail.status !== ACTION_RESULT_STATUS.ACCEPTED) return tail;
  const rendered = boundedTranscript(transcriptLines(observation, tail.messages));
  if (rendered === undefined) {
    return {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: "That session's transcript could not be found.",
    };
  }
  return {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    transcript: tail.hasOlder ? `${OMISSION_MARKER}\n${rendered}` : rendered,
  };
}

/**
 * The brain's incremental read of one cloud chat, for an observation turn:
 * what the store gained since the cursor the last read handed back, walked
 * forward behind the endpoint's own `after` exactly as the screen's poll is,
 * and rendered in the same lines the whole read speaks. With no cursor yet it
 * answers the newest page and says the front was cut, the way a local reader
 * falls back to its tail, so the first look at a chat reads its recent words
 * rather than its whole history. The cursor answered is the newest stored
 * message the read consumed, attributed or not, so the next read resumes past
 * the lifecycle noise too; a chat that gained nothing answers no words and
 * the same cursor. It reaches the provider, so it answers only for a session
 * the latest pass reported, and only behind a cursor Conductor itself handed
 * back.
 */
export async function readConductorTranscriptSince(
  pass: CloudPass,
  ends: ConductorConversationEnds,
  reported: ReportedSessions,
  providerSessionId: string,
  cursor: string | undefined,
): Promise<ProviderTranscriptSinceResult> {
  const observation = reportedSession(reported, providerSessionId);
  if (!observation) return NOT_REPORTED;
  if (cursor !== undefined && !UUID_PATTERN.test(cursor)) {
    return {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: "That transcript cursor is not one Conductor handed back.",
    };
  }
  let page: ProviderConversationResult;
  try {
    page =
      cursor === undefined
        ? await readTailPage(pass, ends, providerSessionId)
        : await readNewerMessages(pass, providerSessionId, cursor);
  } catch (error) {
    if (error instanceof AdapterFailure) return readRefusal(error, "transcript");
    throw error;
  }
  if (page.status !== ACTION_RESULT_STATUS.ACCEPTED) return page;
  const next = page.lastMessageId ?? cursor;
  return {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    text: transcriptLines(observation, page.messages).join("\n"),
    ...(next !== undefined ? { cursor: next } : undefined),
    truncated: cursor === undefined ? page.hasOlder === true : page.hasMore,
  };
}

export async function readConductorConversation(
  pass: CloudPass,
  ends: ConductorConversationEnds,
  providerSessionId: string,
  page: ConversationPage,
): Promise<ProviderConversationResult> {
  // Only ids that are actually UUIDs may enter the request path — the same
  // rule the transcripts-view read holds, here for the session id in the
  // route and the message id riding the query — and an offset must be the
  // plain non-negative integer an earlier answer reported.
  if (!UUID_PATTERN.test(providerSessionId)) {
    return {
      status: ACTION_RESULT_STATUS.UNSUPPORTED,
      reason: "That session's id is not a shape this build can read messages for.",
    };
  }
  if (page.afterMessageId !== undefined && !UUID_PATTERN.test(page.afterMessageId)) {
    return {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: "That conversation cursor is not one Conductor handed back.",
    };
  }
  if (
    page.beforeOffset !== undefined &&
    (!Number.isSafeInteger(page.beforeOffset) || page.beforeOffset < 0)
  ) {
    return {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: "That conversation position is not one Conductor handed back.",
    };
  }
  if (page.afterMessageId !== undefined && page.beforeOffset !== undefined) {
    return {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: "A poll and a history read are different asks; a request names one position.",
    };
  }

  try {
    if (page.afterMessageId !== undefined) {
      return await readNewerMessages(pass, providerSessionId, page.afterMessageId);
    }
    if (page.beforeOffset !== undefined) {
      return await readConversationPage(pass, providerSessionId, page.beforeOffset);
    }
    return await readTailPage(pass, ends, providerSessionId);
  } catch (error) {
    if (error instanceof AdapterFailure) return readRefusal(error, "conversation");
    throw error;
  }
}
