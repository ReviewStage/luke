export const ATTACH_RETRY_DEFAULTS = {
  /** The first pause before a failed attach is tried again; each next pause doubles up to the cap. */
  INITIAL_DELAY_MS: 5_000,
  MAXIMUM_DELAY_MS: 30_000,
} as const;

export interface AttachRetryPorts {
  /** Hears every change in whether a host stands; a standing state is never announced. */
  onAttachedChanged: (listener: (attached: boolean) => void) => () => void;
  /** Whether one stands as the retries begin; a client whose first attach already failed retries at once. */
  attached?: () => boolean;
  /** Tries once to reach a host; whether it did is heard on the attached stream, not answered here. */
  attach: () => Promise<void>;
  setTimeout?: (work: () => void, delayMs: number) => { unref?: () => void } | undefined;
  initialDelayMs?: number;
  maximumDelayMs?: number;
  report: (message: string) => void;
}

/**
 * A failed attach is not the end of the run. A client whose host is not
 * reachable answers the typed disconnected error until an explicit attach,
 * and a host that was merely slow to answer would otherwise leave the client
 * with none for good. So every detachment is followed by another attach
 * after a growing pause, capped, until one attaches or the returned release
 * ends the retries; nothing is drawn for it, and the disconnected posture
 * stands meanwhile. This is the policy a client over a socket needs; the
 * client composed in this process reaches its host without one.
 */
export function retryAttachWhileDetached(ports: AttachRetryPorts): () => void {
  const schedule = ports.setTimeout ?? ((work, delayMs) => setTimeout(work, delayMs));
  const initialDelayMs = ports.initialDelayMs ?? ATTACH_RETRY_DEFAULTS.INITIAL_DELAY_MS;
  const maximumDelayMs = ports.maximumDelayMs ?? ATTACH_RETRY_DEFAULTS.MAXIMUM_DELAY_MS;
  let delayMs = initialDelayMs;
  let released = false;
  let scheduled = false;
  const consider = (attached: boolean): void => {
    if (attached) {
      delayMs = initialDelayMs;
      return;
    }
    if (scheduled || released) return;
    scheduled = true;
    ports.report(`the Gateway is not attached; trying again in ${Math.round(delayMs / 1000)} s`);
    const timer = schedule(() => {
      scheduled = false;
      if (released) return;
      void ports.attach();
    }, delayMs);
    timer?.unref?.();
    delayMs = Math.min(delayMs * 2, maximumDelayMs);
  };
  const unsubscribe = ports.onAttachedChanged(consider);
  if (ports.attached?.() === false) consider(false);
  return () => {
    released = true;
    unsubscribe();
  };
}
