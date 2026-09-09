import { BRAIN_REQUEST_ORIGIN } from "@sidecar/brain/requests";
import type {
  BrainAskSubmission,
  BrainAskWait,
  BrainReplyClaimResult,
} from "@sidecar/brain/requests-wire";
import type { GatewayOperator } from "@sidecar/host";
import { REJECTED_SUBMISSION } from "@sidecar/host";
import { MAIN_SESSION_KEY } from "@sidecar/runtime/vocabulary";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";
import { BRIDGE } from "#shared/bridge";
import { registerBridge } from "../register-bridge";

/** The two kinds of window that may submit, and which origin each may claim. */
export interface BrainSubmitters {
  /** Whether this sender is a panel — the composer's window, which submits typed asks. */
  panel(sender: WebContents): boolean;
  /** Whether this sender is the hidden voice window, which relays spoken asks. */
  voice(sender: WebContents): boolean;
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
