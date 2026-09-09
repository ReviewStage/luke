import type { BrainAgent, BrainRequestRecord } from "@sidecar/brain";
import {
  BRAIN_REQUEST_ORIGIN,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
  brainReplyWords,
  isTerminalBrainRequestStatus,
} from "@sidecar/brain/requests";
import type {
  BrainAskSubmission,
  BrainAskSubmissionResult,
  BrainAskWait,
  BrainReplyClaimResult,
  BrainRequestSnapshot,
} from "@sidecar/brain/requests-wire";
import {
  type ConversationEntry,
  replyConversationEntry,
  typedAskConversationEntry,
} from "@sidecar/realtime";
import { MAIN_SESSION_KEY, type SessionKey } from "@sidecar/runtime-contracts";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";
import { BRIDGE } from "#shared/bridge";
import type { GatewayOperator } from "../gateway/operator";
import { registerBridge } from "../register-bridge";

/** The two kinds of window that may submit, and which origin each may claim. */
export interface BrainSubmitters {
  /** Whether this sender is a panel — the composer's window, which submits typed asks. */
  panel(sender: WebContents): boolean;
  /** Whether this sender is the hidden voice window, which relays spoken asks. */
  voice(sender: WebContents): boolean;
}

/** What the publication owner reaches: the thread, every window, and the delivery owner. */
export interface BrainIpcDependencies {
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
   * wait, so a wait that finds its run ended can let the end reach History
   * before the words are granted anywhere.
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
  "request" | "markHistoryRecorded" | "markAskRecorded"
>;

/** Writes a typed ask's own line once, at its acceptance, and marks the run when the thread took it. */
export async function publishAsk(
  agent: BrainPublicationAgent,
  runId: string,
  record: BrainIpcDependencies["recordConversationEntry"],
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
  record: BrainIpcDependencies["recordConversationEntry"],
  sessionKey: SessionKey,
): Promise<BrainRequestRecord | undefined> {
  const current = agent.request(runId);
  if (!current || !isTerminalBrainRequestStatus(current.status)) return undefined;
  if (current.historyRecordedAt !== undefined) return current;
  const words = brainReplyWords(current);
  if (!words) return undefined;
  const at = current.settledAt ?? current.acceptedAt;
  if (!(await record(replyConversationEntry(words, current.runId), at, sessionKey))) {
    return undefined;
  }
  if (!(await agent.markHistoryRecorded(runId, at))) return undefined;
  // Re-read rather than patched: the mark landed on the live record, and a
  // Clear or a replacement in the meantime has taken the record with it.
  const marked = agent.request(runId);
  return marked?.historyRecordedAt !== undefined ? marked : undefined;
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
  record: BrainIpcDependencies["recordConversationEntry"],
  stillFollowing: () => boolean = () => true,
  onEndPublished: BrainIpcDependencies["onEndPublished"] = undefined,
  sessionKey: SessionKey = MAIN_SESSION_KEY,
): Promise<void> {
  for (const snapshot of snapshots) {
    if (!stillFollowing()) return;
    await publishAsk(agent, snapshot.runId, record, sessionKey);
    if (!stillFollowing()) return;
    const published = await publishEnd(agent, snapshot.runId, record, sessionKey);
    if (published && stillFollowing()) onEndPublished?.(published, sessionKey);
  }
}

/**
 * Follows the brain that currently stands: each rebuilt agent is subscribed
 * as it arrives, its records relayed to every window and its runs written to
 * the thread. The subscription is the completion channel the reply delivery
 * reads; the thread write here is the one History write for a run.
 * Unfollowing retires the subscription, drains the publication of the reports
 * already taken, and then relays nothing more, so a replaced agent's records
 * are all written once and its late ones reach neither the thread nor the
 * windows.
 */
export function followBrainRequests(
  agent: BrainAgent,
  dependencies: Pick<
    BrainIpcDependencies,
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

/**
 * Who a window is, as the client alone can tell: the composer's panel types,
 * the hidden voice window speaks and is the one receiver of replies, and
 * neither may claim the other's standing. The host never sees a sender; it
 * sees the origin the client vouched for and, for the voice window alone,
 * the receiver epoch it holds.
 */
export interface BrainIpcRegistration {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  submitters: BrainSubmitters;
  /** The operator client every window's ask crosses to reach the host. */
  operator: GatewayOperator;
}

export function registerBrainIpc(registration: BrainIpcRegistration): void {
  const { ipcMain, trustedSender, submitters, operator } = registration;
  // A child's origin is the runtime's own and never a window's: a submission
  // claiming it is refused whichever window sent it.
  const originAllowed = (sender: WebContents, submission: BrainAskSubmission) => {
    switch (submission.origin) {
      case BRAIN_REQUEST_ORIGIN.TYPED:
        return submitters.panel(sender);
      case BRAIN_REQUEST_ORIGIN.SPOKEN:
        return submitters.voice(sender);
      default:
        return false;
    }
  };
  registerBridge(
    BRIDGE,
    {
      submitBrainAsk(context, submission) {
        if (!originAllowed(context.sender, submission)) return REJECTED_SUBMISSION;
        // Every ask a window submits is main's: the talk key and both
        // composers speak into the one conversation the panel draws.
        return operator.submit(submission, MAIN_SESSION_KEY);
      },
      // The asking call may be granted the words only when it is the voice
      // window's, under the receiver epoch it names; a panel's wait carries
      // no epoch, so the host answers it the record and no grant.
      waitBrainAsk(context, runId, epoch): Promise<BrainAskWait> {
        return operator.wait(runId, submitters.voice(context.sender) ? epoch : undefined);
      },
      cancelBrainAsk: (_context, runId) => operator.cancel(runId),
      brainRequestSnapshots: () => operator.runs(),
      claimBrainReply(context, runId, deliveryId, epoch): Promise<BrainReplyClaimResult> {
        if (!submitters.voice(context.sender)) return Promise.resolve({ granted: false });
        return operator.claim(runId, deliveryId, epoch);
      },
      ackBrainReply(context, runId, deliveryId, epoch) {
        if (!submitters.voice(context.sender)) return;
        void operator.acknowledge(runId, deliveryId, epoch);
      },
    },
    { ipcMain, trustedSender },
  );
}
