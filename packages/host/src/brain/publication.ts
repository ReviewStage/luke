import type { BrainAgent, BrainRequestRecord } from "@sidecar/brain";
import {
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
  isTerminalBrainRequestStatus,
} from "@sidecar/brain/requests";
import type { BrainAskSubmissionResult, BrainRequestSnapshot } from "@sidecar/brain/requests-wire";

/** What the publication owner reaches: every window, and the drain. */
export interface BrainPublicationDependencies {
  /** Hands the whole list of records to every window. */
  broadcastRequests: (snapshots: readonly BrainRequestSnapshot[]) => void;
  /**
   * Hands the standing follower's publication chain to the drain, so a quit
   * lets every end already reported be marked before the store closes.
   */
  onPublication?: (settled: () => Promise<void>) => void;
}

/** The one refusal a window is answered when no brain can take its ask, and what the operator reads for an answer it cannot. */
export const REJECTED_SUBMISSION: BrainAskSubmissionResult = {
  outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
  reason: BRAIN_SUBMISSION_REJECTION.ABSENT,
};

/** The part of the agent publication reads and marks: the live record, and the end's mark. */
export type BrainPublicationAgent = Pick<BrainAgent, "request" | "markConversationRecorded">;

/**
 * Marks a run's end taken once it has settled, and answers the live record
 * once the mark stands — now, or from an earlier report — and nothing while
 * it does not: a mark the store refused leaves the end for the next report.
 *
 * No line is written here. What Luke says is the transcript of the live
 * session that said it, written by the live record as each utterance
 * settles; the brain's own reply text is the backend's facts, which the voice
 * paraphrases, so writing it too would put words in the thread Luke never
 * said. A run that ends with no words reaches the voice as one refusal
 * commentary, whose transcript is the record. The mark is still needed, since
 * only an ended run marked taken may be let go of when the envelope is full.
 */
async function publishEnd(
  agent: BrainPublicationAgent,
  runId: string,
): Promise<BrainRequestRecord | undefined> {
  const current = agent.request(runId);
  if (!current || !isTerminalBrainRequestStatus(current.status)) return undefined;
  if (current.conversationRecordedAt !== undefined) return current;
  const at = current.settledAt ?? current.acceptedAt;
  if (!(await agent.markConversationRecorded(runId, at))) return undefined;
  // Re-read rather than patched: the mark landed on the live record, and a
  // Clear or a replacement in the meantime has taken the record with it.
  const marked = agent.request(runId);
  return marked?.conversationRecordedAt !== undefined ? marked : undefined;
}

/**
 * The one place a run's end is taken. Every record the brain reports is read
 * for an end not yet marked, and the record itself says which, in a mark the
 * brain keeps across reports, rebuilt followers, and launches. Each mark is
 * decided against the record as it stands at that moment, never against the
 * report that prompted it, so an older report cannot mark what a newer one
 * already did, and a follower retired mid-way marks nothing more.
 */
export async function publishRuns(
  agent: BrainPublicationAgent,
  snapshots: readonly BrainRequestSnapshot[],
  stillFollowing: () => boolean = () => true,
): Promise<void> {
  for (const snapshot of snapshots) {
    if (!stillFollowing()) return;
    await publishEnd(agent, snapshot.runId);
  }
}

/**
 * Follows the brain that currently stands: each rebuilt agent is subscribed
 * as it arrives, its records relayed to every window and its ended runs
 * marked taken. Conversation's lines come from the live session's transcript
 * alone, and the live session speaks a reply only from the run's own events,
 * never from this record.
 * Unfollowing retires the subscription, drains the publication of the reports
 * already taken, and then relays nothing more, so a replaced agent's records
 * are all marked once and its late ones reach no window.
 */
export function followBrainRequests(
  agent: BrainAgent,
  dependencies: Pick<BrainPublicationDependencies, "broadcastRequests" | "onPublication">,
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
    publishing = publishing.then(() => publishRuns(agent, records, () => following));
  };
  const unsubscribe = agent.subscribe(listener);
  void agent.ready().then(() => listener(agent.requests()));
  // Unfollowing takes no more reports at once, but lets the ones already
  // taken finish: the stop that retires an agent reports every run it
  // interrupted, and those ends belong marked before the follower goes. Each
  // mark answers promptly — the store refuses rather than hangs — so the
  // drain is bounded by the reports already queued.
  return async () => {
    accepting = false;
    unsubscribe();
    await publishing;
    following = false;
  };
}
