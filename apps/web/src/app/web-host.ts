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
 * The panel's acts reach the host's own procedures on the act port in this
 * process; the few a platform answers itself (a copy, a download, focus, the
 * contact mail, feedback, and Settings' test notification) are the tab's, and
 * every other platform kind is refused in its own words, so the table stays
 * total. A
 * notice is the panel's toast while the tab is shown and the browser's
 * notification while it is hidden (`web-notices.ts`). The composition is a
 * `Layer`, built by the tab's one runtime edge (`web-root.tsx`), whose close
 * is the host's drain; `run` is that runtime's, handed in so no act runs
 * anywhere else.
 */

import { feedbackDelivery } from "@luke/features/feedback";
import type { LinkPlatform } from "@luke/features/link-open";
import { highlightSnippet, runModeFor } from "@luke/host";
import {
  type ActPortDependencies,
  type AgentProceduresDependencies,
  actPortFor,
  createActPortHandler,
  type PlatformActProcedures,
  refusedPlatformProcedures,
  WindowPushes,
} from "@luke/host/act-port";
import { AgentNoticeDoors } from "@luke/host/agent-notices";
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
import { type ActPortClient, WINDOW_SURFACE_ACT_KIND } from "@luke/host/contract";
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
  PageReturns,
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
import { showToast, TOAST_TONE, withdrawToast } from "@luke/panel/toast";
import { HOST_CAPABILITY, SETTING_SIDE_EFFECT } from "@luke/settings";
import { type OpenSocket, SOCKET_OPEN_FAULT } from "@luke/voice";
import { NOTIFICATIONS_STATUS } from "@luke/voice/settings-controls";
import { ConfigProvider, Context, Effect, Layer, Path, Stream } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import packageJson from "../../package.json";
import { type ConnectTabs, connectTabs, tabBrowser } from "./connect-tab";
import { FILES_KEY, localStorageFileSystem } from "./local-storage-file-system";
import { type PageLeave, tabLeave } from "./page-leave";
import { backOnline, followRelease, pageShownAgain } from "./stale-release";
import {
  notificationsOffered,
  notificationsStatusNow,
  onTabShownChanged,
  type WebNoticeDoors,
  webNoticeDoors,
} from "./web-notices";
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

/** What the tab offers while a page holds unsaved work and a newer release is served, and the one press that takes it. */
const NEW_RELEASE_WORDS = "A new version of Luke is ready";
const NEW_RELEASE_RELOAD = "Reload";
/** What the offer is about, so a newer release's offer takes the older one's place. */
const NEW_RELEASE_SUBJECT = "new-release";

/** The page every act is from: a tab holds one panel and nothing else. */
type WebSender = Window;

/** What the tab's root reads of the host once it stands: the bridge and the act port the panel acts through, and what its platform answers. */
export interface WebHost {
  readonly bridge: AppBridge;
  /** The panel's end of its act port, for the acts that ride oRPC (`@luke/host/contract`). */
  readonly actPort: MessagePort;
  /** What the panel's client of its act port is installed through: a workspace connect's press opens its tab. */
  readonly actPortClient: (client: ActPortClient) => ActPortClient;
  readonly platform: AppPlatform;
}

export class WebHostTag extends Context.Service<WebHostTag, WebHost>()("@luke/web/WebHost") {}

/** What the tab hands the composition. */
export interface WebHostOptions {
  /** The client every service call goes out on: the tab's same-origin fetch, which sends the cookie, or a test's. */
  readonly httpClient: Layer.Layer<HttpClient.HttpClient>;
  /** Every act's Effect, run on the tab's one runtime. */
  readonly run: <A>(effect: Effect.Effect<A>) => Promise<A>;
  /** The platform the tab runs on, which is offered the Mac app only where it is a Mac; the browser's own word where none is given. */
  readonly linkPlatform?: LinkPlatform;
  /** The commit this build is from, which a tab open across a release is reloaded off (`stale-release.ts`); empty or none where the build names none. */
  readonly release?: string;
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
 * for the provider, asking first while a page holds unsaved work, and each
 * return to it, shown again or focused, on which the session is read again,
 * because another tab may have signed in as someone else.
 */
function cookieDoor(tab: PageLeave): CookieSessionDoor {
  const shown = Stream.filter(
    Stream.fromEventListener(document, "visibilitychange"),
    () => document.visibilityState === "visible",
  );
  const focused = Stream.fromEventListener(window, "focus");
  return {
    currentAddress: () => `${location.pathname}${location.search}${location.hash}`,
    navigate: (url) => Effect.sync(() => tab.leave(() => location.assign(url))),
    revisits: Stream.as(Stream.merge(shown, focused), undefined),
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
    // A phone drops the tab's sockets in the background, so its live follows start again as it returns.
    Layer.succeed(PageReturns, Stream.merge(pageShownAgain(), backOnline())),
  );
}

/**
 * Reloads a tab left open across a release as it comes back to the front,
 * or, while a page holds unsaved work, offers the reload as a toast that
 * stands until it is pressed or dismissed; the press still asks before a
 * page's work is lost. It runs for as long as the host stands.
 */
const reloadOnNewRelease = (tab: PageLeave, release: string) => {
  const reload = () => tab.leave(() => location.reload());
  return Effect.forkScoped(
    followRelease({
      release,
      origin: location.origin,
      returns: pageShownAgain(),
      unsavedWork: tab.holdsUnsavedWork,
      reload,
      offerReload: () => {
        withdrawToast(NEW_RELEASE_SUBJECT);
        showToast({
          words: NEW_RELEASE_WORDS,
          tone: TOAST_TONE.ASK,
          subject: NEW_RELEASE_SUBJECT,
          action: { label: NEW_RELEASE_RELOAD, onPress: reload },
          persists: true,
        });
      },
    }),
  );
};

/**
 * Where an agent's end, an inbox item, a failed run, or a chat message is
 * said: the panel's own toast, through the bridge's events once the bridge
 * stands, or the browser's notification while the tab is hidden, and the
 * badge. What the browser answers is written for Settings, and a browser
 * that refuses to build a notification takes the tab's offer of them away,
 * so Settings offers no Notifications page it cannot keep. The badge comes
 * down with the host's scope.
 */
const noticeDoors = (
  state: AppStateStore,
  said: () => Effect.Success<ReturnType<typeof createInProcessBridge>>["events"] | undefined,
) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      webNoticeDoors({
        toasts: {
          toast: ({ place, words, detail, failed }) =>
            said()?.onAgentEnded({ ...place, words, detail, failed }),
          toastInbox: (item) => said()?.onInboxItemOpened(item),
          toastFailedRun: ({ place, words, detail }) =>
            said()?.onRunFailed({ ...place, words, detail }),
          toastChat: (message) => said()?.onChatMessageWaiting(message),
        },
        onAnswered: (status) => {
          if (state.snapshot().notifications.status !== status) {
            state.update({ notifications: { status } });
          }
        },
        onWithdrawn: () => {
          const { run } = state.snapshot();
          state.update({
            run: {
              ...run,
              capabilities: run.capabilities.filter(
                (capability) => capability !== HOST_CAPABILITY.NOTIFICATIONS,
              ),
            },
            notifications: { status: NOTIFICATIONS_STATUS.OFF },
          });
        },
      }),
    ),
    (doors) => Effect.sync(() => doors.close()),
  );

/**
 * The platform procedures the tab answers itself: a copy, a download, focus,
 * the contact mail, Settings' test notification, and feedback. Every other
 * platform kind is refused in its own words, since a page cannot carry it
 * yet: the updater, Browser tabs, the microphone, the system's notification
 * settings, the terminals and the Mac's own, the voice, the call window, and
 * the avatar.
 */
function platformProcedures(
  http: HttpClient.HttpClient,
  doors: WebNoticeDoors,
): PlatformActProcedures<WebSender> {
  const port = actPortFor<WebSender>();
  const feedback = feedbackDelivery({ url: new URL(FEEDBACK_PATH, location.origin).href });
  const KIND = WINDOW_SURFACE_ACT_KIND;
  return {
    ...refusedPlatformProcedures<WebSender>(),
    [KIND.WINDOW_COPY_TEXT]: port[KIND.WINDOW_COPY_TEXT].handler(({ input }) =>
      navigator.clipboard.writeText(input.words),
    ),
    [KIND.WINDOW_SAVE_FILE]: port[KIND.WINDOW_SAVE_FILE].handler(({ input }) =>
      downloadText({ name: input.name, text: input.text }),
    ),
    [KIND.WINDOW_FOCUS_PANEL]: port[KIND.WINDOW_FOCUS_PANEL].handler(() => window.focus()),
    [KIND.CONTACT_EMAIL]: port[KIND.CONTACT_EMAIL].handler(() => location.assign(CONTACT_MAILTO)),
    // Note that this asks for permission only where the press's own ask
    // (`askNotificationsPermission`) has not, and joins it where it still waits.
    [KIND.NOTIFICATIONS_TEST]: port[KIND.NOTIFICATIONS_TEST].handler(() => doors.postTest()),
    [KIND.FEEDBACK_SEND]: port[KIND.FEEDBACK_SEND].effect(function* ({ input }) {
      return yield* Effect.provideService(
        feedback.deliver(input.submission),
        HttpClient.HttpClient,
        http,
      );
    }),
  };
}

/**
 * The act port's procedures' dependencies, answered for a tab: no keys, so
 * no chord is ever held and no setting has a side effect of the tab's, and
 * the tab itself the one window a settings write is reported under.
 */
function portDependencies(
  operator: OperatorClient,
  state: AppStateStore,
  notices: AgentProceduresDependencies["notices"],
  reporter: string,
  tabs: ConnectTabs,
): ActPortDependencies {
  const host = operator.host;
  const nothing = () => undefined;
  return {
    account: {
      host,
      haltSessionReplay: operator.haltSessionReplay,
      resumeSessionReplay: operator.resumeSessionReplay,
    },
    accountAsks: { host },
    agentInbox: { host },
    agents: { host, notices },
    automations: { host },
    factory: { host },
    integrations: { host },
    // Note that nothing is pushed on the tab's port: the tab hears the host
    // through the in-process bridge's own listeners, so its push stream is
    // never opened and this table stays empty.
    pushes: new WindowPushes(),
    taskIssues: { host },
    settings: {
      host,
      reporterOf: (actor) => (actor.sender === window ? reporter : undefined),
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
    // No voice stands in a tab, so a started task opens no call and the microphone's press reaches none.
    tasks: {
      host,
      colourCode: highlightSnippet,
      openExternal: async (url) => tabs.open(url),
      serviceBaseUrl: location.origin,
      activeTaskId: () => state.snapshot().tasks.activeTaskId,
      talkAboutTask: nothing,
      voiceReady: () => false,
      callStanding: () => false,
    },
    workspaces: { host, openExternal: async (url) => tabs.open(url) },
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
  dependencies: ActPortDependencies,
  procedures: PlatformActProcedures<WebSender>,
  services: Context.Context<never>,
) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const channel = new MessageChannel();
      createActPortHandler(dependencies, procedures).upgrade(channel.port2, {
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
const composedWeb = (
  run: WebHostOptions["run"],
  tab: PageLeave,
  linkPlatform: LinkPlatform | undefined,
  release: string,
) =>
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
          // The tab's own offer beside the host's concerns: notifications, where the browser posts them.
          hostCapabilities(
            assembly.concerns,
            notificationsOffered() ? [HOST_CAPABILITY.NOTIFICATIONS] : [],
          ),
        ),
        services,
      );
      // What the site's permission already says, read without asking.
      if (notificationsOffered()) {
        state.update({ notifications: { status: notificationsStatusNow() } });
      }
      // An address the host opens goes to a connect's waiting tab, or opens as a link.
      const tabs = connectTabs(tabBrowser(openTab, tab.leave));
      yield* Effect.acquireRelease(Effect.sync(tabs.listen), (stop) => Effect.sync(stop));
      const operator = yield* createOperatorClient({
        report,
        gateway: assembly.gateway,
        nodes: assembly.nodes,
        node: { openExternal: async (url) => tabs.open(url) },
        state,
      });
      // No voice window and no talk key stand beside the panel.
      operator.link({ sendToVoice: () => undefined, reapplyTalkHotkey: () => undefined });
      yield* linkNetworkWatch({ state, isOnline: () => navigator.onLine });
      yield* reloadOnNewRelease(tab, release);

      // The notices' toasts reach the panel through the bridge, which is built
      // after the notices, so they find it late.
      let events: Effect.Success<ReturnType<typeof createInProcessBridge>>["events"] | undefined;
      const doors = yield* noticeDoors(state, () => events);
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
        onPanelFocusChanged: onTabShownChanged,
        report,
      }).pipe(Effect.provideService(AgentNoticeDoors, doors));

      const count: AppPlatform["recordSurfaceEvent"] = (name, properties) => {
        void run(operator.host.recordEvent(name, properties));
      };
      const made = yield* createInProcessBridge({
        state,
        windowFacts: () => ({ fullScreen: document.fullscreenElement !== null }),
        reports: { notifyReady: () => undefined, recordSurfaceEvent: count },
        report,
      });
      events = made.events;
      const actPort = yield* servedActPort(
        portDependencies(operator, state, notices, crypto.randomUUID(), tabs),
        platformProcedures(http, doors),
        services,
      );
      return {
        bridge: made.bridge,
        actPort,
        actPortClient: tabs.portClient,
        platform: webPlatform(
          { recordSurfaceEvent: count, unsavedWork: tab.unsavedWork },
          linkPlatform,
        ),
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
  const { httpClient, run, linkPlatform, release = "" } = options;
  // The tab's one way out past the panel's leave guard, which the sign-in, a connect, and the platform share.
  const tab = tabLeave();
  const assembly = Layer.provide(
    hostAssemblyLayer([]),
    Layer.mergeAll(
      Layer.provideMerge(hostKernelLayer, seamLayers()),
      localStorageFileSystem(),
      Path.layer,
      httpClient,
      Layer.provide(cookieAccountSourceLayer(cookieDoor(tab)), httpClient),
    ),
  );
  const launched = Layer.unwrap(
    Effect.map(ComposedWebTag, (web) =>
      Layer.mergeAll(
        Layer.succeed(WebHostTag, {
          bridge: web.bridge,
          actPort: web.actPort,
          actPortClient: web.actPortClient,
          platform: web.platform,
        }),
        effectServiceLayer(web.operator, report),
      ).pipe(Layer.provideMerge(hostStandingLayer)),
    ),
  );
  return launched.pipe(
    Layer.provideMerge(composedWeb(run, tab, linkPlatform, release)),
    Layer.provideMerge(assembly),
    Layer.provide(httpClient),
  );
}
