import { randomUUID } from "node:crypto";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { GATEWAY_CLIENT_ROLE, InProcessTransport } from "@sidecar/gateway";
import type { GatewayInProcessHost } from "@sidecar/gateway/server";
import { type AppGuideSnapshot, EMPTY_APP_GUIDE } from "@sidecar/guide";
import { HOST_OPERATOR_CLIENT_ID } from "@sidecar/host";
import type { AppSettings } from "@sidecar/settings/wire";
import { channels } from "#shared/bridge";
import { type AppStateStore, bootstrapPatch } from "../app-state";
import type { HostBootstrap, HostOperator } from "../gateway/host-operator";
import { wireGateway } from "../gateway/wiring";
import type { DesktopConfig } from "./desktop-config";
import type { NativeNodeCapabilities } from "./native-node";
import type { DesktopService } from "./service";

/** What the host's events reach in the windows that draw them. */
interface OperatorClientLinks {
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
  /** The host's word on whether the introduction is owed moved; the windows decide whether to begin it. */
  introductionOwedChanged: () => void;
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
  /** Whether the host's onboarding record owes the spoken introduction, as last told. */
  introductionOwed: () => boolean;
  /** One host bootstrap, adopted into the document every window is answered from. */
  readBootstrap: () => Promise<HostBootstrap | undefined>;
  /** Stops recording now, ahead of an action that ends the account it is filed under; the host's next replay event re-answers. */
  haltSessionReplay: () => void;
  resumeSessionReplay: () => void;
  reportGuide: (snapshot: AppGuideSnapshot) => void;
}

export interface OperatorClientDependencies {
  config: DesktopConfig;
  /** The host this client operates, reached over the in-process transport. */
  gateway: GatewayInProcessHost;
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
  let heldLinks: OperatorClientLinks | undefined;
  const links = (): OperatorClientLinks => {
    if (heldLinks === undefined) {
      throw new Error("the operator client's links are read before link() has run");
    }
    return heldLinks;
  };

  /**
   * Whether a voice stands at all, which is the one thing this client decides
   * for itself rather than draws: the keys ask it before claiming a chord and
   * the mint asks it before the introduction's own. Everything else the host
   * says goes into the document.
   */
  let voiceAvailable = false;
  let introductionOwed = false;
  let attachments = 0;
  const unsubscribers: (() => void)[] = [];

  const gateway = wireGateway({
    transport: new InProcessTransport(dependencies.gateway, {
      clientId: HOST_OPERATOR_CLIENT_ID,
      role: GATEWAY_CLIENT_ROLE.OPERATOR,
    }),
    createId: () => randomUUID(),
    report: config.report,
    state,
    node: dependencies.node,
  });

  function adoptBootstrap(boot: HostBootstrap): void {
    voiceAvailable = boot.voiceAvailable;
    introductionOwed = boot.introductionOwed;
    state.update(bootstrapPatch(state.snapshot(), boot));
  }

  // Everything the host says is written to the document; the live session's
  // change also reaches the voice window directly, as the event it is.
  unsubscribers.push(
    gateway.host.onSettingsChanged((change) => {
      const stoodVoice = voiceAvailable;
      voiceAvailable = change.settings.status.voiceAvailable;
      state.update({ settings: change.settings });
      if (stoodVoice !== voiceAvailable) links().reapplyTalkHotkey();
    }),
    gateway.host.onAccountChanged((account) => {
      state.update({ account });
      // The sign-in that owes the introduction lands as two events, the
      // record's and the account's, in either order; whichever comes second
      // is the one the windows can act on.
      links().introductionOwedChanged();
    }),
    gateway.host.onIntroductionChanged((owed) => {
      introductionOwed = owed;
      links().introductionOwedChanged();
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
    gateway.host.onCalendarOnboardingChanged((calendarOwed) => {
      state.update({ onboarding: { calendarOwed } });
    }),
    // The live session's phase is written down for the panels and handed to
    // the voice window as the event it is: a repeated wanted is a new ask,
    // which a version of the document could not carry.
    gateway.host.onVoiceLiveSessionChanged((change) => {
      state.update({
        voice: {
          ...state.snapshot().voice,
          liveSession: {
            phase: change.phase,
            ...(change.sessionId !== undefined ? { sessionId: change.sessionId } : undefined),
          },
        },
      });
      links().sendToVoice(channels.onVoiceLiveSessionChanged, change);
    }),
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
    link: (next) => {
      heldLinks = next;
    },
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
    introductionOwed: () => introductionOwed,
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
      const relay = links();
      relay.reapplyTalkHotkey();
      relay.recycleVoiceWindow();
    },
    stop: async () => {
      while (unsubscribers.length > 0) unsubscribers.pop()?.();
      gateway.client.close();
    },
  };
}
