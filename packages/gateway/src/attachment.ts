import { Duration, Effect, Queue, Ref, type Scope } from "effect";

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
  initialDelayMs?: number;
  maximumDelayMs?: number;
  report: (message: string) => void;
}

function nextDelayMs(delayMs: number, maximumDelayMs: number): number {
  return Math.min(delayMs * 2, maximumDelayMs);
}

/**
 * A failed attach is not the end of the run. A client whose host is not
 * reachable answers the typed disconnected error until an explicit attach,
 * and a host that was merely slow to answer would otherwise leave the client
 * with none for good. So every detachment is followed by another attach
 * after a growing pause, capped, until one attaches or the fiber running this
 * effect is interrupted; nothing is drawn for it, and the disconnected posture
 * stands meanwhile. A client over a socket needs this for every reconnection;
 * the desktop's own in-process operator (`apps/desktop/src/main/services/host-service.ts`)
 * needs it only for the first attach, since nothing in this process can drop
 * the connection once it stands: a first failure there falls into this same
 * policy rather than failing the launch outright.
 *
 * The attempt itself is forked into the ambient `Scope`, so interrupting the
 * fiber that runs this effect — closing that scope — cancels a pause still
 * being waited out and never calls `attach` again; nothing else here needs
 * cancelling, since a repeated "not attached" while one is already pending
 * schedules nothing new.
 */
export function retryAttachWhileDetachedEffect(
  ports: AttachRetryPorts,
): Effect.Effect<never, never, Scope.Scope> {
  const initialDelayMs = ports.initialDelayMs ?? ATTACH_RETRY_DEFAULTS.INITIAL_DELAY_MS;
  const maximumDelayMs = ports.maximumDelayMs ?? ATTACH_RETRY_DEFAULTS.MAXIMUM_DELAY_MS;
  return Effect.gen(function* () {
    const queue = yield* Queue.unbounded<boolean>();
    const unsubscribe = ports.onAttachedChanged((attached) => Queue.unsafeOffer(queue, attached));
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
    const delayRef = yield* Ref.make(initialDelayMs);
    const pendingRef = yield* Ref.make(false);
    if (ports.attached?.() === false) yield* Queue.offer(queue, false);

    while (true) {
      const attached = yield* Queue.take(queue);
      if (attached) {
        yield* Ref.set(delayRef, initialDelayMs);
        continue;
      }
      const pending = yield* Ref.get(pendingRef);
      if (pending) continue;
      yield* Ref.set(pendingRef, true);
      const delayMs = yield* Ref.get(delayRef);
      ports.report(`the Gateway is not attached; trying again in ${Math.round(delayMs / 1000)} s`);
      yield* Effect.forkScoped(
        Effect.gen(function* () {
          yield* Effect.sleep(Duration.millis(delayMs));
          yield* Ref.set(pendingRef, false);
          yield* Effect.tryPromise({ try: () => ports.attach(), catch: () => undefined }).pipe(
            Effect.ignore,
          );
        }),
      );
      yield* Ref.set(delayRef, nextDelayMs(delayMs, maximumDelayMs));
    }
  });
}
