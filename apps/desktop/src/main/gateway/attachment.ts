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
  let pending: Promise<boolean> | undefined;
  const unsubscribe = ports.onStateChanged((state) => {
    if (state !== GATEWAY_ATTACHMENT.ATTACHED) return;
    const work = ports.onAttached().then(
      () => true,
      (error: Error) => {
        ports.report(`the attachment work failed: ${error.message}`);
        return false;
      },
    );
    pending ??= work;
  });
  const result = await ports.attach();
  if (result.outcome === GATEWAY_ATTACH_OUTCOME.FAILED) {
    unsubscribe();
    return { reached: false, result };
  }
  const reached = (await pending) === true;
  unsubscribe();
  return { reached, result };
}

/**
 * The launch's wait for a host it can read: the first attach and its work,
 * and when that does not reach the host, the next attachment that does,
 * however many retries stand between. Settles once, on the first attachment
 * whose work finished, so a launch runs its tail exactly once and only over
 * a bootstrap it actually read; nothing is invented meanwhile.
 */
export async function waitForHost(ports: AttachmentPorts): Promise<FirstAttachment> {
  const first = await attachAndSettle(ports);
  if (first.reached) return first;
  ports.report("no Gateway was reached at launch; waiting for one");
  return new Promise((resolve) => {
    let settling = false;
    const unsubscribe = ports.onStateChanged((state) => {
      if (state !== GATEWAY_ATTACHMENT.ATTACHED || settling) return;
      settling = true;
      void ports.onAttached().then(
        () => {
          unsubscribe();
          resolve({ reached: true, result: first.result });
        },
        (error: Error) => {
          ports.report(`the attachment work failed: ${error.message}`);
          settling = false;
        },
      );
    });
  });
}

/**
 * The reattachments after the launch's own: installed once `waitForHost` has
 * settled, so every ATTACHED it hears is a Gateway found or started again
 * behind the client, and each runs the attachment work anew: the new stream
 * adopted, the node told again, the bootstrap read. The supervisor announces
 * state changes only, never the standing state, so nothing here is skipped.
 */
export function followReattachments(ports: Omit<AttachmentPorts, "attach">): () => void {
  return ports.onStateChanged((state) => {
    if (state !== GATEWAY_ATTACHMENT.ATTACHED) return;
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
