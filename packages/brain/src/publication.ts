import { MAIN_SESSION_KEY, type SessionKey } from "@sidecar/runtime/vocabulary";
import {
  type ConversationEntry,
  replyConversationEntry,
  stoppedAskConversationEntry,
  typedAskConversationEntry,
} from "@sidecar/session";
import type { BrainAgent } from "./agent.js";
import {
  BRAIN_REQUEST_ORIGIN,
  type BrainRequestRecord,
  brainReplyWords,
  isTerminalBrainRequestStatus,
  stoppedAskNarration,
} from "./requests.js";

/**
 * How a run reaches the Conversation: its typed ask written once at its
 * acceptance, its end written once when it settled, each marked on the
 * record once the thread took it. The marks are what say a run was
 * published, not the thread's contents, so a line the thread has since let
 * go of is never written back, and a write the thread refused leaves the
 * run for the next report. The desktop's follower and the hosted host both
 * publish through here, so the two cannot word an end differently.
 */

/**
 * Records one line in one conversation's thread at the moment given, answering
 * whether the thread took it. A line the thread already holds for that run
 * answers true, because holding it is the whole of what was asked.
 */
export type ConversationLineRecorder = (
  entry: ConversationEntry,
  recordedAt: number,
  sessionKey: SessionKey,
) => boolean | Promise<boolean>;

/** The part of the agent publication reads and marks: the live record, and the two marks. */
export type BrainPublicationAgent = Pick<
  BrainAgent,
  "request" | "markConversationRecorded" | "markAskRecorded"
>;

/** The record's identity as a report carries it. */
export interface BrainRunReference {
  readonly runId: string;
}

/** Writes a typed ask's own line once, at its acceptance, and marks the run when the thread took it. */
export async function publishAsk(
  agent: BrainPublicationAgent,
  runId: string,
  record: ConversationLineRecorder,
  sessionKey: SessionKey,
): Promise<void> {
  const current = agent.request(runId);
  if (!current || current.origin !== BRAIN_REQUEST_ORIGIN.TYPED) return;
  if (current.askRecordedAt !== undefined) return;
  if (
    !(await record(
      typedAskConversationEntry(current.question, current.runId),
      current.acceptedAt,
      sessionKey,
    ))
  ) {
    return;
  }
  await agent.markAskRecorded(runId, current.acceptedAt);
}

/**
 * Writes a run's end once, at the moment it settled, and marks the run when
 * the thread took it. Answers the live record once its end stands written and
 * marked — now, or from an earlier report — and nothing while it does not: a
 * write the thread refused, or a mark the store refused, leaves the end
 * unpublished for the next report, and nothing downstream may treat it as
 * said.
 */
export async function publishEnd(
  agent: BrainPublicationAgent,
  runId: string,
  record: ConversationLineRecorder,
  sessionKey: SessionKey,
): Promise<BrainRequestRecord | undefined> {
  const current = agent.request(runId);
  if (!current || !isTerminalBrainRequestStatus(current.status)) return undefined;
  if (current.conversationRecordedAt !== undefined) return current;
  // An end with words is Luke's reply; a plain stop has none and leaves the
  // quiet line instead, so every ended run reaches the thread and is marked.
  const words = brainReplyWords(current);
  const narration = words === undefined ? stoppedAskNarration(current) : undefined;
  const entry =
    words !== undefined
      ? replyConversationEntry(words, current.runId)
      : narration !== undefined
        ? stoppedAskConversationEntry(narration, current.runId)
        : undefined;
  if (!entry) return undefined;
  const at = current.settledAt ?? current.acceptedAt;
  if (!(await record(entry, at, sessionKey))) return undefined;
  if (!(await agent.markConversationRecorded(runId, at))) return undefined;
  // Re-read rather than patched: the mark landed on the live record, and a
  // Clear or a replacement in the meantime has taken the record with it.
  const marked = agent.request(runId);
  return marked?.conversationRecordedAt !== undefined ? marked : undefined;
}

/**
 * The one place a run reaches the thread. Every record reported is read for
 * what the thread has not yet taken — its typed ask, its end — and the record
 * itself says which, in marks the brain keeps across reports, rebuilt
 * followers, and launches. Each write is decided against the record as it
 * stands at that moment, never against the report that prompted it, so an
 * older report cannot write what a newer one already marked, and a follower
 * retired mid-way writes nothing more.
 */
export async function publishRuns(
  agent: BrainPublicationAgent,
  runs: readonly BrainRunReference[],
  record: ConversationLineRecorder,
  stillFollowing: () => boolean = () => true,
  onEndPublished:
    | ((record: BrainRequestRecord, sessionKey: SessionKey) => void)
    | undefined = undefined,
  sessionKey: SessionKey = MAIN_SESSION_KEY,
): Promise<void> {
  for (const run of runs) {
    if (!stillFollowing()) return;
    await publishAsk(agent, run.runId, record, sessionKey);
    if (!stillFollowing()) return;
    const published = await publishEnd(agent, run.runId, record, sessionKey);
    if (published && stillFollowing()) onEndPublished?.(published, sessionKey);
  }
}
