import {
  GATEWAY_ATTACH_OUTCOME,
  GATEWAY_ATTACHMENT,
  type GatewayAttachment,
  type GatewayAttachResult,
} from "@sidecar/runtime";

/**
 * How the client meets the host at launch and at every reattachment. The
 * supervisor announces ATTACHED the instant a connection is adopted, before
 * `attach()` resolves; what the client owes the host on that connection —
 * adopting its event stream, registering the node, reading the first
 * bootstrap — is asynchronous and must be finished before the launch reads
 * anything the bootstrap decides: whether an account stands, and so whether
 * the introduction plays. So the attachment work is begun on the state
 * change and awaited here, once, by the launch, alongside the attach itself.
 */
export interface AttachmentPorts {
  onStateChanged: (listener: (state: GatewayAttachment) => void) => () => void;
  attach: () => Promise<GatewayAttachResult>;
  /** What every attachment owes the host; the launch awaits the first one. */
  onAttached: () => Promise<void>;
  report: (message: string) => void;
}

export interface FirstAttachment {
  /** Whether a host was attached and its first attachment work finished. */
  reached: boolean;
  result: GatewayAttachResult;
}

/**
 * Attaches and waits for the first attachment's work. A later reattachment
 * runs the same work on its own; the launch never waits on it again.
 */
export async function attachAndSettle(ports: AttachmentPorts): Promise<FirstAttachment> {
  let pending: Promise<void> | undefined;
  const unsubscribe = ports.onStateChanged((state) => {
    if (state !== GATEWAY_ATTACHMENT.ATTACHED) return;
    const work = ports.onAttached().catch((error: Error) => {
      ports.report(`the attachment work failed: ${error.message}`);
    });
    pending ??= work;
  });
  const result = await ports.attach();
  if (result.outcome === GATEWAY_ATTACH_OUTCOME.FAILED) {
    unsubscribe();
    return { reached: false, result };
  }
  await pending;
  unsubscribe();
  return { reached: pending !== undefined, result };
}

/**
 * The reattachments after the first: each runs the attachment work anew, so
 * a Gateway restarted behind the client is adopted as a new stream and told
 * the node again.
 */
export function followReattachments(ports: Omit<AttachmentPorts, "attach">): () => void {
  let first = true;
  return ports.onStateChanged((state) => {
    if (state !== GATEWAY_ATTACHMENT.ATTACHED) return;
    if (first) {
      first = false;
      return;
    }
    void ports.onAttached().catch((error: Error) => {
      ports.report(`the reattachment work failed: ${error.message}`);
    });
  });
}
