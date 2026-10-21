// @vitest-environment jsdom
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { INTEGRATION_PROVIDER, INTEGRATION_STATUS } from "@luke/features/integration-wire";
import {
  TERMINAL_CONNECTION,
  TERMINAL_PORT_CHANNEL,
  TERMINAL_PORT_MESSAGE,
} from "@luke/features/terminal-acts";
import { ACT_KIND } from "@luke/host/acts";
import { askAct } from "@luke/panel/act";
import { installActPort, installAppBridge } from "@luke/panel/app-bridge";
import { HOST_CAPABILITY, THEME } from "@luke/settings";
import { ACTION_RESULT_STATUS, isRecord, unparsedWire, type WireBoundaryInput } from "@luke/wire";
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
        fork: (effect) => {
          Effect.runForkWith(services)(effect);
        },
      }),
    );
    return Context.get(built, WebHostTag);
  });

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  RelaySocket.opened = [];
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
            askAct(ACT_KIND.BROWSER_OPEN, {
              browserId: "browser-1",
              address: "https://example.com/",
            }).catch((error: Error) => error.message),
          ]),
        );

        assert.deepEqual(copied, ["copied"]);
        assert.deepEqual(focused, ["tab"]);
        assert.deepEqual(refusals, [
          "Could not check for updates on this system.",
          "Could not ask for the microphone on this system.",
          "Could not open that page.",
        ]);
        Reflect.deleteProperty(navigator, "clipboard");
      }),
    ),
);

/** A relay socket the test opens and feeds by hand, keeping what the tab sent on it. */
class RelaySocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static opened: RelaySocket[] = [];
  readyState = RelaySocket.CONNECTING;
  binaryType = "blob";
  readonly sent: string[] = [];
  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    super();
    RelaySocket.opened.push(this);
  }
  send(data: string | Uint8Array): void {
    this.sent.push(typeof data === "string" ? data : `bytes:${new TextDecoder().decode(data)}`);
    this.dispatchEvent(new Event("sent"));
  }
  close(): void {
    this.readyState = RelaySocket.CLOSED;
  }
}

/** Gives the host's fibers turns until `condition` holds, or fails the test if it never does. */
const until = (condition: () => boolean) =>
  Effect.gen(function* () {
    for (let turn = 0; turn < 200 && !condition(); turn += 1) yield* Effect.yieldNow;
    assert.ok(condition(), "the condition did not hold in time");
  });

/** The next `count` messages a port hears, as the page's end of a shell's channel hears them. */
const heardOn = (port: MessagePort, count: number) =>
  Effect.callback<readonly WireBoundaryInput[]>((resume) => {
    const heard: WireBoundaryInput[] = [];
    port.onmessage = (event: MessageEvent<WireBoundaryInput>) => {
      heard.push(event.data);
      if (heard.length === count) resume(Effect.succeed(heard));
    };
  });

/** The next frame the tab sends on a relay socket. */
const nextSent = (socket: RelaySocket) =>
  Effect.callback<void>((resume) => {
    socket.addEventListener("sent", () => resume(Effect.void), { once: true });
  });

it.effect(
  "an agent's Terminal tab attaches from the tab: the shell's relay opened on the tab's own origin with nothing of the page's own, and its port posted to the page",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        vi.stubGlobal("WebSocket", RelaySocket);
        const posted: { message: WireBoundaryInput; origin: string; ports: MessagePort[] }[] = [];
        // jsdom's postMessage carries no port, so the page's own post is read where it is made.
        vi.spyOn(window, "postMessage").mockImplementation(
          ((message: WireBoundaryInput, origin: string, transfer: MessagePort[] = []) =>
            void posted.push({ message, origin, ports: transfer })) as typeof window.postMessage,
        );
        const { bridge, actPort } = yield* standingHost(fakeService({ signedIn: true }));
        installAppBridge(bridge);
        installActPort(actPort);
        const offered = yield* Effect.promise(() => bridge.requestAppState());
        assert.ok(offered.run.capabilities.includes(HOST_CAPABILITY.TERMINALS));

        const agentId = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
        const terminalId = "8b3c7a1e-2f4d-4c6b-9e0a-1d2f3a4b5c6d";
        yield* Effect.promise(() =>
          askAct(ACT_KIND.TERMINAL_ATTACH, { agentId, terminalId, cols: 120, rows: 32 }),
        );
        yield* until(() => RelaySocket.opened.length === 1);
        const [relay] = RelaySocket.opened;
        assert.ok(relay);
        assert.equal(
          relay.url,
          `ws://localhost:3000/api/terminal/sessions?agent=${agentId}&terminal=${terminalId}&cols=120&rows=32`,
        );
        assert.equal(
          relay.protocols,
          undefined,
          "nothing rides the handshake but the browser's own",
        );
        const [post] = posted;
        assert.ok(post);
        assert.deepEqual(post.message, {
          channel: TERMINAL_PORT_CHANNEL,
          ticket: { agentId, terminalId },
        });
        assert.equal(post.origin, "http://localhost:3000");
        const [page] = post.ports;
        assert.ok(page, "the shell's port reaches the page");

        const told = heardOn(page, 3);
        relay.readyState = RelaySocket.OPEN;
        relay.dispatchEvent(new Event("open"));
        relay.dispatchEvent(new MessageEvent("message", { data: '{"type":"attached"}' }));
        relay.dispatchEvent(
          new MessageEvent("message", { data: new TextEncoder().encode("$ ").buffer }),
        );
        const heard = yield* told;
        assert.deepEqual(
          heard.map((message) => {
            // Note that the bytes are read as their text, because a port's copy of them is of Node's realm, not jsdom's.
            const read = unparsedWire(message);
            return isRecord(read) && ArrayBuffer.isView(read.data)
              ? { ...read, data: new TextDecoder().decode(read.data) }
              : read;
          }),
          [
            { type: TERMINAL_PORT_MESSAGE.STATE, state: TERMINAL_CONNECTION.CONNECTING },
            { type: TERMINAL_PORT_MESSAGE.STATE, state: TERMINAL_CONNECTION.ATTACHED },
            { type: TERMINAL_PORT_MESSAGE.OUTPUT, data: "$ " },
          ],
        );

        const typed = nextSent(relay);
        page.postMessage({ type: TERMINAL_PORT_MESSAGE.INPUT, data: "ls\r" });
        yield* typed;
        assert.deepEqual(relay.sent, ["bytes:ls\r"]);
        page.close();
      }),
    ),
);
