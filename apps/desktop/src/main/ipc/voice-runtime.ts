import { PRODUCT_EVENT, type RecordProductEvent } from "@sidecar/analytics";
import { CREDENTIAL_CONNECTION, CREDENTIAL_PROVIDERS } from "@sidecar/credentials";
import type { AgentWireTrace } from "@sidecar/devtrace/vocabulary";
import type { RealtimeConnection, RealtimeDiagnostics } from "@sidecar/realtime";
import type {
  BrowserWindow,
  IpcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  WebContents,
} from "electron";
import { BRIDGE, channels } from "#shared/bridge";
import {
  VOICE_COMMAND,
  VOICE_COMMAND_OUTCOME,
  type VoiceView,
  voiceExchangeActive,
} from "#shared/wire/voice-view";
import { registerBridge } from "../register-bridge";
import type { PanelManager } from "../window/panel-manager";

/** The hidden window the conversation lives in, as much of it as the bridge needs. */
export interface VoiceWindowSurface {
  current(): BrowserWindow | undefined;
  owns(webContents: WebContents): boolean;
}

export interface VoiceRuntimeIpcDependencies {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  panels: PanelManager;
  voiceWindow: VoiceWindowSurface;
  /** Whether the voice window's renderer can receive yet, which only its own report under the current epoch decides; the host answers. */
  receiver: { markReady: (epoch: number) => boolean | Promise<boolean> };
  /** Hands a payload to every panel and the voice window alike. */
  broadcast: <Payload>(channel: string, payload: Payload) => void;
  openExternal: (url: string) => Promise<void>;
  /**
   * The one credential a call runs on: the short-lived realtime secret the
   * host's account minter issued, or the introduction's bounded mint while the
   * takeover stands. Counted by whoever minted, under the source it came from.
   */
  mintRealtimeCredential: () => Promise<RealtimeConnection | undefined>;
  realtimeDiagnostics: () => Promise<RealtimeDiagnostics>;
  recordProductEvent: RecordProductEvent;
  /**
   * Takes one tapped wire event into the development trace. On a run without
   * a writer — packaged, fixture, or simply untraced — the renderer's
   * fire-and-forget send lands here and stops.
   */
  recordAgentTrace: (trace: AgentWireTrace) => void;
  /** The voice window's latest snapshot, kept for the next panel to bootstrap. */
  storeVoiceView: (view: VoiceView) => void;
  /**
   * The History Clear, carried out here before the voice window is told, and
   * answering whether the erasure completed on disk: the view and every
   * context are emptied either way, and a false answer is what the panel
   * shows as a Clear that did not finish.
   */
  clearConversation: () => boolean | Promise<boolean>;
  /** Whether a panel is recording a chord, which holds the talk and stop presses. */
  setShortcutCapturing: (capturing: boolean) => void;
}

export function registerVoiceRuntimeIpc(dependencies: VoiceRuntimeIpcDependencies): void {
  const { panels, voiceWindow } = dependencies;
  registerBridge(
    BRIDGE,
    {
      // A panel's command to the voice window. The bridge guard has already
      // bounded it; here it is checked to come from a panel — the voice window
      // does not command itself — and handed on. A Clear is carried out here
      // first, because the main process is the thread's store and every
      // panel's relay; the voice window is told to retire its own turns at
      // the fence, whatever the disk later answers, and the panel hears
      // whether the erasure completed.
      async voiceCommand(context, command) {
        if (!panels.owns(context.sender)) return undefined;
        // The Clear's fence is raised in the call's synchronous prefix, and
        // the voice window is told in the same breath — before the disk is
        // waited on — so its turns, marks, and context retire with main's.
        // Its answer, the disk's, comes after and goes to the panel alone.
        const erasing =
          command === VOICE_COMMAND.CLEAR_CONVERSATION
            ? dependencies.clearConversation()
            : undefined;
        voiceWindow.current()?.webContents.send(channels.onVoiceCommand, { command });
        if (erasing === undefined) return undefined;
        return (await erasing) ? VOICE_COMMAND_OUTCOME.ACCEPTED : VOICE_COMMAND_OUTCOME.REFUSED;
      },
      // The voice window's snapshot: kept for a late panel, forwarded to every
      // panel, and read for the one level the main process owns — whether an
      // exchange is live, which the media duck follows on every display. A
      // kind arrives only with the edge that opened the exchange, so its
      // presence is the count and no level change of its own is one.
      reportVoiceView(context, view, countedKind) {
        if (!voiceWindow.owns(context.sender)) return;
        dependencies.storeVoiceView(view);
        dependencies.broadcast(channels.onVoiceViewChanged, view);
        panels.setVoiceExchange(voiceExchangeActive(view.voiceStatus));
        if (countedKind !== undefined) {
          dependencies.recordProductEvent(PRODUCT_EVENT.VOICE_EXCHANGE, {
            exchange_kind: countedKind,
          });
        }
      },
      reportVoiceLevel(context, level) {
        if (!voiceWindow.owns(context.sender)) return;
        dependencies.broadcast(channels.onVoiceLevelChanged, level);
      },
      // The voice renderer saying it can receive. Only the renderer the
      // window holds now may say so, and only for the epoch its own bootstrap
      // named: a report from a panel, or from a renderer since reloaded or
      // replaced, is refused rather than readying a receiver that is not there.
      reportVoiceReady(context, epoch) {
        if (!voiceWindow.owns(context.sender)) return false;
        return dependencies.receiver.markReady(epoch);
      },
      setShortcutCapturing(context, capturing) {
        if (!panels.owns(context.sender)) return;
        dependencies.setShortcutCapturing(capturing);
      },
      openMicrophoneSettings: () =>
        dependencies.openExternal(
          "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        ),
      openProviderApiKeys(_context, providerId) {
        const provider = CREDENTIAL_PROVIDERS[providerId];
        if (provider.connection !== CREDENTIAL_CONNECTION.KEY || !provider.apiKeysUrl) return;
        void dependencies.openExternal(provider.apiKeysUrl);
      },
      focusPanel(context) {
        const displayId = panels.displayIdFor(context.sender);
        if (displayId !== undefined) panels.focusIfExpanded(displayId);
      },
      requestRealtimeCredential: () => dependencies.mintRealtimeCredential(),
      requestRealtimeDiagnostics: () => dependencies.realtimeDiagnostics(),
      recordAgentTrace(_context, trace) {
        dependencies.recordAgentTrace(trace);
      },
    },
    { ipcMain: dependencies.ipcMain, trustedSender: dependencies.trustedSender },
  );
}
