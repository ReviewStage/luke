import {
  PRODUCT_EVENT,
  type ProductCredentialSource,
  type RecordProductEvent,
} from "@sidecar/analytics";
import { CREDENTIAL_CONNECTION, CREDENTIAL_PROVIDERS } from "@sidecar/credentials";
import type { AgentWireTrace } from "@sidecar/devtrace/vocabulary";
import {
  ELEVENLABS_OUTCOME,
  ELEVENLABS_VOICES_URL,
  listElevenlabsVoices,
  mintElevenlabsToken,
  tokenMintExplanation,
  voiceListExplanation,
} from "@sidecar/speech";
import type { HostedUsageReader, RealtimeCredentialMinter } from "@sidecar/voice";
import type { CloudFetch } from "@sidecar/wire";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { BRIDGE } from "#shared/bridge";
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

export interface VoiceRuntimeIpcDependencies {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  panels: PanelManager;
  openExternal: (url: string) => Promise<void>;
  chooseRealtimeCredentials: () => ChosenRealtimeCredentials | undefined;
  unavailableDiagnostics: () => ReturnType<RealtimeCredentialMinter["diagnostics"]>;
  hostedUsageReader: () => HostedUsageReader | undefined;
  recordProductEvent: RecordProductEvent;
  /**
   * Takes one tapped wire event into the development trace. On a run without
   * a writer — packaged, fixture, or simply untraced — the renderer's
   * fire-and-forget send lands here and stops.
   */
  recordAgentTrace: (trace: AgentWireTrace) => void;
  /**
   * The stored ElevenLabs key, read here and nowhere the renderer can reach.
   * Nothing at all wherever no key is connected, which is the same answer a
   * machine with no key gives every other keyed service.
   */
  readSpeechApiKey: () => Promise<string | undefined>;
  /**
   * Whether this run may reach the network at all. A fixture or evidence run
   * observes nothing and mints nothing, the same gate the realtime minter
   * stands behind.
   */
  speechReachesNetwork: () => boolean;
  fetch?: CloudFetch;
}

/**
 * What both speech answers say where there is no key to ask with — a
 * disconnected account, or a run that never reaches the network. The same
 * shape a refused key produces, so the page draws one thing either way.
 */
const NO_SPEECH_KEY_VOICES = {
  voices: [],
  explanation: "No ElevenLabs key is connected, so there are no voices to read.",
} as const;

const NO_SPEECH_KEY_TOKEN = {
  outcome: ELEVENLABS_OUTCOME.UNAUTHORIZED,
  explanation: "No ElevenLabs key is connected, so Luke cannot speak through it.",
} as const;

export function registerVoiceRuntimeIpc(dependencies: VoiceRuntimeIpcDependencies): void {
  const { panels } = dependencies;
  const speechKey = async () =>
    dependencies.speechReachesNetwork() ? dependencies.readSpeechApiKey() : undefined;
  registerBridge(
    BRIDGE,
    {
      setVoiceExchangeActive(context, active, countedKind) {
        const displayId = panels.displayIdFor(context.sender);
        if (displayId !== undefined) panels.setVoiceExchange(displayId, active);
        // A kind arrives only with the edge that opened the exchange, so its
        // presence is the count and no level change of its own is one.
        if (countedKind !== undefined) {
          dependencies.recordProductEvent(PRODUCT_EVENT.VOICE_EXCHANGE, {
            exchange_kind: countedKind,
          });
        }
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
      openSpeechVoicesPage: () => {
        void dependencies.openExternal(ELEVENLABS_VOICES_URL);
      },
      async listSpeechVoices() {
        const apiKey = await speechKey();
        if (!apiKey) return NO_SPEECH_KEY_VOICES;
        const result = await listElevenlabsVoices({ apiKey, fetch: dependencies.fetch ?? fetch });
        return result.outcome === ELEVENLABS_OUTCOME.OK
          ? { voices: result.voices ?? [] }
          : { voices: [], explanation: voiceListExplanation(result.outcome) };
      },
      async mintSpeechToken() {
        const apiKey = await speechKey();
        if (!apiKey) return NO_SPEECH_KEY_TOKEN;
        const result = await mintElevenlabsToken({ apiKey, fetch: dependencies.fetch ?? fetch });
        // Only the token travels. The outcome and its sentence say what
        // happened; the key that produced it stays in this process.
        return result.outcome === ELEVENLABS_OUTCOME.OK
          ? { outcome: result.outcome, ...(result.token ? { token: result.token } : undefined) }
          : { outcome: result.outcome, explanation: tokenMintExplanation(result.outcome) };
      },
      requestHostedUsage: () => dependencies.hostedUsageReader()?.read(),
      recordAgentTrace(_context, trace) {
        dependencies.recordAgentTrace(trace);
      },
    },
    { ipcMain: dependencies.ipcMain, trustedSender: dependencies.trustedSender },
  );
}
