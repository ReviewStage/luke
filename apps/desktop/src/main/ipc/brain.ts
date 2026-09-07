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
  /** Records one line in the shared thread; the main process is the thread's store. */
  recordConversationEntry: (entry: ConversationEntry) => void;
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
 * under its run's id, because the panel that typed it holds no thread of its
 * own; a spoken ask's words are the voice service's transcript, recorded by
 * the voice window where they were heard, so nothing is recorded for one here.
 */
export async function submitBrainAsk(
  brain: BrainAgent | undefined,
  submission: BrainAskSubmission,
  record: (entry: ConversationEntry) => void,
): Promise<BrainAskSubmissionResult> {
  if (!brain) return REJECTED_SUBMISSION;
  const question = submission.question.trim().slice(0, maximumTypedAskLength);
  const result = await brain.submitAsk({ ...submission, question });
  if (
    result.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED &&
    submission.origin === BRAIN_REQUEST_ORIGIN.TYPED
  ) {
    record(typedAskConversationEntry(question, result.runId));
  }
  return result;
}

/**
 * The one place a run's end reaches the thread. Every record the brain
 * reports is read for the runs that have ended since the last report, and
 * each gets its reply line exactly once, worded from the record by the
 * build; the thread's own request correlation refuses a second line for the
 * same run, so a report heard twice — or a launch that finds the last one's
 * interrupted runs — adds nothing it already holds. The renderer that speaks
 * the words records none of its own for a run.
 */
export function recordEndedRuns(
  snapshots: readonly BrainRequestSnapshot[],
  record: (entry: ConversationEntry) => void,
): void {
  for (const snapshot of snapshots) {
    if (!isTerminalBrainRequestStatus(snapshot.status)) continue;
    const words = brainReplyWords(snapshot);
    if (words) record(replyConversationEntry(words, snapshot.runId));
  }
}

/**
 * Follows the brain that currently stands: each rebuilt agent is subscribed
 * as it arrives, its records relayed to every window and its ended runs
 * written to the thread. The subscription is the completion channel PR 7's
 * delivery reads; the thread write here is the one terminal History write.
 */
export function followBrainRequests(
  agent: BrainAgent,
  dependencies: Pick<BrainIpcDependencies, "recordConversationEntry" | "broadcastRequests">,
): () => void {
  const listener = (records: readonly BrainRequestRecord[]) => {
    recordEndedRuns(records, dependencies.recordConversationEntry);
    dependencies.broadcastRequests(records);
  };
  const unsubscribe = agent.subscribe(listener);
  void agent.ready().then(() => listener(agent.requests()));
  return unsubscribe;
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
