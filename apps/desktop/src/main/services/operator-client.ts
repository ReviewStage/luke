import { randomUUID } from "node:crypto";
import { ACCOUNT_STATUS, type AccountSnapshot } from "@sidecar/credentials/snapshot";
import { GATEWAY_CLIENT_ROLE, type GatewayServer, InProcessTransport } from "@sidecar/gateway";
import { type AppGuideSnapshot, EMPTY_APP_GUIDE } from "@sidecar/guide";
import { HOST_OPERATOR_CLIENT_ID } from "@sidecar/host";
import type { AppSettings } from "@sidecar/settings/wire";
import { type LateRef, lateRef } from "@sidecar/wire";
import type { WebContents } from "electron";
import { channels } from "#shared/bridge";
import type { SessionReplayBootstrap } from "#shared/messages/session";
import type { HostBootstrap, HostOperator, HostSessionReplay } from "../gateway/host-operator";
import { wireGateway } from "../gateway/wiring";
import type { DesktopConfig } from "./desktop-config";
import type { NativeNodeCapabilities } from "./native-node";
import type { DesktopService } from "./service";

/** What the host's events reach in the windows that draw them. */
export interface OperatorClientLinks {
  broadcast: <Payload>(channel: string, payload: Payload, except?: WebContents) => void;
  sendToVoice: <Payload>(channel: string, payload: Payload) => void;
  webContentsByReporter: (reporter: string) => WebContents | undefined;
  /**
   * A voice that came or went moves the talk key: claimed now that there is
   * something to talk to, or given back to the machine now that there is not.
   */
  reapplyTalkHotkey: () => void;
  /**
   * A later attachment recycles the voice window, because the epoch its
   * renderer holds was the old host's.
   */
  recycleVoiceWindow: () => void;
}

export interface OperatorClient extends DesktopService {
  link: (links: OperatorClientLinks) => void;
  /** The host's own method vocabulary, as this client calls it. */
  readonly host: HostOperator;
  /** The runs, deliveries, and history operations the brain's windows reach. */
  readonly operator: ReturnType<typeof wireGateway>["operator"];
  settings: () => AppSettings | undefined;
  /** The settings this launch decides its windows from, read from the host once and remembered. */
  ensureSettings: () => Promise<AppSettings | undefined>;
  account: () => AccountSnapshot;
  signedIn: () => boolean;
  voiceAvailable: () => boolean;
  /** One host bootstrap, adopted into the caches the synchronous answers read. */
  readBootstrap: () => Promise<HostBootstrap | undefined>;
  sessionReplayBootstrap: () => SessionReplayBootstrap;
  /** Stops recording now, ahead of an act that ends the account it is filed under; the host's next replay event re-answers. */
  haltSessionReplay: () => void;
  resumeSessionReplay: () => void;
  reportGuide: (snapshot: AppGuideSnapshot) => void;
}

export interface OperatorClientDependencies {
  config: DesktopConfig;
  /** The host this client operates, reached over the in-process transport. */
  server: GatewayServer;
  node: NativeNodeCapabilities;
}

/**
 * The one operator this process is. It relays the host's events to the
 * windows that draw them, remembers what a synchronous answer needs, and
 * serves this machine's native capabilities on the same connection as one
 * node. The runtime itself stands on the other side of the transport;
 * nothing here composes a store, a brain, or an observation.
 */
export function createOperatorClient(dependencies: OperatorClientDependencies): OperatorClient {
  const { config } = dependencies;
  const links: LateRef<OperatorClientLinks> = lateRef("the operator client's links");

  /**
   * What this client last heard from the host, for the answers it must give
   * synchronously or when the host cannot be reached: the settings the rows
   * draw, the account the gate opens on, whether a voice stands, and the
   * recording state. Each moves only on a host event or a bootstrap.
   */
  let latestSettings: AppSettings | undefined;
  let account: AccountSnapshot = { status: ACCOUNT_STATUS.SIGNED_OUT };
  let voiceAvailable = false;
  let latestSessionReplay: HostSessionReplay = { permitted: config.runMode.sendsNetwork };
  let sessionReplayHalted = false;
  let appGuide: AppGuideSnapshot = EMPTY_APP_GUIDE;
  let attachments = 0;
  const unsubscribers: (() => void)[] = [];

  const gateway = wireGateway({
    transport: new InProcessTransport(dependencies.server, {
      clientId: HOST_OPERATOR_CLIENT_ID,
      role: GATEWAY_CLIENT_ROLE.OPERATOR,
    }),
    createId: () => randomUUID(),
    report: config.report,
    broadcast: (channel, payload, except) => links.get().broadcast(channel, payload, except),
    sendToVoice: (channel, payload) => links.get().sendToVoice(channel, payload),
    webContentsByReporter: (reporter) => links.get().webContentsByReporter(reporter),
    lastSettings: () => latestSettings,
    node: dependencies.node,
  });

  function sessionReplayBootstrap(): SessionReplayBootstrap {
    return {
      permitted: latestSessionReplay.permitted && !sessionReplayHalted,
      appVersion: config.appVersion,
      ...(latestSessionReplay.accountId ? { accountId: latestSessionReplay.accountId } : undefined),
    };
  }

  function announceSessionReplay(): void {
    links.get().broadcast(channels.onSessionReplayChanged, sessionReplayBootstrap());
  }

  function adoptBootstrap(boot: HostBootstrap): void {
    latestSettings = boot.settings;
    account = boot.account;
    voiceAvailable = boot.voiceAvailable;
    latestSessionReplay = boot.sessionReplay;
  }

  // What the host tells its clients, relayed to the windows by the one client
  // that owns them, and remembered where a synchronous answer needs it.
  unsubscribers.push(
    gateway.host.onSettingsChanged((change) => {
      const stoodVoice = voiceAvailable;
      latestSettings = change.settings;
      voiceAvailable = change.settings.status.voiceAvailable;
      links
        .get()
        .broadcast(
          channels.onSettingsChanged,
          change.settings,
          change.reporter === undefined
            ? undefined
            : links.get().webContentsByReporter(change.reporter),
        );
      if (stoodVoice !== voiceAvailable) links.get().reapplyTalkHotkey();
    }),
    gateway.host.onAccountChanged((next) => {
      account = next;
      links.get().broadcast(channels.onAccountChanged, account);
    }),
    gateway.host.onSessionsChanged((roster) =>
      links.get().broadcast(channels.onSessionsChanged, { sessions: roster.sessions }),
    ),
    gateway.host.onWorkspaceProjectsChanged((projects) =>
      links.get().broadcast(channels.onWorkspaceProjectsChanged, projects),
    ),
    gateway.host.onCalendarsChanged((calendars) =>
      links.get().broadcast(channels.onCalendarsChanged, calendars),
    ),
    gateway.host.onAnnouncementsHeldChanged((held) =>
      links.get().broadcast(channels.onAnnouncementsHeldChanged, held),
    ),
    gateway.host.onSupersetSignInChanged((state) =>
      links.get().broadcast(channels.onSupersetSignInChanged, state),
    ),
    gateway.host.onCalendarOnboardingChanged((owed) =>
      links.get().broadcast(channels.onCalendarOnboardingChanged, owed),
    ),
    gateway.host.onSpeechOffered((offer) =>
      links.get().sendToVoice(channels.onSpeechOffered, offer),
    ),
    gateway.host.onSpeechWithdrawn((id) =>
      links.get().sendToVoice(channels.onSpeechWithdrawn, { id }),
    ),
    gateway.host.onSessionReplayChanged((replay) => {
      latestSessionReplay = replay;
      sessionReplayHalted = false;
      announceSessionReplay();
    }),
  );

  return {
    name: "operator",
    link: (next) => links.set(next),
    host: gateway.host,
    operator: gateway.operator,
    settings: () => latestSettings,
    ensureSettings: async () => {
      latestSettings = latestSettings ?? (await gateway.host.settingsSnapshot());
      return latestSettings;
    },
    account: () => account,
    signedIn: () => account.status === ACCOUNT_STATUS.SIGNED_IN,
    voiceAvailable: () => voiceAvailable,
    readBootstrap: async () => {
      const boot = await gateway.host.bootstrap();
      if (boot) adoptBootstrap(boot);
      return boot;
    },
    sessionReplayBootstrap,
    haltSessionReplay: () => {
      sessionReplayHalted = true;
      announceSessionReplay();
    },
    resumeSessionReplay: () => {
      sessionReplayHalted = false;
      announceSessionReplay();
    },
    reportGuide: (snapshot) => {
      appGuide = snapshot;
      void gateway.host.reportGuide(snapshot);
    },
    /**
     * What every attachment owes the host: its stream adopted and this
     * process's node registered on the connection that now stands, the guide
     * the panel last reported, and a bootstrap read. A host composed in this
     * process is attached once and never goes away; over a transport that can
     * drop, a later attachment tells every window what the host now holds.
     */
    start: async () => {
      attachments += 1;
      await gateway.attached();
      if (appGuide !== EMPTY_APP_GUIDE) void gateway.host.reportGuide(appGuide);
      const boot = await gateway.host.bootstrap();
      if (!boot) throw new Error("the host answered no bootstrap");
      adoptBootstrap(boot);
      if (attachments === 1) return;
      const relay = links.get();
      relay.broadcast(channels.onSettingsChanged, boot.settings);
      relay.broadcast(channels.onAccountChanged, boot.account);
      relay.broadcast(channels.onSessionsChanged, { sessions: boot.sessions });
      relay.broadcast(channels.onWorkspaceProjectsChanged, boot.workspaceProjects);
      relay.broadcast(channels.onCalendarsChanged, boot.calendars);
      relay.broadcast(channels.onAnnouncementsHeldChanged, boot.announcementsHeld);
      relay.broadcast(channels.onCalendarOnboardingChanged, boot.calendarOnboardingOwed);
      relay.broadcast(channels.onSessionReplayChanged, sessionReplayBootstrap());
      relay.reapplyTalkHotkey();
      relay.recycleVoiceWindow();
    },
    stop: async () => {
      while (unsubscribers.length > 0) unsubscribers.pop()?.();
      gateway.client.close();
    },
  };
}
