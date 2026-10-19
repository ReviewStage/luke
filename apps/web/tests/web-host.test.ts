// @vitest-environment jsdom
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { integrationStatusesViewSchema } from "@luke/features/integration-view";
import { INTEGRATION_PROVIDER, INTEGRATION_STATUS } from "@luke/features/integration-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { THEME } from "@luke/settings";
import { Context, Effect, Layer, Schema } from "effect";
import { afterEach } from "vitest";
import { composeWeb, WebHostTag } from "../src/app/web-host";
import { fakeService } from "./support/fake-service";

/**
 * The shared host as a browser tab composes it, with no panel drawn: what it
 * keeps survives the tab in the browser's storage, and an act the panel
 * sends reaches the service through the in-process bridge and comes back.
 */

/** The host stood up in a scope of its own over the fake given, its acts run on the test's own services. */
const standingHost = (service: ReturnType<typeof fakeService>) =>
  Effect.gen(function* () {
    const services = yield* Effect.context<never>();
    const built = yield* Layer.build(
      composeWeb({
        httpClient: service.layer,
        run: (effect) => Effect.runPromiseWith(services)(effect),
      }),
    );
    return Context.get(built, WebHostTag);
  });

afterEach(() => {
  localStorage.clear();
});

it.effect(
  "a setting written in one tab's host is read back by the next, from the browser's storage",
  () =>
    Effect.gen(function* () {
      const first = yield* Effect.scoped(
        Effect.gen(function* () {
          const { bridge } = yield* standingHost(fakeService({ signedIn: false }));
          return yield* Effect.promise(() =>
            bridge.act({
              kind: ACT_KIND.SETTING_UPDATE,
              payload: { field: "theme", value: THEME.DARK },
            }),
          );
        }),
      );
      assert.equal(first.status, ACT_OUTCOME_STATUS.DONE);

      const reread = yield* Effect.scoped(
        Effect.gen(function* () {
          const { bridge } = yield* standingHost(fakeService({ signedIn: false }));
          return yield* Effect.promise(() => bridge.requestAppState());
        }),
      );
      assert.equal(reread.settings?.stored.theme, THEME.DARK);
    }),
);

it.effect(
  "an act goes through the bridge to the service and back, settling a cookie's pending sign-in",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { bridge } = yield* standingHost(fakeService({ signedIn: true }));

        const outcome = yield* Effect.promise(() =>
          bridge.act({ kind: ACT_KIND.INTEGRATIONS_STATUS }),
        );

        assert.ok(outcome.status === ACT_OUTCOME_STATUS.DONE);
        const statuses = Schema.decodeUnknownSync(integrationStatusesViewSchema)(outcome.value);
        assert.ok(!("failure" in statuses));
        assert.equal(
          statuses.integrations[INTEGRATION_PROVIDER.SLACK],
          INTEGRATION_STATUS.CONNECTED,
        );
      }),
    ),
);
