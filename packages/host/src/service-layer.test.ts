/**
 * service-layer.test.ts -- a desktop service's stop that dies at quit: reported, to Sentry as well as the line, and the close goes on.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Exit, Layer, Scope } from "effect";
import { effectServiceLayer, serviceLayer } from "./service-layer.js";
import { recordingReporter } from "./testing/recording-reporter.js";

it.effect(
  "a stop that dies is reported to Sentry and on the line, and the services after it still stop",
  () => {
    const sentry = recordingReporter();
    return Effect.gen(function* () {
      const reported: string[] = [];
      const stopped: string[] = [];
      const report = (message: string) => reported.push(message);
      const scope = yield* Scope.make();
      yield* Layer.buildWithScope(
        Layer.mergeAll(
          serviceLayer(
            {
              name: "keychain",
              start: () => Promise.resolve(),
              stop: () => {
                stopped.push("keychain");
                return Promise.resolve();
              },
            },
            report,
          ),
          serviceLayer(
            {
              name: "windows",
              start: () => Promise.resolve(),
              stop: () => Promise.reject(new Error("the panel was already destroyed")),
            },
            report,
          ),
          effectServiceLayer(
            {
              name: "telemetry",
              start: () => Effect.void,
              stop: () => Effect.die(new Error("the flush threw")),
            },
            report,
          ),
        ),
        scope,
      );
      yield* Scope.close(scope, Exit.void);
      assert.deepEqual(stopped, ["keychain"]);
      assert.deepEqual(reported.toSorted(), [
        "the telemetry service did not stop cleanly: the flush threw",
        "the windows service did not stop cleanly: the panel was already destroyed",
      ]);
      assert.deepEqual(sentry.reported.toSorted(), [
        "the flush threw",
        "the panel was already destroyed",
      ]);
    }).pipe(Effect.provide(sentry.layer));
  },
);
