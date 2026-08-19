import {
  HOSTED_SERVICE_PATH,
  type NormalizedSession,
  type RealtimeDiagnostics,
  realtimeMintExplanation,
  SessionAttentionReviewer,
  type SessionIdentity,
} from "@sidecar/core";
import { HostedAttentionEvaluator } from "./hosted-attention-evaluator";
import { HostedRealtimeCredentialMinter } from "./hosted-realtime-credentials";
import { HostedUsageReader } from "./hosted-usage";
import { openAiAttentionEvaluator } from "./openai-attention-evaluator";
import {
  openAiRealtimeCredentials,
  unavailableRealtimeDiagnostics,
} from "./openai-realtime-credentials";
import type { RealtimeCredentialMinter } from "./realtime-minter";
import { VOICE_SOURCE, type VoiceSource } from "./shared/contracts";
import { VOICE_CREDENTIAL_PROVIDER_ID } from "./shared/credential-providers";
import {
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type AppSettingValue,
} from "./shared/settings-schema";

export interface VoiceCapabilityInput {
  credentialsUsable: boolean;
  keyConfigured: boolean;
  accountSignedIn: boolean;
  chosenSource: VoiceSource | undefined;
}

export interface VoiceCapabilityPolicy {
  available: boolean;
  source: VoiceSource;
  useKey: boolean;
  useHosted: boolean;
}

export function resolveVoiceCapability(input: VoiceCapabilityInput): VoiceCapabilityPolicy {
  if (!input.credentialsUsable) {
    return { available: false, source: VOICE_SOURCE.ACCOUNT, useKey: false, useHosted: false };
  }
  const source =
    !input.keyConfigured || (input.chosenSource === VOICE_SOURCE.ACCOUNT && input.accountSignedIn)
      ? VOICE_SOURCE.ACCOUNT
      : VOICE_SOURCE.KEY;
  return {
    available: input.keyConfigured || input.accountSignedIn,
    source,
    useKey: source === VOICE_SOURCE.KEY && input.keyConfigured,
    useHosted: source === VOICE_SOURCE.ACCOUNT && input.accountSignedIn,
  };
}

interface VoiceSettings {
  readVoiceSource(): Promise<VoiceSource>;
  readApiKey(providerId: typeof VOICE_CREDENTIAL_PROVIDER_ID): Promise<string | undefined>;
  get<Field extends AppSettingField>(field: Field): Promise<AppSettingValue<Field>>;
  readAccount(): Promise<{ accessToken: string } | undefined>;
}

export interface VoiceCapabilityAssemblerOptions {
  settings: VoiceSettings;
  credentialsUsable: () => boolean;
  accountSignedIn: () => boolean;
  hostedServiceBaseUrl: string;
  refreshAccount: () => Promise<void>;
  currentSession: (identity: SessionIdentity) => NormalizedSession | undefined;
  noticeRequestFor: (identity: SessionIdentity) => string | undefined;
  fetch?: typeof fetch;
  report?: (message: string) => void;
}

export class VoiceCapabilityAssembler {
  readonly #options: VoiceCapabilityAssemblerOptions;
  #attentionReviewer: SessionAttentionReviewer | undefined;
  #realtimeCredentials: RealtimeCredentialMinter | undefined;
  #unavailableDiagnostics: RealtimeDiagnostics;
  #hostedUsageReader: HostedUsageReader | undefined;

  constructor(options: VoiceCapabilityAssemblerOptions) {
    this.#options = options;
    this.#unavailableDiagnostics = unavailableRealtimeDiagnostics({
      fixtureMode: !options.credentialsUsable(),
      apiKeyConfigured: false,
    });
  }

  get attentionReviewer(): SessionAttentionReviewer | undefined {
    return this.#attentionReviewer;
  }

  get realtimeCredentials(): RealtimeCredentialMinter | undefined {
    return this.#realtimeCredentials;
  }

  get unavailableDiagnostics(): RealtimeDiagnostics {
    return this.#unavailableDiagnostics;
  }

  get hostedUsageReader(): HostedUsageReader | undefined {
    return this.#hostedUsageReader;
  }

  async apply(): Promise<void> {
    const credentialsUsable = this.#options.credentialsUsable();
    const voiceSource = await this.#options.settings.readVoiceSource();
    const apiKey =
      credentialsUsable && voiceSource === VOICE_SOURCE.KEY
        ? await this.#options.settings.readApiKey(VOICE_CREDENTIAL_PROVIDER_ID)
        : undefined;
    const policy = resolveVoiceCapability({
      credentialsUsable,
      keyConfigured: apiKey !== undefined,
      accountSignedIn: this.#options.accountSignedIn(),
      chosenSource: voiceSource,
    });
    const seams = {
      serviceBaseUrl: this.#options.hostedServiceBaseUrl,
      readAccessToken: async () => (await this.#options.settings.readAccount())?.accessToken,
      refreshAccount: this.#options.refreshAccount,
      ...(this.#options.fetch ? { fetch: this.#options.fetch } : undefined),
    };
    const evaluator = apiKey
      ? openAiAttentionEvaluator(apiKey)
      : policy.useHosted
        ? new HostedAttentionEvaluator(seams)
        : undefined;
    this.#attentionReviewer = evaluator
      ? new SessionAttentionReviewer({
          evaluator,
          currentSession: this.#options.currentSession,
          noticeRequestFor: this.#options.noticeRequestFor,
        })
      : undefined;
    const [voice, speed] = await Promise.all([
      this.#options.settings.get(APP_SETTING_SCHEMA.voice.field).catch(() => undefined),
      this.#options.settings.get(APP_SETTING_SCHEMA.voiceSpeed.field).catch(() => undefined),
    ]);
    const preferences = {
      ...(voice ? { voice } : undefined),
      ...(speed ? { speed } : undefined),
    };
    this.#realtimeCredentials = apiKey
      ? openAiRealtimeCredentials(apiKey, preferences)
      : policy.useHosted
        ? new HostedRealtimeCredentialMinter({ ...seams, ...preferences })
        : undefined;
    this.#unavailableDiagnostics = unavailableRealtimeDiagnostics({
      fixtureMode: !credentialsUsable,
      apiKeyConfigured: apiKey !== undefined,
    });
    this.#hostedUsageReader = policy.useHosted ? new HostedUsageReader(seams) : undefined;
    if (policy.useHosted) this.#warmHostedVoice();
    this.#report(apiKey !== undefined);
  }

  #warmHostedVoice(): void {
    const fetcher = this.#options.fetch ?? fetch;
    fetcher(`${this.#options.hostedServiceBaseUrl}${HOSTED_SERVICE_PATH.VOICE_MINT}`, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }

  #report(_apiKeyConfigured: boolean): void {
    const write = this.#options.report ?? ((message: string) => process.stderr.write(message));
    if (this.#realtimeCredentials) {
      const report = this.#realtimeCredentials.diagnostics();
      write(`Luke voice: enabled (${report.hosted ? "hosted, " : ""}${report.model})\n`);
      return;
    }
    write(
      `Luke voice: unavailable — ${realtimeMintExplanation(this.#unavailableDiagnostics.lastOutcome)}\n`,
    );
  }
}
