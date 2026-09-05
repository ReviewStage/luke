import {
  PRODUCT_EVENT,
  type ProductCredentialSource,
  type RecordProductEvent,
} from "@sidecar/analytics";
import { CREDENTIAL_CONNECTION, CREDENTIAL_PROVIDERS } from "@sidecar/credentials";
import type { AgentWireTrace } from "@sidecar/devtrace/vocabulary";
import type { RealtimeCredentialMinter } from "@sidecar/voice";
import type {
  BrowserWindow,
  IpcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  WebContents,
} from "electron";
import { BRIDGE, channels } from "#shared/bridge";
import { VOICE_COMMAND, type VoiceView, voiceExchangeActive } from "#shared/wire/voice-view";
import { registerBridge } from "../register-bridge";
import type { PanelManager } from "../window/panel-manager";

/**
 * The minter a call will run on and the source its count names, chosen
 * together: two closures deciding independently across the awaited mint could
 * disagree at exactly the transitions the introduction is built around — an
 * account landing, or leaving, while a mint is in flight.
 */
export interface ChosenRealtimeCredentials {
  minter: RealtimeCredentialMinter;
  countedSource: ProductCredentialSource;
}

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
  /** Hands a payload to every panel and the voice window alike. */
  broadcast: <Payload>(channel: string, payload: Payload) => void;
  openExternal: (url: string) => Promise<void>;
  chooseRealtimeCredentials: () => ChosenRealtimeCredentials | undefined;
  unavailableDiagnostics: () => ReturnType<RealtimeCredentialMinter["diagnostics"]>;
  recordProductEvent: RecordProductEvent;
  /**
   * Takes one tapped wire event into the development trace. On a run without
   * a writer — packaged, fixture, or simply untraced — the renderer's
   * fire-and-forget send lands here and stops.
   */
  recordAgentTrace: (trace: AgentWireTrace) => void;
  /** The voice window's latest snapshot, kept for the next panel to bootstrap. */
  storeVoiceView: (view: VoiceView) => void;
  /** The History Clear, carried out here before the voice window is told. */
  clearConversation: () => void;
  /** Whether a panel is recording a chord, which holds the talk and stop presses. */
  setShortcutCapturing: (capturing: boolean) => void;
}

export function registerVoiceRuntimeIpc(dependencies: VoiceRuntimeIpcDependencies): void {
  const { panels, voiceWindow } = dependencies;
  registerBridge(
    BRIDGE,
    {
      // A panel's ask of the voice window. The bridge guard has already bounded
      // it; here it is checked to come from a panel — the voice window does
      // not command itself — and handed on. A Clear is carried out here first,
      // because the main process is the thread's store and every panel's
      // relay, and the voice window is then told to retire its own turns.
      voiceCommand(context, command, text) {
        if (!panels.owns(context.sender)) return;
        if (command === VOICE_COMMAND.CLEAR_CONVERSATION) dependencies.clearConversation();
        voiceWindow.current()?.webContents.send(channels.onVoiceCommand, { command, text });
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
      async requestRealtimeCredential() {
        // Chosen once, before the awaited mint: the source counted is the
        // source the credential actually came from, whatever the account did
        // while the request was in flight.
        const chosen = dependencies.chooseRealtimeCredentials();
        const credential = await chosen?.minter.mint();
        if (credential && chosen) {
          dependencies.recordProductEvent(PRODUCT_EVENT.VOICE_CALL_START, {
            credential_source: chosen.countedSource,
          });
        }
        return credential;
      },
      requestRealtimeDiagnostics: () =>
        dependencies.chooseRealtimeCredentials()?.minter.diagnostics() ??
        dependencies.unavailableDiagnostics(),
      recordAgentTrace(_context, trace) {
        dependencies.recordAgentTrace(trace);
      },
    },
    { ipcMain: dependencies.ipcMain, trustedSender: dependencies.trustedSender },
  );
}
