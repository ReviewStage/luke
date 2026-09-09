import { DisposableStore, toDisposable } from "@sidecar/wire";
import type { DesktopService } from "./service";

/**
 * Every concern gives back what it began, in the reverse of the order it
 * began in. One that cannot must not strand the rest: a window dispose that
 * throws would otherwise leave the runtime undrained, which is the one thing
 * a quit may not do.
 *
 * `DisposableStore` gives the reverse order and the idempotent one-shot entry
 * for free; what it does not give is sequencing an async `stop()`, since its
 * own `dispose()` is synchronous, so each entry only schedules its service's
 * stop onto a chain rather than awaiting it inline. Disposing the store then
 * runs every entry synchronously, in reverse, which builds the chain in the
 * same order a plain reversed loop would have awaited it in — the later
 * service's stop still finishes before the earlier one's begins.
 */
export async function stopInReverse(
  services: readonly DesktopService[],
  report: (message: string) => void,
): Promise<void> {
  const store = new DisposableStore();
  let chain: Promise<void> = Promise.resolve();
  for (const service of services) {
    store.add(
      toDisposable(() => {
        chain = chain.then(() =>
          service.stop().catch((error: Error) => {
            report(`the ${service.name} service did not stop cleanly: ${error.message}`);
          }),
        );
      }),
    );
  }
  store.dispose();
  return chain;
}
