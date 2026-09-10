import {
  BRAIN_ASK_PENDING_NOTE,
  BRAIN_ASK_REFUSAL,
  BRAIN_ASK_STOPPED_NOTE,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_SUBMISSION_OUTCOME,
  brainReplyWords,
} from "@sidecar/brain/requests";
import {
  BRAIN_ASK_PENDING_STATUS,
  type BrainAskResult,
  brainRequestPending,
} from "@sidecar/brain/requests-wire";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import type { ConversationThread } from "./conversation-thread.js";
import type { VoiceBridge } from "./voice-bridge.js";

export interface BrainAskContext {
  bridge: VoiceBridge;
  thread: ConversationThread;
  /** The receiver epoch this load was given, which the grant is named under. */
  epoch: () => number;
  /** How many times the brain's generation has ended under this window. */
  withdrawals: () => number;
}

/**
 * The voice's one tool: the developer's words go to the brain in the main
 * process, which reads, decides, and actions behind its own validators. The tool
 * call's id is the submission, so a call the service repeats finds the run it
 * already has. The reply the follow-up then speaks was recorded by the main
 * process at the run's end, so the words that end on the call are not
 * recorded again.
 */
export async function askBrain(
  context: BrainAskContext,
  question: string,
  submissionId: string,
): Promise<BrainAskResult> {
  // The turn this ask belongs to is the one committed when the ask was made,
  // read before the acceptance is awaited: a turn committed while the brain
  // is deciding is somebody else's words.
  const spokenTurn = context.thread.latestTurn;
  const submitted = await context.bridge.submitBrainAsk({
    submissionId,
    question,
    origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
  });
  if (submitted.outcome !== BRAIN_SUBMISSION_OUTCOME.ACCEPTED) {
    return { status: ACTION_RESULT_STATUS.REJECTED, reason: BRAIN_ASK_REFUSAL[submitted.reason] };
  }
  context.thread.tieTurnToRun(spokenTurn, submitted.runId);
  // The wait names this load's receiver epoch: the words come back for this
  // call to say only if the main process grants them to it, once, with the end
  // already in Conversation. The moment is captured first: a Clear or a withdrawn
  // generation while the wait is held means words granted to it are not said —
  // the follow-up hears the pending note, and Conversation holds nothing of the
  // thread they answered.
  const generation = context.thread.generation;
  const withdrawals = context.withdrawals();
  const waited = await context.bridge.waitBrainAsk(submitted.runId, context.epoch());
  if (!waited.record) {
    return { status: ACTION_RESULT_STATUS.REJECTED, reason: BRAIN_ASK_REFUSAL.absent };
  }
  const moved = generation !== context.thread.generation || withdrawals !== context.withdrawals();
  // A run the developer stopped ended with no reply to grant: the thread holds
  // its quiet line already, and the voice says so rather than "still working".
  if (!brainRequestPending(waited.record) && brainReplyWords(waited.record) === undefined) {
    return { status: ACTION_RESULT_STATUS.REJECTED, reason: BRAIN_ASK_STOPPED_NOTE };
  }
  if (brainRequestPending(waited.record) || !waited.speak || moved) {
    return { status: BRAIN_ASK_PENDING_STATUS, note: BRAIN_ASK_PENDING_NOTE };
  }
  return {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    reply: brainReplyWords(waited.record) ?? "",
    runId: waited.record.runId,
  };
}
