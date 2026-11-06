import { Effect, Layer } from "effect";
import type { DesktopService, EffectDesktopService } from "./desktop-service.js";

export const serviceLayer = (
  service: DesktopService,
  report: (message: string) => void,
): Layer.Layer<never> =>
  Layer.effectDiscard(
    Effect.andThen(
      Effect.addFinalizer(() =>
        Effect.catchDefect(
          Effect.withErrorReporting(
            Effect.promise(() => service.stop()),
            { defectsOnly: true },
          ),
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

export const effectServiceLayer = (
  service: EffectDesktopService,
  report: (message: string) => void,
): Layer.Layer<never> =>
  Layer.effectDiscard(
    Effect.andThen(
      Effect.addFinalizer(() =>
        Effect.catchDefect(
          Effect.withErrorReporting(service.stop(), { defectsOnly: true }),
          (cause) =>
            Effect.sync(() => {
              report(
                `the ${service.name} service did not stop cleanly: ${cause instanceof Error ? cause.message : String(cause)}`,
              );
            }),
        ),
      ),
      service.start(),
    ),
  );
