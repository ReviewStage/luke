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
 * the hidden voice window speaks, and neither may claim the other's standing.
 * The host never sees a sender; it sees the origin the client vouched for.
 * A spoken ask no longer crosses here at all — the host composes it from the
 * live session's own transcript — so the voice origin is left to the host's
 * own submission and refused from any window.
 */
export interface BrainActDependencies {
  /** The operator client every window's ask crosses to reach the host. */
  operator: GatewayOperator;
  /** Whether the hidden voice window sent this report, which the reports below turn on. */
  isVoice: (sender: Electron.WebContents) => boolean;
}

type BrainActKind = typeof ACT_KIND.BRAIN_SUBMIT_ASK | typeof ACT_KIND.BRAIN_CANCEL_ASK;

// A typed ask is the panel's. Every other origin — a spoken ask, which the
// host composes from the live transcript itself, and a child's, which is the
// runtime's own — is refused whichever window claims it.
function originAllowed(sender: ActSender, submission: BrainAskSubmission): boolean {
  return submission.origin === BRAIN_REQUEST_ORIGIN.TYPED && sender.panel;
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
    [ACT_KIND.BRAIN_CANCEL_ASK]: ({ runId }) => operator.cancel(runId),
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
