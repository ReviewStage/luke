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

/**
 * Submits one ask to the brain. The words are bounded like a typed one, the
 * origin is checked against the window that sent it — a panel types, the voice
 * window speaks, and neither may claim the other — and the brain's own answer
 * is what comes back. A typed ask the brain accepted enters the thread here,
 * in the words the accepted record holds and at the moment it was accepted,
 * because the panel that typed it holds no thread of its own; a retry that
 * found an earlier run records nothing the thread does not already hold. A
 * spoken ask's words are the voice service's transcript, recorded by the
 * voice window where they were heard, so nothing is recorded for one here.
 */
export async function submitBrainAsk(
  brain: BrainAgent | undefined,
  submission: BrainAskSubmission,
  record: BrainIpcDependencies["recordConversationEntry"],
): Promise<BrainAskSubmissionResult> {
  if (!brain) return REJECTED_SUBMISSION;
  const question = submission.question.trim().slice(0, maximumTypedAskLength);
  const result = await brain.submitAsk({ ...submission, question });
  if (
    result.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED &&
    submission.origin === BRAIN_REQUEST_ORIGIN.TYPED
  ) {
    const accepted = brain.request(result.runId);
    if (accepted) {
      record(typedAskConversationEntry(accepted.question, accepted.runId), accepted.acceptedAt);
    }
  }
  return result;
}

/**
 * The one place a run's end reaches the thread. Every record the brain
 * reports is read for runs that have ended and whose end the thread has not
 * yet taken — the record itself says so, in `historyRecordedAt`, which the
 * brain keeps across reports, rebuilt followers, and launches — and each
 * gets its reply line once, at the moment the run settled, worded from the
 * record by the build. Only a write the thread confirmed marks the run; a
 * write that failed leaves it for the next report to try again. A run the
 * thread has since let go of is not written back: the mark, not the
 * thread's contents, is what says a run was published.
 */
export async function recordEndedRuns(
  agent: Pick<BrainAgent, "markHistoryRecorded">,
  snapshots: readonly BrainRequestSnapshot[],
  record: BrainIpcDependencies["recordConversationEntry"],
): Promise<void> {
  for (const snapshot of snapshots) {
    if (!isTerminalBrainRequestStatus(snapshot.status)) continue;
    if (snapshot.historyRecordedAt !== undefined) continue;
    const words = brainReplyWords(snapshot);
    if (!words) continue;
    const at = snapshot.settledAt ?? snapshot.acceptedAt;
    if (!record(replyConversationEntry(words, snapshot.runId), at)) continue;
    await agent.markHistoryRecorded(snapshot.runId, at);
  }
}

/**
 * Follows the brain that currently stands: each rebuilt agent is subscribed
 * as it arrives, its records relayed to every window and its ended runs
 * written to the thread. The subscription is the completion channel PR 7's
 * delivery reads; the thread write here is the one terminal History write.
 * Unfollowing retires the subscription and any report still on its way, so a
 * replaced agent's late records reach neither the thread nor the windows.
 */
export function followBrainRequests(
  agent: BrainAgent,
  dependencies: Pick<BrainIpcDependencies, "recordConversationEntry" | "broadcastRequests">,
): () => void {
  let following = true;
  let publishing: Promise<void> = Promise.resolve();
  const listener = (records: readonly BrainRequestRecord[]) => {
    if (!following) return;
    dependencies.broadcastRequests(records);
    // Ends are written one report at a time, so two reports of the same end
    // cannot both find it unmarked.
    publishing = publishing.then(() =>
      following ? recordEndedRuns(agent, records, dependencies.recordConversationEntry) : undefined,
    );
  };
  const unsubscribe = agent.subscribe(listener);
  void agent.ready().then(() => listener(agent.requests()));
  return () => {
    following = false;
    unsubscribe();
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
