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

export const ATTACH_RETRY_DEFAULTS = {
  /** The first pause before a failed attach is tried again; each next pause doubles up to the cap. */
  INITIAL_DELAY_MS: 5_000,
  MAXIMUM_DELAY_MS: 30_000,
} as const;

export interface AttachRetryPorts {
  onStateChanged: (listener: (state: GatewayAttachment) => void) => () => void;
  /** The state standing when the retries begin; a launch whose first attach already failed starts retrying at once. */
  currentState?: () => GatewayAttachment;
  attach: () => Promise<GatewayAttachResult>;
  setTimeout?: (work: () => void, delayMs: number) => { unref?: () => void } | undefined;
  initialDelayMs?: number;
  maximumDelayMs?: number;
  report: (message: string) => void;
}

/**
 * A failed attach is not the end of the run. The supervisor answers
 * disconnected until an explicit attach, and a Gateway that was merely slow
 * to publish, or a drain that ran out, would otherwise leave a launched
 * desktop with no host for good. So every FAILED state is followed by another
 * attach after a growing pause, capped, until one attaches or the client is
 * stopped; nothing is drawn for it, the disconnected posture stands meanwhile.
 */
export function retryAttachWhileFailed(ports: AttachRetryPorts): () => void {
  const schedule = ports.setTimeout ?? ((work, delayMs) => setTimeout(work, delayMs));
  let delayMs = ports.initialDelayMs ?? ATTACH_RETRY_DEFAULTS.INITIAL_DELAY_MS;
  const maximumDelayMs = ports.maximumDelayMs ?? ATTACH_RETRY_DEFAULTS.MAXIMUM_DELAY_MS;
  let stopped = false;
  let scheduled = false;
  const consider = (state: GatewayAttachment): void => {
    if (state === GATEWAY_ATTACHMENT.STOPPED) {
      stopped = true;
      return;
    }
    if (state === GATEWAY_ATTACHMENT.ATTACHED) {
      delayMs = ports.initialDelayMs ?? ATTACH_RETRY_DEFAULTS.INITIAL_DELAY_MS;
      return;
    }
    if (state !== GATEWAY_ATTACHMENT.FAILED || scheduled || stopped) return;
    scheduled = true;
    ports.report(`the Gateway is not attached; trying again in ${Math.round(delayMs / 1000)} s`);
    const timer = schedule(() => {
      scheduled = false;
      if (stopped) return;
      void ports.attach();
    }, delayMs);
    timer?.unref?.();
    delayMs = Math.min(delayMs * 2, maximumDelayMs);
  };
  const unsubscribe = ports.onStateChanged(consider);
  const standing = ports.currentState?.();
  if (standing !== undefined) consider(standing);
  return () => {
    stopped = true;
    unsubscribe();
  };
}
