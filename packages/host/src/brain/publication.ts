import { type BrainAgent, type BrainRequestRecord, publishRuns } from "@sidecar/brain";
import { BRAIN_SUBMISSION_OUTCOME, BRAIN_SUBMISSION_REJECTION } from "@sidecar/brain/requests";
import type { BrainAskSubmissionResult, BrainRequestSnapshot } from "@sidecar/brain/requests-wire";
import { MAIN_SESSION_KEY, type SessionKey } from "@sidecar/runtime/vocabulary";
import type { ConversationEntry } from "@sidecar/session";

/** What the publication owner reaches: the thread, every window, and the delivery owner. */
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
   * A run's end stands in the thread, written and marked: the one moment a
   * reply becomes deliverable to the ear, handed the live record as it then
   * reads. Called again on later reports of the same ended run, so a receiver
   * that missed it is not owed a report that never comes; the delivery owner
   * decides what is new.
   */
  onEndPublished?: (record: BrainRequestRecord, sessionKey: SessionKey) => void;
  /**
   * Hands the standing follower's publication chain to whoever answers a
   * wait, so a wait that finds its run ended can let the end reach Conversation
   * before the words are granted anywhere.
   */
  onPublication?: (settled: () => Promise<void>) => void;
}

/** The one refusal a window is answered when no brain can take its ask, and what the operator reads for an answer it cannot. */
export const REJECTED_SUBMISSION: BrainAskSubmissionResult = {
  outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
  reason: BRAIN_SUBMISSION_REJECTION.ABSENT,
};

export { type BrainPublicationAgent, publishAsk, publishRuns } from "@sidecar/brain";

/**
 * Follows the brain that currently stands: each rebuilt agent is subscribed
 * as it arrives, its records relayed to every window and its runs written to
 * the thread. The subscription is the completion channel the reply delivery
 * reads; the thread write here is the one Conversation write for a run.
 * Unfollowing retires the subscription, drains the publication of the reports
 * already taken, and then relays nothing more, so a replaced agent's records
 * are all written once and its late ones reach neither the thread nor the
 * windows.
 */
export function followBrainRequests(
  agent: BrainAgent,
  dependencies: Pick<
    BrainPublicationDependencies,
    "recordConversationEntry" | "broadcastRequests" | "onEndPublished" | "onPublication"
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
        dependencies.onEndPublished,
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
