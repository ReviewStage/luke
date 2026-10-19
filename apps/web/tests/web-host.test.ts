// @vitest-environment jsdom
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { integrationStatusesViewSchema } from "@luke/features/integration-view";
import { INTEGRATION_PROVIDER, INTEGRATION_STATUS } from "@luke/features/integration-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { askAct } from "@luke/panel/act";
import { installActPort, installAppBridge } from "@luke/panel/app-bridge";
import { THEME } from "@luke/settings";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { Context, Effect, Layer, Schema } from "effect";
import { afterEach, vi } from "vitest";
import { composeWeb, WebHostTag } from "../src/app/web-host";
import { fakeService, WORKSPACE_MEMBER } from "./support/fake-service";

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
          const { bridge, actPort } = yield* standingHost(fakeService({ signedIn: false }));
          installAppBridge(bridge);
          installActPort(actPort);
          return yield* Effect.promise(() =>
            askAct(ACT_KIND.SETTING_UPDATE, { field: "theme", value: THEME.DARK }),
          );
        }),
      );
      assert.equal(first.status, ACTION_RESULT_STATUS.ACCEPTED);
      assert.equal(first.settings.stored.theme, THEME.DARK);

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

it.effect("an act that rides the act port reaches the service through the tab's own channel", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { bridge, actPort } = yield* standingHost(fakeService({ signedIn: true }));
      installAppBridge(bridge);
      installActPort(actPort);

      const listed = yield* Effect.promise(() =>
        askAct(ACT_KIND.ISSUES_LIST, { workspaceId: "workspace-ada" }),
      );

      assert.deepEqual(listed, { issues: [] });
    }),
  ),
);

it.effect("a workspace act rides the tab's act port to the service and back", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { bridge, actPort } = yield* standingHost(fakeService({ signedIn: true }));
      installAppBridge(bridge);
      installActPort(actPort);

      const members = yield* Effect.promise(() =>
        askAct(ACT_KIND.WORKSPACE_MEMBERS_READ, { workspaceId: "workspace-ada" }),
      );

      assert.deepEqual(members, [WORKSPACE_MEMBER]);
    }),
  ),
);

it.effect(
  "a setting another tab writes reaches this tab's state when the browser says the files changed",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const reader = yield* standingHost(fakeService({ signedIn: false }));
        const writer = yield* standingHost(fakeService({ signedIn: false }));
        assert.equal(
          (yield* Effect.promise(() => reader.bridge.requestAppState())).settings?.stored.theme,
          undefined,
        );

        const written = yield* Effect.promise(() =>
          writer.bridge.act({
            kind: ACT_KIND.SETTING_UPDATE,
            payload: { field: "theme", value: THEME.DARK },
          }),
        );
        assert.equal(written.status, ACT_OUTCOME_STATUS.DONE);
        // The browser tells every tab but the writer's; jsdom holds one window, so the event is
        // said here as the browser would, again until the reader has heard it.
        yield* Effect.promise(() =>
          vi.waitFor(async () => {
            window.dispatchEvent(
              new StorageEvent("storage", { key: "luke.host.files", storageArea: localStorage }),
            );
            const state = await reader.bridge.requestAppState();
            assert.equal(state.settings?.stored.theme, THEME.DARK);
          }),
        );
      }),
    ),
);
