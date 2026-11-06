// @vitest-environment jsdom
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { INTEGRATION_PROVIDER, INTEGRATION_STATUS } from "@repo/features/integration-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { ACT_KIND } from "@repo/host/acts";
import { EVERY_WORKSPACE, RUN_PROFILE } from "@repo/host/app-state";
import { askAct } from "@repo/panel/act";
import { installActPort, installAppBridge } from "@repo/panel/app-bridge";
import { HOST_CAPABILITY, THEME } from "@repo/settings";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { Context, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
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
        fork: (effect) => {
          Effect.runForkWith(services)(effect);
        },
      }),
    );
    return Context.get(built, WebHostTag);
  });

afterEach(() => {
  history.replaceState(null, "", "/");
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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
  "the tab's host holds the account's integrations and settles a cookie session's pending sign-in, which they then draw connected",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const service = fakeService({ signedIn: true });
        const { bridge, actPort } = yield* standingHost(service);
        installAppBridge(bridge);
        installActPort(actPort);
        const slack = Effect.map(
          Effect.promise(() => bridge.requestAppState()),
          (state) =>
            Object.values(state[LIVE_READ.INTEGRATIONS])[0]?.rows?.integrations[
              INTEGRATION_PROVIDER.SLACK
            ],
        );
        /** Gives the host's fibers turns, the clock a second on before each, until the tab's state draws Slack as `status`. */
        const drawsSlack = (status: string) =>
          Effect.gen(function* () {
            for (let second = 0; second < 60 && (yield* slack) !== status; second += 1) {
              yield* TestClock.adjust("1 second");
              for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
            }
            assert.equal(yield* slack, status);
          });

        const hold = yield* Effect.promise(() => askAct(ACT_KIND.INTEGRATIONS_FOLLOW));
        yield* drawsSlack(INTEGRATION_STATUS.PENDING);
        assert.equal(service.settled(), false, "nothing is settled before its interval");
        yield* drawsSlack(INTEGRATION_STATUS.CONNECTED);
        assert.equal(service.settled(), true, "the host settled it, with no panel drawn");
        yield* Effect.promise(async () => {
          await hold.return?.(undefined);
        });
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
        askAct(ACT_KIND.WORKSPACE_MEMBER_REMOVE, {
          workspaceId: "workspace-ada",
          userId: "user-grace",
        }),
      );

      assert.deepEqual(members, [WORKSPACE_MEMBER]);
    }),
  ),
);

it.effect("a task read the tab holds is read from the service into the tab's state", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { bridge, actPort } = yield* standingHost(fakeService({ signedIn: true }));
      installAppBridge(bridge);
      installActPort(actPort);

      yield* Effect.promise(() => askAct(ACT_KIND.TASKS_REPOSITORIES_FOLLOW, {}));

      yield* Effect.promise(() =>
        vi.waitFor(async () => {
          const state = await bridge.requestAppState();
          assert.deepEqual(
            state[LIVE_READ.REPOSITORY_LISTS][EVERY_WORKSPACE]?.rows,
            GITHUB_REPOSITORIES,
          );
        }),
      );
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
              new StorageEvent("storage", { key: "app.host.files", storageArea: localStorage }),
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
          sessionStorage: { setItem: () => undefined },
        };
        // SAFETY: the tab's opener is cut, and its `closed`, `location.replace`, and `sessionStorage.setItem` read, alone, which this holds.
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
      const tab = {
        closed: false,
        location: { replace: (url: string) => sentTo.push(url) },
        sessionStorage: { setItem: () => undefined },
      };
      // SAFETY: the connect reads a tab's `closed`, `location.replace`, and `sessionStorage.setItem`, and cuts its opener, alone.
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

it.effect(
  "the tab carries a copy and a focus on the act port, and refuses the updater, the microphone, and a Browser tab in their own words",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const copied: string[] = [];
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText: async (words: string) => void copied.push(words) },
        });
        const focused: string[] = [];
        vi.spyOn(window, "focus").mockImplementation(() => void focused.push("tab"));
        const { bridge, actPort } = yield* standingHost(fakeService({ signedIn: true }));
        installAppBridge(bridge);
        installActPort(actPort);

        yield* Effect.promise(() => askAct(ACT_KIND.WINDOW_COPY_TEXT, { words: "copied" }));
        yield* Effect.promise(() => askAct(ACT_KIND.WINDOW_FOCUS_PANEL));
        const refusals = yield* Effect.promise(() =>
          Promise.all([
            askAct(ACT_KIND.UPDATE_CHECK).catch((error: Error) => error.message),
            askAct(ACT_KIND.MICROPHONE_REQUEST).catch((error: Error) => error.message),
          ]),
        );

        assert.deepEqual(copied, ["copied"]);
        assert.deepEqual(focused, ["tab"]);
        assert.deepEqual(refusals, [
          "Could not check for updates on this system.",
          "Could not ask for the microphone on this system.",
        ]);
        Reflect.deleteProperty(navigator, "clipboard");
      }),
    ),
);

it.effect("a browser tab offers no Terminal tab, since its shells run on a Mac", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { bridge } = yield* standingHost(fakeService({ signedIn: true }));
      const offered = yield* Effect.promise(() => bridge.requestAppState());
      assert.ok(!offered.run.capabilities.includes(HOST_CAPABILITY.TERMINALS));
    }),
  ),
);

/** The run the host states for a tab opened at an address, in a build whose `DEV` is as given. */
const runAt = (address: string, development: boolean) =>
  Effect.scoped(
    Effect.gen(function* () {
      vi.stubEnv("DEV", development);
      history.replaceState(null, "", address);
      const { bridge } = yield* standingHost(fakeService({ signedIn: false }));
      return (yield* Effect.promise(() => bridge.requestAppState())).run;
    }),
  );

it.effect(
  "a development tab opened with ?fixture= names the profile and runs on fixture data",
  () =>
    Effect.gen(function* () {
      const run = yield* runAt(`/app?fixture=${RUN_PROFILE.AGENT_CHECKS}`, true);

      assert.equal(run.fixtureMode, true);
      assert.equal(run.profile, RUN_PROFILE.AGENT_CHECKS);
    }),
);

it.effect("a development tab opened with a word that is no profile stays live", () =>
  Effect.gen(function* () {
    const run = yield* runAt("/app?fixture=nope", true);

    assert.equal(run.fixtureMode, false);
    assert.equal(run.profile, RUN_PROFILE.IDLE);
  }),
);

it.effect("a production build ignores ?fixture=", () =>
  Effect.gen(function* () {
    const run = yield* runAt(`/app?fixture=${RUN_PROFILE.TASKS}`, false);

    assert.equal(run.fixtureMode, false);
    assert.equal(run.profile, RUN_PROFILE.IDLE);
  }),
);
