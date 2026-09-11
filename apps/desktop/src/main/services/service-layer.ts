import { Effect, Layer } from "effect";
import type { DesktopService } from "./service";

/**
 * A desktop service as a `Layer`: its `start` runs when the layer is built and
 * its `stop` when the scope the layer was built in closes, so that scope is
 * the service's lifetime and closing it is its stop. The composition builds
 * every one of them in one scope, in the launch's order, which is why the
 * quit is that scope closed and needs no order of its own.
 *
 * The stop is registered before the start runs, not as the release of a
 * successful acquire: every one of these stops is written to give back what a
 * partial or failed start allocated, and is safe to call when the start never
 * ran at all. A stop that cannot finish must not strand the rest either — a
 * window teardown that throws would otherwise leave the runtime undrained,
 * which is the one thing a quit may not do — so it is reported and the close
 * goes on.
 */
export const serviceLayer = (
  service: DesktopService,
  report: (message: string) => void,
): Layer.Layer<never> =>
  Layer.scopedDiscard(
    Effect.zipRight(
      Effect.addFinalizer(() =>
        Effect.catchAllDefect(
          Effect.promise(() => service.stop()),
          (cause) =>
            Effect.sync(() => {
              report(
                `the ${service.name} service did not stop cleanly: ${cause instanceof Error ? cause.message : String(cause)}`,
              );
            }),
        ),
      ),
      Effect.promise(() => service.start()),
    ),
  );
