import type { BrainAgent, BrainRequestRecord } from "@sidecar/brain";
import {
  BRAIN_REQUEST_ORIGIN,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
  brainReplyWords,
  isTerminalBrainRequestStatus,
  stoppedAskNarration,
} from "@sidecar/brain/requests";
import type { BrainAskSubmissionResult, BrainRequestSnapshot } from "@sidecar/brain/requests-wire";
import { MAIN_SESSION_KEY, type SessionKey } from "@sidecar/runtime/vocabulary";
import {
  type ConversationEntry,
  replyConversationEntry,
  stoppedAskConversationEntry,
  typedAskConversationEntry,
} from "@sidecar/session";

/** What the publication owner reaches: the thread and every window. */
export interface BrainPublicationDependencies {
  /**
   * Records one line in one conversation's thread at the moment given,
   * answering whether the thread took it; the main process is the thread's
   * store. A line the thread already holds for that run answers true,
   * because holding it is the whole of what was asked.
   */
  recordConversationEntry: (
    entry: ConversationEntry,
    recordedAt: number,
    sessionKey: SessionKey,
  ) => boolean | Promise<boolean>;
  /** Hands the whole list of records to every window. */
  broadcastRequests: (snapshots: readonly BrainRequestSnapshot[]) => void;
  /**
   * Hands the standing follower's publication chain to the drain, so a quit
   * lets every end already reported reach Conversation before the store closes.
   */
  onPublication?: (settled: () => Promise<void>) => void;
}

/** The one refusal a window is answered when no brain can take its ask, and what the operator reads for an answer it cannot. */
export const REJECTED_SUBMISSION: BrainAskSubmissionResult = {
  outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
  reason: BRAIN_SUBMISSION_REJECTION.ABSENT,
};

/** The part of the agent publication reads and marks: the live record, and the two marks. */
export type BrainPublicationAgent = Pick<
  BrainAgent,
  "request" | "markConversationRecorded" | "markAskRecorded"
>;

/** Writes a typed ask's own line once, at its acceptance, and marks the run when the thread took it. */
export async function publishAsk(
  agent: BrainPublicationAgent,
  runId: string,
  record: BrainPublicationDependencies["recordConversationEntry"],
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
async function publishEnd(
  agent: BrainPublicationAgent,
  runId: string,
  record: BrainPublicationDependencies["recordConversationEntry"],
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
 * The one place a run reaches the thread. Every record the brain reports is
 * read for what the thread has not yet taken — its typed ask, its end — and
 * the record itself says which, in marks the brain keeps across reports,
 * rebuilt followers, and launches. Each write is decided against the record
 * as it stands at that moment, never against the report that prompted it, so
 * an older report cannot write what a newer one already marked, and a
 * follower retired mid-way writes nothing more. Only a write the thread
 * confirmed marks the run; a write that failed leaves it for the next report.
 * The mark, not the thread's contents, is what says a run was published, so
 * a line the thread has since let go of is never written back.
 */
export async function publishRuns(
  agent: BrainPublicationAgent,
  snapshots: readonly BrainRequestSnapshot[],
  record: BrainPublicationDependencies["recordConversationEntry"],
  stillFollowing: () => boolean = () => true,
  sessionKey: SessionKey = MAIN_SESSION_KEY,
): Promise<void> {
  for (const snapshot of snapshots) {
    if (!stillFollowing()) return;
    await publishAsk(agent, snapshot.runId, record, sessionKey);
    if (!stillFollowing()) return;
    await publishEnd(agent, snapshot.runId, record, sessionKey);
  }
}

/**
 * Follows the brain that currently stands: each rebuilt agent is subscribed
 * as it arrives, its records relayed to every window and its runs written to
 * the thread. The thread write here is the one Conversation write for a run,
 * and the live session speaks a reply only from the run's own events, never
 * from this record.
 * Unfollowing retires the subscription, drains the publication of the reports
 * already taken, and then relays nothing more, so a replaced agent's records
 * are all written once and its late ones reach neither the thread nor the
 * windows.
 */
export function followBrainRequests(
  agent: BrainAgent,
  dependencies: Pick<
    BrainPublicationDependencies,
    "recordConversationEntry" | "broadcastRequests" | "onPublication"
  >,
  sessionKey: SessionKey = MAIN_SESSION_KEY,
): () => Promise<void> {
  let accepting = true;
  let following = true;
  let publishing: Promise<void> = Promise.resolve();
  dependencies.onPublication?.(() => publishing);
  const listener = (records: readonly BrainRequestRecord[]) => {
    if (!accepting) return;
    dependencies.broadcastRequests(records);
    // Reports are published one at a time, each against the records as they
    // then stand, so two reports of the same end cannot both find it unmarked.
    publishing = publishing.then(() =>
      publishRuns(
        agent,
        records,
        dependencies.recordConversationEntry,
        () => following,
        sessionKey,
      ),
    );
  };
  const unsubscribe = agent.subscribe(listener);
  void agent.ready().then(() => listener(agent.requests()));
  // Unfollowing takes no more reports at once, but lets the ones already
  // taken finish: the stop that retires an agent reports every run it
  // interrupted, and those ends belong in the thread before the follower
  // goes. Each write answers promptly — the store refuses rather than hangs —
  // so the drain is bounded by the reports already queued.
  return async () => {
    accepting = false;
    unsubscribe();
    await publishing;
    following = false;
  };
}
