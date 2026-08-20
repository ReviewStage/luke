import {
  HOSTED_SERVICE_PATH,
  type NormalizedSession,
  type RealtimeDiagnostics,
  realtimeMintExplanation,
  SessionAttentionReviewer,
  type SessionIdentity,
} from "@sidecar/core";
import { Effect } from "effect";
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
  readVoiceSource(): Effect.Effect<VoiceSource, unknown, unknown>;
  readApiKey(
    providerId: typeof VOICE_CREDENTIAL_PROVIDER_ID,
  ): Effect.Effect<string | undefined, unknown, unknown>;
  get<Field extends AppSettingField>(
    field: Field,
  ): Effect.Effect<AppSettingValue<Field>, unknown, unknown>;
  readAccount(): Effect.Effect<{ accessToken: string } | undefined, unknown, unknown>;
}

export interface VoiceCapabilityAssemblerOptions {
  settings: VoiceSettings;
  credentialsUsable: () => boolean;
  accountSignedIn: () => boolean;
  hostedServiceBaseUrl: string;
  refreshAccount: () => Effect.Effect<void, unknown, unknown>;
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
  #voiceSource: VoiceSource = VOICE_SOURCE.ACCOUNT;

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

  /** Which credential the last applied policy settled on, for a count to name. */
  get voiceSource(): VoiceSource {
    return this.#voiceSource;
  }

  apply(): Effect.Effect<void, unknown, unknown> {
    return Effect.gen(this, function* () {
      const credentialsUsable = this.#options.credentialsUsable();
      const voiceSource = yield* this.#options.settings.readVoiceSource();
      const apiKey =
        credentialsUsable && voiceSource === VOICE_SOURCE.KEY
          ? yield* this.#options.settings.readApiKey(VOICE_CREDENTIAL_PROVIDER_ID)
          : undefined;
      const policy = resolveVoiceCapability({
        credentialsUsable,
        keyConfigured: apiKey !== undefined,
        accountSignedIn: this.#options.accountSignedIn(),
        chosenSource: voiceSource,
      });
      const seams = {
        serviceBaseUrl: this.#options.hostedServiceBaseUrl,
        readAccessToken: () =>
          // SAFETY: Voice capability assembly reads account tokens through settings-store Effects.
          this.#options.settings.readAccount().pipe(
            Effect.map((account) => account?.accessToken),
            Effect.catchAll(() => Effect.succeed(undefined)),
          ) as Effect.Effect<string | undefined>,
        refreshAccount: this.#options.refreshAccount,
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
      const voice = yield* this.#options.settings
        .get(APP_SETTING_SCHEMA.voice.field)
        .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
      const speed = yield* this.#options.settings
        .get(APP_SETTING_SCHEMA.voiceSpeed.field)
        .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
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
      this.#voiceSource = policy.source;
      if (policy.useHosted) this.#warmHostedVoice();
      this.#report(apiKey !== undefined);
    });
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
