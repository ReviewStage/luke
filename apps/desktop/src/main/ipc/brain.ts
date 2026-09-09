import { BRAIN_REQUEST_ORIGIN } from "@sidecar/brain/requests";
import type { BrainAskSubmission } from "@sidecar/brain/requests-wire";
import type { GatewayOperator } from "@sidecar/host";
import { REJECTED_SUBMISSION } from "@sidecar/host";
import { MAIN_SESSION_KEY } from "@sidecar/runtime/vocabulary";
import { ACT_KIND } from "#shared/messages/acts";
import type { ActRows, ActSender } from "../act-router";
import type { ReportHandlers } from "../bridge-host";

/**
 * Who a window is, as the client alone can tell: the composer's panel types,
 * the hidden voice window speaks and is the one receiver of replies, and
 * neither may claim the other's standing. The host never sees a sender; it
 * sees the origin the client vouched for and, for the voice window alone,
 * the receiver epoch it holds.
 */
export interface BrainActDependencies {
  /** The operator client every window's ask crosses to reach the host. */
  operator: GatewayOperator;
  /** Whether the hidden voice window sent this report, which the reports below turn on. */
  isVoice: (sender: Electron.WebContents) => boolean;
}

type BrainActKind =
  | typeof ACT_KIND.BRAIN_SUBMIT_ASK
  | typeof ACT_KIND.BRAIN_WAIT_ASK
  | typeof ACT_KIND.BRAIN_CANCEL_ASK
  | typeof ACT_KIND.BRAIN_CLAIM_REPLY;

// A child's origin is the runtime's own and never a window's: a submission
// claiming it is refused whichever window sent it.
function originAllowed(sender: ActSender, submission: BrainAskSubmission): boolean {
  switch (submission.origin) {
    case BRAIN_REQUEST_ORIGIN.TYPED:
      return sender.panel;
    case BRAIN_REQUEST_ORIGIN.SPOKEN:
      return sender.voice;
    default:
      return false;
  }
}

export function brainActRows(dependencies: BrainActDependencies): Pick<ActRows, BrainActKind> {
  const { operator } = dependencies;
  return {
    [ACT_KIND.BRAIN_SUBMIT_ASK]: ({ submission }, sender) => {
      if (!originAllowed(sender, submission)) return REJECTED_SUBMISSION;
      // Every ask a window submits is main's: the talk key and both composers
      // speak into the one conversation the panel draws.
      return operator.submit(submission, MAIN_SESSION_KEY);
    },
    // The asking call may be granted the words only when it is the voice
    // window's, under the receiver epoch it names; a panel's wait carries no
    // epoch, so the host answers it the record and no grant.
    [ACT_KIND.BRAIN_WAIT_ASK]: ({ runId, epoch }, sender) =>
      operator.wait(runId, sender.voice ? epoch : undefined),
    [ACT_KIND.BRAIN_CANCEL_ASK]: ({ runId }) => operator.cancel(runId),
    [ACT_KIND.BRAIN_CLAIM_REPLY]: ({ runId, deliveryId, epoch }, sender) => {
      if (!sender.voice) return { granted: false };
      return operator.claim(runId, deliveryId, epoch);
    },
  };
}

export function brainReports(
  dependencies: BrainActDependencies,
): Pick<ReportHandlers, "ackBrainReply"> {
  const { operator, isVoice } = dependencies;
  return {
    ackBrainReply(context, runId, deliveryId, epoch) {
      if (!isVoice(context.sender)) return;
      void operator.acknowledge(runId, deliveryId, epoch);
    },
  };
}
