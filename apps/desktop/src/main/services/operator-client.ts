import { randomUUID } from "node:crypto";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { GATEWAY_CLIENT_ROLE, type GatewayServer, InProcessTransport } from "@sidecar/gateway";
import { type AppGuideSnapshot, EMPTY_APP_GUIDE } from "@sidecar/guide";
import { HOST_OPERATOR_CLIENT_ID } from "@sidecar/host";
import { SUPERSET_SIGN_IN_STAGE } from "@sidecar/providers/superset/sign-in-stage";
import type { AppSettings } from "@sidecar/settings/wire";
import { type LateRef, lateRef } from "@sidecar/wire";
import { channels } from "#shared/bridge";
import { type AppStateStore, bootstrapPatch } from "../app-state";
import type { HostBootstrap, HostOperator } from "../gateway/host-operator";
import { wireGateway } from "../gateway/wiring";
import type { DesktopConfig } from "./desktop-config";
import type { NativeNodeCapabilities } from "./native-node";
import type { DesktopService } from "./service";

/** What the host's events reach in the windows that draw them. */
export interface OperatorClientLinks {
  sendToVoice: <Payload>(channel: string, payload: Payload) => void;
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
  /** The settings this launch decides its windows from, read from the host once and written down. */
  ensureSettings: () => Promise<AppSettings | undefined>;
  signedIn: () => boolean;
  voiceAvailable: () => boolean;
  /** One host bootstrap, adopted into the document every window is answered from. */
  readBootstrap: () => Promise<HostBootstrap | undefined>;
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
  /** Everything the host says, written down once; the windows are told from it. */
  state: AppStateStore;
}

/**
 * The one operator this process is. It relays the host's events to the
 * windows that draw them, remembers what a synchronous answer needs, and
 * serves this machine's native capabilities on the same connection as one
 * node. The runtime itself stands on the other side of the transport;
 * nothing here composes a store, a brain, or an observation.
 */
export function createOperatorClient(dependencies: OperatorClientDependencies): OperatorClient {
  const { config, state } = dependencies;
  const links: LateRef<OperatorClientLinks> = lateRef("the operator client's links");

  /**
   * Whether a voice stands at all, which is the one thing this client decides
   * for itself rather than draws: the keys ask it before claiming a chord and
   * the mint asks it before the introduction's own. Everything else the host
   * says goes into the document.
   */
  let voiceAvailable = false;
  let attachments = 0;
  const unsubscribers: (() => void)[] = [];

  const gateway = wireGateway({
    transport: new InProcessTransport(dependencies.server, {
      clientId: HOST_OPERATOR_CLIENT_ID,
      role: GATEWAY_CLIENT_ROLE.OPERATOR,
    }),
    createId: () => randomUUID(),
    report: config.report,
    sendToVoice: (channel, payload) => links.get().sendToVoice(channel, payload),
    state,
    node: dependencies.node,
  });

  function adoptBootstrap(boot: HostBootstrap): void {
    voiceAvailable = boot.voiceAvailable;
    state.update(bootstrapPatch(state.snapshot(), boot));
  }

  // What the host tells its clients, written to the document the windows are
  // told from. The two offers a receiver alone may take are not state and
  // reach the voice window directly.
  unsubscribers.push(
    gateway.host.onSettingsChanged((change) => {
      const stoodVoice = voiceAvailable;
      voiceAvailable = change.settings.status.voiceAvailable;
      state.update({ settings: change.settings });
      if (stoodVoice !== voiceAvailable) links.get().reapplyTalkHotkey();
    }),
    gateway.host.onAccountChanged((account) => {
      state.update({ account });
    }),
    gateway.host.onSessionsChanged((roster) => {
      state.update({
        sessions: {
          ...state.snapshot().sessions,
          roster: { sessions: roster.sessions },
          settled: true,
        },
      });
    }),
    gateway.host.onWorkspaceProjectsChanged((workspaceProjects) => {
      state.update({ sessions: { ...state.snapshot().sessions, workspaceProjects } });
    }),
    gateway.host.onCalendarsChanged((calendars) => {
      state.update({ calendars });
    }),
    gateway.host.onAnnouncementsHeldChanged((held) => {
      state.update({ announcements: { held } });
    }),
    // The stage is also what answers for the connection between two host
    // reads: the bootstrap probes the CLI's own login configuration, and a
    // sign-in carried through — or a sign-out — moves this first.
    gateway.host.onSupersetSignInChanged((signIn) => {
      state.update({
        superset: {
          ...state.snapshot().superset,
          connected: signIn.stage === SUPERSET_SIGN_IN_STAGE.CONNECTED,
          signIn,
        },
      });
    }),
    gateway.host.onCalendarOnboardingChanged((calendarOwed) => {
      state.update({ onboarding: { calendarOwed } });
    }),
    gateway.host.onSpeechOffered((offer) =>
      links.get().sendToVoice(channels.onSpeechOffered, offer),
    ),
    gateway.host.onSpeechWithdrawn((id) =>
      links.get().sendToVoice(channels.onSpeechWithdrawn, { id }),
    ),
    // The host's own answer about recording stands the halt down: it is the
    // account transition the halt was waiting on.
    gateway.host.onSessionReplayChanged((replay) => {
      state.update({ sessionReplay: { ...replay, halted: false } });
    }),
  );

  function setSessionReplayHalted(halted: boolean): void {
    state.update({ sessionReplay: { ...state.snapshot().sessionReplay, halted } });
  }

  return {
    name: "operator",
    link: (next) => links.set(next),
    host: gateway.host,
    operator: gateway.operator,
    settings: () => state.snapshot().settings,
    ensureSettings: async () => {
      const held = state.snapshot().settings;
      if (held) return held;
      const settings = await gateway.host.settingsSnapshot();
      if (settings) state.update({ settings });
      return settings;
    },
    signedIn: () => state.snapshot().account.status === ACCOUNT_STATUS.SIGNED_IN,
    voiceAvailable: () => voiceAvailable,
    readBootstrap: async () => {
      const boot = await gateway.host.bootstrap();
      if (boot) adoptBootstrap(boot);
      return boot;
    },
    haltSessionReplay: () => setSessionReplayHalted(true),
    resumeSessionReplay: () => setSessionReplayHalted(false),
    reportGuide: (guide) => {
      state.update({ guide });
      void gateway.host.reportGuide(guide);
    },
    /**
     * What every attachment owes the host: its stream adopted and this
     * process's node registered on the connection that now stands, the guide
     * the panel last reported, and a bootstrap read. A host composed in this
     * process is attached once and never goes away; over a transport that can
     * drop, a later attachment writes what the host now holds into the
     * document, which is what tells the windows whatever of it moved.
     */
    start: async () => {
      attachments += 1;
      await gateway.attached();
      const guide = state.snapshot().guide;
      if (guide !== EMPTY_APP_GUIDE) void gateway.host.reportGuide(guide);
      const boot = await gateway.host.bootstrap();
      if (!boot) throw new Error("the host answered no bootstrap");
      adoptBootstrap(boot);
      if (attachments === 1) return;
      const relay = links.get();
      relay.reapplyTalkHotkey();
      relay.recycleVoiceWindow();
    },
    stop: async () => {
      while (unsubscribers.length > 0) unsubscribers.pop()?.();
      gateway.client.close();
    },
  };
}
