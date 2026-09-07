import type { BrainAgent, BrainRequestRecord } from "@sidecar/brain";
import { BRAIN_DEFAULTS } from "@sidecar/brain";
import {
  BRAIN_REQUEST_ORIGIN,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
  isTerminalBrainRequestStatus,
} from "@sidecar/brain/requests";
import {
  type ConversationEntry,
  maximumTypedAskLength,
  replyConversationEntry,
  typedAskConversationEntry,
} from "@sidecar/realtime";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";
import { BRIDGE } from "#shared/bridge";
import {
  type BrainAskSubmission,
  type BrainAskSubmissionResult,
  type BrainRequestSnapshot,
  brainReplyWords,
} from "#shared/wire/brain";
import { registerBridge } from "../register-bridge";

/** The two kinds of window that may submit, and which origin each may claim. */
export interface BrainSubmitters {
  /** Whether this sender is a panel — the composer's window, which submits typed asks. */
  panel(sender: WebContents): boolean;
  /** Whether this sender is the hidden voice window, which relays spoken asks. */
  voice(sender: WebContents): boolean;
}

export interface BrainIpcDependencies {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  /** The brain as it stands now, or nothing on a run with no key to run it on. */
  brain: () => BrainAgent | undefined;
  submitters: BrainSubmitters;
  /**
   * Records one line in the shared thread at the moment given, answering
   * whether the thread took it; the main process is the thread's store. A
   * line the thread already holds for that run answers true, because holding
   * it is the whole of what was asked.
   */
  recordConversationEntry: (entry: ConversationEntry, recordedAt: number) => boolean;
  /** Hands the whole list of records to every window. */
  broadcastRequests: (snapshots: readonly BrainRequestSnapshot[]) => void;
  /** How long one wait holds before answering the run still pending. */
  askWaitMs?: number;
}

const REJECTED_SUBMISSION: BrainAskSubmissionResult = {
  outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
  reason: BRAIN_SUBMISSION_REJECTION.ABSENT,
};

/** The part of the agent publication reads and marks: the live record, and the two marks. */
export type BrainPublicationAgent = Pick<
  BrainAgent,
  "request" | "markHistoryRecorded" | "markAskRecorded"
>;

/**
 * Submits one ask to the brain. The words are bounded like a typed one, the
 * origin is checked against the window that sent it — a panel types, the voice
 * window speaks, and neither may claim the other — and the brain's own answer
 * is what comes back. A typed ask the brain accepted is written into the
 * thread here, in the words the accepted record holds and at the moment it
 * was accepted, because the panel that typed it holds no thread of its own;
 * a write the thread refused leaves the run unmarked, and the follower's next
 * report writes it. The acceptance itself stands whatever the thread did. A
 * spoken ask's words are the voice service's transcript, recorded by the voice
 * window where they were heard, so nothing is recorded for one here.
 */
export async function submitBrainAsk(
  brain: BrainAgent | undefined,
  submission: BrainAskSubmission,
  record: BrainIpcDependencies["recordConversationEntry"],
): Promise<BrainAskSubmissionResult> {
  if (!brain) return REJECTED_SUBMISSION;
  const question = submission.question.trim().slice(0, maximumTypedAskLength);
  const result = await brain.submitAsk({ ...submission, question });
  if (result.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED) {
    await publishAsk(brain, result.runId, record);
  }
  return result;
}

/** Writes a typed ask's own line once, at its acceptance, and marks the run when the thread took it. */
async function publishAsk(
  agent: BrainPublicationAgent,
  runId: string,
  record: BrainIpcDependencies["recordConversationEntry"],
): Promise<void> {
  const current = agent.request(runId);
  if (!current || current.origin !== BRAIN_REQUEST_ORIGIN.TYPED) return;
  if (current.askRecordedAt !== undefined) return;
  if (!record(typedAskConversationEntry(current.question, current.runId), current.acceptedAt)) {
    return;
  }
  await agent.markAskRecorded(runId, current.acceptedAt);
}

/** Writes a run's end once, at the moment it settled, and marks the run when the thread took it. */
async function publishEnd(
  agent: BrainPublicationAgent,
  runId: string,
  record: BrainIpcDependencies["recordConversationEntry"],
): Promise<void> {
  const current = agent.request(runId);
  if (!current || !isTerminalBrainRequestStatus(current.status)) return;
  if (current.historyRecordedAt !== undefined) return;
  const words = brainReplyWords(current);
  if (!words) return;
  const at = current.settledAt ?? current.acceptedAt;
  if (!record(replyConversationEntry(words, current.runId), at)) return;
  await agent.markHistoryRecorded(runId, at);
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
): Promise<void> {
  for (const snapshot of snapshots) {
    if (!stillFollowing()) return;
    await publishAsk(agent, snapshot.runId, record);
    if (!stillFollowing()) return;
    await publishEnd(agent, snapshot.runId, record);
  }
}

/**
 * Follows the brain that currently stands: each rebuilt agent is subscribed
 * as it arrives, its records relayed to every window and its runs written to
 * the thread. The subscription is the completion channel PR 7's delivery
 * reads; the thread write here is the one History write for a run.
 * Unfollowing retires the subscription, drains the publication of the reports
 * already taken, and then relays nothing more, so a replaced agent's records
 * are all written once and its late ones reach neither the thread nor the
 * windows.
 */
export function followBrainRequests(
  agent: BrainAgent,
  dependencies: Pick<BrainIpcDependencies, "recordConversationEntry" | "broadcastRequests">,
): () => Promise<void> {
  let accepting = true;
  let following = true;
  let publishing: Promise<void> = Promise.resolve();
  const listener = (records: readonly BrainRequestRecord[]) => {
    if (!accepting) return;
    dependencies.broadcastRequests(records);
    // Reports are published one at a time, each against the records as they
    // then stand, so two reports of the same end cannot both find it unmarked.
    publishing = publishing.then(() =>
      publishRuns(agent, records, dependencies.recordConversationEntry, () => following),
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

export function registerBrainIpc(dependencies: BrainIpcDependencies): void {
  const { ipcMain, trustedSender, brain, submitters } = dependencies;
  const askWaitMs = dependencies.askWaitMs ?? BRAIN_DEFAULTS.ASK_WAIT_MS;
  const originAllowed = (sender: WebContents, submission: BrainAskSubmission) =>
    submission.origin === BRAIN_REQUEST_ORIGIN.TYPED
      ? submitters.panel(sender)
      : submitters.voice(sender);
  registerBridge(
    BRIDGE,
    {
      submitBrainAsk(context, submission) {
        if (!originAllowed(context.sender, submission)) return REJECTED_SUBMISSION;
        return submitBrainAsk(brain(), submission, dependencies.recordConversationEntry);
      },
      waitBrainAsk: (_context, runId) => brain()?.waitAsk(runId, askWaitMs),
      cancelBrainAsk: (_context, runId) => brain()?.cancelAsk(runId),
      brainRequestSnapshots: () => brain()?.requests() ?? [],
    },
    { ipcMain, trustedSender },
  );
}
