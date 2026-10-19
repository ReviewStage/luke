// @vitest-environment jsdom
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { INTEGRATION_PROVIDER, INTEGRATION_STATUS } from "@luke/features/integration-wire";
import { ACT_KIND } from "@luke/host/acts";
import { askAct } from "@luke/panel/act";
import { installActPort, installAppBridge } from "@luke/panel/app-bridge";
import { THEME } from "@luke/settings";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { Context, Effect, Layer } from "effect";
import { afterEach, vi } from "vitest";
import { composeWeb, WebHostTag } from "../src/app/web-host";
import {
  fakeService,
  GITHUB_INSTALL,
  GITHUB_REPOSITORIES,
  NOTION_SIGN_IN,
  WORKSPACE_MEMBER,
} from "./support/fake-service";

/**
 * The shared host as a browser tab composes it, with no panel drawn: what it
 * keeps survives the tab in the browser's storage, an act the panel sends
 * reaches the service through the in-process bridge and comes back, and a
 * connect's address lands in the tab its press opened.
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
  vi.restoreAllMocks();
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
  "an act goes through the tab's act port to the service and back, settling a cookie's pending sign-in",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { bridge, actPort } = yield* standingHost(fakeService({ signedIn: true }));
        installAppBridge(bridge);
        installActPort(actPort);

        const statuses = yield* Effect.promise(() => askAct(ACT_KIND.INTEGRATIONS_STATUS));

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

it.effect("a task act rides the tab's act port to the service and back", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { bridge, actPort } = yield* standingHost(fakeService({ signedIn: true }));
      installAppBridge(bridge);
      installActPort(actPort);

      const listed = yield* Effect.promise(() => askAct(ACT_KIND.TASKS_REPOSITORIES, {}));

      assert.deepEqual(listed, { repositories: GITHUB_REPOSITORIES });
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

        installAppBridge(writer.bridge);
        installActPort(writer.actPort);
        const written = yield* Effect.promise(() =>
          askAct(ACT_KIND.SETTING_UPDATE, { field: "theme", value: THEME.DARK }),
        );
        assert.equal(written.status, ACTION_RESULT_STATUS.ACCEPTED);
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

it.effect(
  "a connect's address, answered after the press, lands in the tab the press opened, cut from the app",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sentTo: string[] = [];
        const app: Window | null = window;
        const tab = {
          closed: false,
          opener: app,
          location: { replace: (url: string) => sentTo.push(url) },
        };
        // SAFETY: the tab's opener is cut, and its `closed` and `location.replace` read, alone, which this holds.
        vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
        const { bridge, actPort, actPortClient } = yield* standingHost(
          fakeService({ signedIn: true }),
        );
        installAppBridge(bridge);
        installActPort(actPort, actPortClient);

        yield* Effect.promise(() =>
          askAct(ACT_KIND.INTEGRATIONS_CONNECT, { provider: INTEGRATION_PROVIDER.NOTION }),
        );

        assert.deepEqual(sentTo, [NOTION_SIGN_IN]);
        // The provider's page reaches nothing of the app's tab.
        assert.equal(tab.opener, null);
      }),
    ),
);

it.effect("a workspace connect on the act port lands in the tab its press opened", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const sentTo: string[] = [];
      const tab = { closed: false, location: { replace: (url: string) => sentTo.push(url) } };
      // SAFETY: the connect reads a tab's `closed` and `location.replace`, and cuts its opener, alone.
      vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
      const { bridge, actPort, actPortClient } = yield* standingHost(
        fakeService({ signedIn: true }),
      );
      installAppBridge(bridge);
      installActPort(actPort, actPortClient);

      yield* Effect.promise(() =>
        askAct(ACT_KIND.WORKSPACE_GITHUB_CONNECT, { workspaceId: "workspace-ada" }),
      );

      assert.deepEqual(sentTo, [GITHUB_INSTALL]);
    }),
  ),
);
