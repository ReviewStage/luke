import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import type { GatewayHost, NodeRegistry } from "@sidecar/gateway";
import type { AppSettings } from "@sidecar/settings/wire";
import { Effect, Option, type Scope } from "effect";
import { channels } from "#shared/bridge";
import { type AppStateStore, bootstrapPatch } from "../app-state";
import type { HostBootstrap, HostOperator } from "../gateway/host-operator";
import { wireGateway } from "../gateway/wiring";
import type { DesktopConfig } from "./desktop-config";
import type { NativeNodeCapabilities } from "./native-node";

/** What the host's events reach in the windows that draw them. */
interface OperatorClientLinks {
  sendToVoice: <Payload>(channel: string, payload: Payload) => void;
  /**
   * A voice that came or went moves the talk key: claimed now that there is
   * something to talk to, or given back to the machine now that there is not.
   */
  reapplyTalkHotkey: () => void;
}

export interface OperatorClient {
  /** Names this concern in a failure report and in the order the set starts and stops in. */
  readonly name: string;
  link: (links: OperatorClientLinks) => void;
  /** The host's own method vocabulary, as this client calls it. */
  readonly host: HostOperator;
  settings: () => AppSettings | undefined;
  /** The settings this launch decides its windows from, read from the host once and written down. */
  ensureSettings: () => Effect.Effect<AppSettings | undefined>;
  signedIn: () => boolean;
  voiceAvailable: () => boolean;
  /** One host bootstrap, adopted into the document every window is answered from. */
  readBootstrap: () => Effect.Effect<HostBootstrap | undefined>;
  /** Stops recording now, ahead of an action that ends the account it is filed under; the host's next replay event re-answers. */
  haltSessionReplay: () => void;
  resumeSessionReplay: () => void;
  /**
   * Reads the host's bootstrap into the document. An effect the composer runs
   * in the launch's own scope, never a promise this file built for itself.
   */
  start: () => Effect.Effect<void>;
  /** Gives back what `start` began: every subscription this client holds. */
  stop: () => Effect.Effect<void>;
}

export interface OperatorClientDependencies {
  config: DesktopConfig;
  /** The host this client operates. */
  gateway: GatewayHost;
  /** The host's node registry, where this process's native capabilities are offered. */
  nodes: NodeRegistry;
  node: NativeNodeCapabilities;
  /** Everything the host says, written down once; the windows are told from it. */
  state: AppStateStore;
}

/**
 * The one operator this process is. It relays the host's events to the
 * windows that draw them, remembers what a synchronous answer needs, and
 * offers this machine's native capabilities as one node. The runtime itself
 * stands behind the host; nothing here composes a store or a brain.
 */
export const createOperatorClient = /* @__PURE__ */ Effect.fn("desktop/createOperatorClient")(
  function* (
    dependencies: OperatorClientDependencies,
  ): Effect.fn.Return<OperatorClient, never, Scope.Scope> {
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
     * for itself rather than draws: the keys ask it before claiming a chord.
     * Everything else the host says goes into the document.
     */
    let voiceAvailable = false;
    const unsubscribers: (() => void)[] = [];

    const gateway = yield* wireGateway({
      gateway: dependencies.gateway,
      nodes: dependencies.nodes,
      report: config.report,
      state,
      node: dependencies.node,
    });

    function adoptBootstrap(boot: HostBootstrap): void {
      voiceAvailable = boot.voiceAvailable;
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
      }),
      // The live session's phase is handed to the voice window as the event it is.
      gateway.host.onVoiceLiveSessionChanged((change) => {
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
      settings: () => state.snapshot().settings,
      ensureSettings: () =>
        Effect.gen(function* () {
          const held = state.snapshot().settings;
          if (held) return held;
          const settings = yield* gateway.host.settingsSnapshot();
          if (Option.isSome(settings)) state.update({ settings: settings.value });
          return Option.getOrUndefined(settings);
        }),
      signedIn: () => state.snapshot().account.status === ACCOUNT_STATUS.SIGNED_IN,
      voiceAvailable: () => voiceAvailable,
      readBootstrap: () =>
        Effect.gen(function* () {
          const boot = yield* gateway.host.bootstrap();
          if (Option.isSome(boot)) adoptBootstrap(boot.value);
          return Option.getOrUndefined(boot);
        }),
      haltSessionReplay: () => setSessionReplayHalted(true),
      resumeSessionReplay: () => setSessionReplayHalted(false),
      /** The one bootstrap the launch reads: a host composed in this process is attached once and never goes away. */
      start: () =>
        Effect.gen(function* () {
          const boot = yield* gateway.host.bootstrap();
          if (Option.isNone(boot))
            return yield* Effect.die(new Error("the host answered no bootstrap"));
          adoptBootstrap(boot.value);
        }),
      stop: () =>
        Effect.sync(() => {
          while (unsubscribers.length > 0) unsubscribers.pop()?.();
        }),
    };
  },
);
