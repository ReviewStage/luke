/**
 * web-host.ts -- the shared host composed in a browser tab: its seams answered by the tab, signed in by the service's cookie, and reached by the panel through the in-process bridge.
 *
 * The host is the desktop's own (`@luke/host`), assembled with no platform
 * concern: no commands or terminal on a Mac and no terminals, so nothing here
 * spawns a process or opens a terminal socket. What the desktop's seams read
 * from the machine the tab answers instead: the settings file in the
 * browser's storage, ids from `crypto`, the service at the origin that
 * served the page, and the account from the session cookie that origin set,
 * which no code here reads or keeps. The voice socket refuses, since the web
 * client runs no voice yet.
 *
 * The panel's acts reach the host's own rows in this process; the few a
 * platform answers itself (a copy, a download, focus, the contact mail, and
 * feedback) are the tab's, and every other platform kind is refused in its
 * own words, so the table stays total. The composition is a `Layer`, built by
 * the tab's one runtime edge (`web-root.tsx`), whose close is the host's
 * drain; `run` is that runtime's, handed in so no act runs anywhere else.
 */

import { feedbackDelivery } from "@luke/features/feedback";
import { highlightSnippet, runModeFor } from "@luke/host";
import { createActPortHandler, refusedPlatformProcedures } from "@luke/host/act-port";
import {
  createHostActRouter,
  type HostActDependencies,
  type PlatformActRows,
  refusedRows,
} from "@luke/host/act-router";
import { ACT_KIND } from "@luke/host/acts";
import { AgentNoticeDoors, type AgentNoticeDoorsSurface } from "@luke/host/agent-notices";
import { RUN_PROFILE } from "@luke/host/app-state";
import type { AppBridge } from "@luke/host/bridge";
import {
  AppStateStore,
  createInProcessBridge,
  createOperatorClient,
  initialAppState,
  linkClientNotices,
  linkNetworkWatch,
  type OperatorClient,
} from "@luke/host/client";
import {
  AppIdentity,
  type CookieSessionDoor,
  cookieAccountSourceLayer,
  type DuplicateGatewayMethod,
  Environment,
  HostAssemblyTag,
  type HostTag,
  hostAssemblyLayer,
  hostCapabilities,
  hostKernelLayer,
  hostStandingLayer,
  IdSource,
  RunMode,
  reporterLayer,
  ServiceOrigin,
  SettingsChangedElsewhere,
  ShutdownSignal,
  StateRoot,
  VoiceSocket,
} from "@luke/host/effect";
import { effectServiceLayer } from "@luke/host/service-layer";
import type { AppPlatform } from "@luke/panel/app-platform";
import { SETTING_SIDE_EFFECT } from "@luke/settings";
import { type OpenSocket, SOCKET_OPEN_FAULT } from "@luke/voice";
import { ConfigProvider, Context, Effect, Layer, Path, Stream } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import packageJson from "../../package.json";
import { FILES_KEY, localStorageFileSystem } from "./local-storage-file-system";
import { downloadText, openTab, webPlatform } from "./web-platform";

/** Where the host in the tab keeps its files, inside the browser's storage (`local-storage-file-system.ts`). */
const STATE_ROOT = "/luke";

/**
 * Where Contact us > Email writes to: the address the site's footer and the
 * desktop's own row name. Held here rather than sent by the panel, so the act
 * can open no other address.
 */
const CONTACT_MAILTO = "mailto:founders@stagereview.app";

/** The path feedback is posted to on the tab's own origin, which takes no credential (`server/feedback.mjs`). */
const FEEDBACK_PATH = "/api/feedback";

/**
 * Every `app:act` kind a platform answers that a browser tab cannot carry
 * yet: the updater, Browser tabs, the microphone, and notifications. The
 * terminals and the Mac's own, the voice, the call window, and the avatar
 * ride the act port, where `refusedPlatformProcedures` refuses them.
 */
const REFUSED_KINDS = [
  ACT_KIND.UPDATE_CHECK,
  ACT_KIND.UPDATE_INSTALL,
  ACT_KIND.UPDATE_OPEN_RELEASE,
  ACT_KIND.UPDATE_OPEN_CHANGELOG,
  ACT_KIND.BROWSER_OPEN,
  ACT_KIND.BROWSER_NAVIGATE,
  ACT_KIND.BROWSER_STEP,
  ACT_KIND.BROWSER_PLACE,
  ACT_KIND.BROWSER_CAPTURE,
  ACT_KIND.BROWSER_CLOSE,
  ACT_KIND.MICROPHONE_REQUEST,
  ACT_KIND.MICROPHONE_ROUTE,
  ACT_KIND.NOTIFICATIONS_OPEN_SETTINGS,
  ACT_KIND.NOTIFICATIONS_TEST,
] as const;

/** The page every act is from: a tab holds one panel and nothing else. */
type WebSender = Window;

/** What the tab's root reads of the host once it stands: the bridge and the act port the panel acts through, and what its platform answers. */
export interface WebHost {
  readonly bridge: AppBridge;
  /** The panel's end of its act port, for the acts that ride oRPC (`@luke/host/contract`). */
  readonly actPort: MessagePort;
  readonly platform: AppPlatform;
}

export class WebHostTag extends Context.Service<WebHostTag, WebHost>()("@luke/web/WebHost") {}

/** What the tab hands the composition. */
export interface WebHostOptions {
  /** The client every service call goes out on: the tab's same-origin fetch, which sends the cookie, or a test's. */
  readonly httpClient: Layer.Layer<HttpClient.HttpClient>;
  /** Every act's Effect, run on the tab's one runtime. */
  readonly run: <A>(effect: Effect.Effect<A>) => Promise<A>;
}

/** The web host as built, with the operator its launch starts beside it. */
interface ComposedWeb extends WebHost {
  readonly operator: OperatorClient;
}

class ComposedWebTag extends Context.Service<ComposedWebTag, ComposedWeb>()(
  "@luke/web/ComposedWeb",
) {}

/** A line about the host's own running, on the tab's console. */
const report = (message: string): void => {
  console.warn(message);
};

/** The voice sideband, which the web client does not open yet: every attempt is answered unreachable. */
const refusedVoiceSocket: OpenSocket = () => Effect.succeed({ fault: SOCKET_OPEN_FAULT.NETWORK });

/**
 * What the cookie session needs of the tab: where it stands, a way to leave
 * for the provider, and each return to it, shown again or focused, on which
 * the session is read again, because another tab may have signed in as
 * someone else.
 */
function cookieDoor(): CookieSessionDoor {
  const shown = Stream.filter(
    Stream.fromEventListener(document, "visibilitychange"),
    () => document.visibilityState === "visible",
  );
  const focused = Stream.fromEventListener(window, "focus");
  return {
    currentAddress: () => `${location.pathname}${location.search}${location.hash}`,
    navigate: (url) => Effect.sync(() => location.assign(url)),
    revisits: Stream.as(Stream.merge(shown, focused), undefined),
  };
}

/** The tab coming forward or going behind, for as long as the listener stands. */
function onTabFocusChanged(listener: (focused: boolean) => void): () => void {
  const forward = () => listener(true);
  const behind = () => listener(false);
  window.addEventListener("focus", forward);
  window.addEventListener("blur", behind);
  return () => {
    window.removeEventListener("focus", forward);
    window.removeEventListener("blur", behind);
  };
}

/**
 * Each write another tab of this origin made to the files this tab's host
 * keeps, which the browser says as a `storage` event in every tab but the
 * writer's. A cleared storage (`key` null) is a change to them too.
 */
function filesChangedElsewhere(): Stream.Stream<void> {
  const changed = Stream.filter(
    Stream.fromEventListener<StorageEvent>(window, "storage"),
    (event) =>
      event.storageArea === localStorage && (event.key === FILES_KEY || event.key === null),
  );
  return Stream.as(changed, undefined);
}

/** Every seam the host's kernel and assembly stand on, as the tab answers it. */
function seamLayers() {
  return Layer.mergeAll(
    Layer.succeed(StateRoot, STATE_ROOT),
    Layer.succeed(RunMode, runModeFor({ capture: false, fixture: false })),
    Layer.succeed(AppIdentity, { appVersion: packageJson.version, packaged: true }),
    // A tab has no environment to read an override from.
    Layer.succeed(Environment, ConfigProvider.fromEnv({ env: {} })),
    Layer.succeed(IdSource, { create: () => crypto.randomUUID() }),
    reporterLayer(report),
    Layer.succeed(ShutdownSignal, { notify: undefined }),
    Layer.succeed(ServiceOrigin, location.origin),
    Layer.succeed(VoiceSocket, refusedVoiceSocket),
    Layer.succeed(SettingsChangedElsewhere, filesChangedElsewhere()),
  );
}

/**
 * Where an agent's end, an inbox item, a failed run, or a chat message is
 * said: the panel's own toast, through the bridge's events once the bridge
 * stands. The tab posts no notification and draws no badge yet.
 */
function noticeDoors(
  said: () => Effect.Success<ReturnType<typeof createInProcessBridge>>["events"] | undefined,
): AgentNoticeDoorsSurface {
  return {
    post: () => undefined,
    toast: ({ place, words, detail, failed }) =>
      said()?.onAgentEnded({ ...place, words, detail, failed }),
    toastInbox: (item) => said()?.onInboxItemOpened(item),
    toastFailedRun: ({ place, words, detail }) => said()?.onRunFailed({ ...place, words, detail }),
    toastChat: (message) => said()?.onChatMessageWaiting(message),
    badge: () => undefined,
  };
}

/** The rows the tab answers itself, and every other platform kind refused. */
function platformRows(http: HttpClient.HttpClient): PlatformActRows<WebSender> {
  const feedback = feedbackDelivery({ url: new URL(FEEDBACK_PATH, location.origin).href });
  return {
    ...refusedRows(REFUSED_KINDS),
    [ACT_KIND.WINDOW_COPY_TEXT]: ({ words }) => navigator.clipboard.writeText(words),
    [ACT_KIND.WINDOW_SAVE_FILE]: ({ name, text }) => downloadText({ name, text }),
    [ACT_KIND.WINDOW_FOCUS_PANEL]: () => window.focus(),
    [ACT_KIND.CONTACT_EMAIL]: () => location.assign(CONTACT_MAILTO),
    [ACT_KIND.FEEDBACK_SEND]: ({ submission }) =>
      Effect.provideService(feedback.deliver(submission), HttpClient.HttpClient, http),
  };
}

/** The host's own rows' dependencies, answered for a tab: no voice, no keys, and links opened in a tab of their own. */
function hostRowDependencies(
  operator: OperatorClient,
  notices: HostActDependencies<WebSender>["codingAgents"]["notices"],
  reporterOf: (sender: WebSender) => string,
): HostActDependencies<WebSender> {
  const host = operator.host;
  const nothing = () => undefined;
  return {
    account: {
      host,
      haltSessionReplay: operator.haltSessionReplay,
      resumeSessionReplay: operator.resumeSessionReplay,
    },
    settings: {
      host,
      reporterOf,
      lastSettings: () => operator.settings(),
      sideEffects: {
        [SETTING_SIDE_EFFECT.NONE]: nothing,
        [SETTING_SIDE_EFFECT.LOGIN_ITEM]: nothing,
        [SETTING_SIDE_EFFECT.VOICE]: nothing,
        [SETTING_SIDE_EFFECT.TALK_HOTKEY]: nothing,
        [SETTING_SIDE_EFFECT.STOP_HOTKEY]: nothing,
        [SETTING_SIDE_EFFECT.MEDIA_DUCK]: nothing,
      },
      // A tab claims no global key, so no chord is ever held.
      stopChordHolder: () => undefined,
    },
    tasks: { host, colourCode: highlightSnippet },
    codingAgents: { host, notices },
    integrations: { host },
    automations: { host },
    factory: { host },
  };
}

/**
 * The act port as the tab opens it: a channel in the page, the host's end
 * upgraded with the act port's handler and the panel's end answered, as the
 * desktop's window root and main open one across a process. The panel is
 * the only page asking, from this build's own origin, so every call is the
 * panel's and trusted; the procedures' effects run on the tab's runtime.
 * Both ends close with the host's scope.
 */
const servedActPort = (
  operator: OperatorClient,
  state: AppStateStore,
  services: Context.Context<never>,
) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const channel = new MessageChannel();
      // Every platform kind on the port is refused, since a tab carries none of them yet.
      createActPortHandler(
        {
          accountAsks: { host: operator.host },
          issues: { host: operator.host },
          // No voice stands in a tab, so a started task opens no call and the microphone's press reaches none.
          tasks: {
            host: operator.host,
            openExternal: async (url) => openTab(url),
            serviceBaseUrl: location.origin,
            activeTaskId: () => state.snapshot().tasks.activeTaskId,
            talkAboutTask: () => undefined,
            voiceReady: () => false,
            callStanding: () => false,
          },
          workspaces: { host: operator.host, openExternal: async (url) => openTab(url) },
        },
        refusedPlatformProcedures<WebSender>(),
      ).upgrade(channel.port2, {
        context: () => ({
          actor: { sender: window, panel: true, voice: false, call: false },
          trusted: true,
          "effect/context": services,
        }),
      });
      channel.port2.start();
      return channel;
    }),
    (channel) =>
      Effect.sync(() => {
        channel.port1.close();
        channel.port2.close();
      }),
  ).pipe(Effect.map((channel) => channel.port1));

/** The host standing in the tab, its document, its bridge, and the platform beside it. */
const composedWeb = (run: WebHostOptions["run"]) =>
  Layer.effect(
    ComposedWebTag,
    Effect.gen(function* () {
      const assembly = yield* HostAssemblyTag;
      const http = yield* HttpClient.HttpClient;
      const services: Context.Context<never> = yield* Effect.context();
      const state = new AppStateStore(
        initialAppState(
          {
            launch: { profile: RUN_PROFILE.IDLE, captureMode: false, fixtureMode: false },
            runMode: runModeFor({ capture: false, fixture: false }),
            appVersion: packageJson.version,
            packaged: true,
            platform: "web",
          },
          false,
          // The tab offers nothing of its own beside the host's concerns yet: notifications come later.
          hostCapabilities(assembly.concerns, []),
        ),
        services,
      );
      const operator = yield* createOperatorClient({
        report,
        gateway: assembly.gateway,
        nodes: assembly.nodes,
        node: { openExternal: async (url) => openTab(url) },
        state,
      });
      // No voice window and no talk key stand beside the panel.
      operator.link({ sendToVoice: () => undefined, reapplyTalkHotkey: () => undefined });
      yield* linkNetworkWatch({ state, isOnline: () => navigator.onLine });

      // The notices' toasts reach the panel through the bridge, which is built
      // over the rows the notices are handed to, so they find it late.
      let events: Effect.Success<ReturnType<typeof createInProcessBridge>>["events"] | undefined;
      const notices = yield* linkClientNotices({
        state,
        host: operator.host,
        presenter: {
          open: (place) => events?.onShowAgent(place),
          openInbox: (taskId) => events?.onShowInbox({ taskId }),
          openTasklessItem: (item) => events?.onShowInboxItem(item),
          openFailedRun: (place) => events?.onShowFailedRun(place),
          openChat: (workspaceId) => events?.onShowChat({ workspaceId }),
        },
        onPanelFocusChanged: onTabFocusChanged,
        report,
      }).pipe(
        Effect.provideService(
          AgentNoticeDoors,
          noticeDoors(() => events),
        ),
      );

      const count: AppPlatform["recordSurfaceEvent"] = (name, properties) => {
        void run(operator.host.recordEvent(name, properties));
      };
      const made = yield* createInProcessBridge<WebSender>({
        sender: window,
        routerFor: (reporterOf) =>
          createHostActRouter(
            hostRowDependencies(operator, notices, reporterOf),
            platformRows(http),
          ),
        run,
        state,
        windowFacts: () => ({ fullScreen: document.fullscreenElement !== null }),
        createId: () => crypto.randomUUID(),
        reports: { notifyReady: () => undefined, recordSurfaceEvent: count },
        report,
      });
      events = made.events;
      const actPort = yield* servedActPort(operator, state, services);
      return {
        bridge: made.bridge,
        actPort,
        platform: webPlatform({ recordSurfaceEvent: count }),
        operator,
      };
    }),
  );

/**
 * The host in the tab, composed and started: the assembly over the tab's
 * seams with no platform concern, then the composers started in the
 * launch's order, then the operator's first bootstrap read into the
 * document, so the panel's first read finds the account already settled.
 * The scope this is built in is the tab's; closing it is the host's drain.
 */
export function composeWeb(
  options: WebHostOptions,
): Layer.Layer<WebHostTag | HostTag, DuplicateGatewayMethod> {
  const { httpClient, run } = options;
  const assembly = Layer.provide(
    hostAssemblyLayer([]),
    Layer.mergeAll(
      Layer.provideMerge(hostKernelLayer, seamLayers()),
      localStorageFileSystem(),
      Path.layer,
      httpClient,
      Layer.provide(cookieAccountSourceLayer(cookieDoor()), httpClient),
    ),
  );
  const launched = Layer.unwrap(
    Effect.map(ComposedWebTag, (web) =>
      Layer.mergeAll(
        Layer.succeed(WebHostTag, {
          bridge: web.bridge,
          actPort: web.actPort,
          platform: web.platform,
        }),
        effectServiceLayer(web.operator, report),
      ).pipe(Layer.provideMerge(hostStandingLayer)),
    ),
  );
  return launched.pipe(
    Layer.provideMerge(composedWeb(run)),
    Layer.provideMerge(assembly),
    Layer.provide(httpClient),
  );
}
