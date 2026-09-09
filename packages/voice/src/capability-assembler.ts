import {
  HostedEmbeddingAdapter,
  HostedModelAdapter,
  OpenAiEmbeddingAdapter,
  openAiModelAdapter,
} from "@sidecar/brain";
import { VOICE_CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials/vocabulary";
import { HOSTED_SERVICE_PATH } from "@sidecar/hosted";
import { type RealtimeDiagnostics, realtimeMintExplanation } from "@sidecar/realtime";
import type { EmbeddingAdapter, ModelAdapter } from "@sidecar/runtime/vocabulary";
import {
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type AppSettingValue,
  VOICE_SOURCE,
  type VoiceSource,
} from "@sidecar/settings";
import { openAiRealtimeCredentials, unavailableRealtimeDiagnostics } from "./openai-credentials.js";
import { hostedRealtimeCredentialMinter, type RealtimeCredentialMinter } from "./service-mint.js";

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

export interface VoiceSettings {
  readVoiceSource(): Promise<VoiceSource>;
  readApiKey(providerId: typeof VOICE_CREDENTIAL_PROVIDER_ID): Promise<string | undefined>;
  get<Field extends AppSettingField>(field: Field): Promise<AppSettingValue<Field>>;
  readAccount(): Promise<{ accessToken: string } | undefined>;
}

export interface VoiceCapabilityAssemblerOptions {
  settings: VoiceSettings;
  credentialsUsable: () => boolean;
  /**
   * Whether this is a fixture or evidence run. `credentialsUsable` cannot say:
   * it is also false on a live run whose account gate is closed, and that state
   * must be diagnosed as the missing credential it is, not as a fixture run.
   */
  fixtureRun: () => boolean;
  accountSignedIn: () => boolean;
  hostedServiceBaseUrl: string;
  refreshAccount: () => Promise<void>;
  fetch?: typeof fetch;
  report?: (message: string) => void;
  /**
   * Decorates the model adapter the policy builds, so a traced development
   * run records every inference without the adapter learning it is being
   * watched. The decoration may only observe: the runtime still sees a
   * `ModelAdapter`, and absence means the adapter is used as built.
   */
  wrapBrainModel?: (model: ModelAdapter) => ModelAdapter;
}

/**
 * What one `apply` answers. `latest` says whether the application was the
 * newest when its reads completed, which is when it published, warmed, and
 * reported, or was overtaken and did none of that. `isCurrent` asks the same
 * question live: a newer application may begin between the publication and
 * the caller's continuation, and a caller about to build on the published set
 * must ask at the moment of use rather than trust the snapshot it was handed.
 */
export interface VoiceCapabilityApplication {
  latest: boolean;
  isCurrent: () => boolean;
}

export class VoiceCapabilityAssembler {
  readonly #options: VoiceCapabilityAssemblerOptions;
  #brainModel: ModelAdapter | undefined;
  #embeddingAdapter: EmbeddingAdapter | undefined;
  #realtimeCredentials: RealtimeCredentialMinter | undefined;
  #unavailableDiagnostics: RealtimeDiagnostics;
  #voiceSource: VoiceSource = VOICE_SOURCE.ACCOUNT;
  #applications = 0;
  readonly #applied = new Set<() => void>();

  constructor(options: VoiceCapabilityAssemblerOptions) {
    this.#options = options;
    this.#unavailableDiagnostics = unavailableRealtimeDiagnostics({
      fixtureMode: options.fixtureRun(),
      apiKeyConfigured: false,
    });
  }

  /**
   * The model adapter the brain's turns run on, or nothing. It follows the voice
   * source exactly: the developer's own key runs turns directly, a signed-in
   * account with the account source runs them through Luke's hosted service
   * on Luke's key, and a fixture or evidence run, or a run with neither, has
   * no brain, so nothing is announced and an ask meets the honest refusal.
   * The key is read only when the key source is chosen, so an account-source
   * run never spends a stored personal key.
   */
  get brainModel(): ModelAdapter | undefined {
    return this.#brainModel;
  }

  /**
   * The embedding adapter the notebook index runs on, following the same
   * source as the brain's model: the developer's key straight to OpenAI's
   * embeddings, or Luke's hosted service on the account. Nothing when no
   * brain may stand, and the index then searches by keyword alone.
   */
  get embeddingAdapter(): EmbeddingAdapter | undefined {
    return this.#embeddingAdapter;
  }

  /**
   * Hears every application that published, after its capability set stands,
   * so a reader of the adapters can follow a credential change without
   * polling. Answers the unsubscribe.
   */
  onApplied(listener: () => void): () => void {
    this.#applied.add(listener);
    return () => {
      this.#applied.delete(listener);
    };
  }

  get realtimeCredentials(): RealtimeCredentialMinter | undefined {
    return this.#realtimeCredentials;
  }

  get unavailableDiagnostics(): RealtimeDiagnostics {
    return this.#unavailableDiagnostics;
  }

  /** Which credential the last applied policy settled on, for a count to name. */
  get voiceSource(): VoiceSource {
    return this.#voiceSource;
  }

  /**
   * Reads the chosen source, the key, the account, and the preferences, and
   * publishes the capability set they decide as one unit, after every read
   * has completed. Two applications can overlap — an account chosen while a
   * key read is still out — and the older must never publish over the newer:
   * each application takes its number before its first await and checks it
   * after its last, and one that has been overtaken installs nothing.
   */
  async apply(): Promise<VoiceCapabilityApplication> {
    const application = ++this.#applications;
    const isCurrent = () => application === this.#applications;
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
    const [voice, speed] = await Promise.all([
      this.#options.settings.get(APP_SETTING_SCHEMA.voice.field).catch(() => undefined),
      this.#options.settings.get(APP_SETTING_SCHEMA.voiceSpeed.field).catch(() => undefined),
    ]);
    if (!isCurrent()) return { latest: false, isCurrent };

    const builtBrainModel = policy.useKey
      ? openAiModelAdapter(apiKey)
      : policy.useHosted
        ? new HostedModelAdapter(seams)
        : undefined;
    const preferences = {
      ...(voice ? { voice } : undefined),
      ...(speed ? { speed } : undefined),
    };
    this.#brainModel =
      builtBrainModel && this.#options.wrapBrainModel
        ? this.#options.wrapBrainModel(builtBrainModel)
        : builtBrainModel;
    this.#embeddingAdapter =
      policy.useKey && apiKey
        ? new OpenAiEmbeddingAdapter({
            apiKey,
            ...(this.#options.fetch ? { fetch: this.#options.fetch } : undefined),
          })
        : policy.useHosted
          ? new HostedEmbeddingAdapter(seams)
          : undefined;
    this.#realtimeCredentials = apiKey
      ? openAiRealtimeCredentials(apiKey, preferences)
      : policy.useHosted
        ? hostedRealtimeCredentialMinter({ ...seams, ...preferences })
        : undefined;
    this.#unavailableDiagnostics = unavailableRealtimeDiagnostics({
      fixtureMode: this.#options.fixtureRun(),
      apiKeyConfigured: apiKey !== undefined,
    });
    this.#voiceSource = policy.source;
    if (policy.useHosted) this.#warmHostedVoice();
    this.#report(apiKey !== undefined);
    for (const listener of this.#applied) listener();
    return { latest: true, isCurrent };
  }

  #warmHostedVoice(): void {
    const fetcher = this.#options.fetch ?? fetch;
    fetcher(`${this.#options.hostedServiceBaseUrl}${HOSTED_SERVICE_PATH.VOICE_MINT}`, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }

  #report(apiKeyConfigured: boolean): void {
    const write = this.#options.report ?? ((message: string) => process.stderr.write(message));
    if (this.#realtimeCredentials) {
      const report = this.#realtimeCredentials.diagnostics();
      write(`Luke voice: enabled (${report.hosted ? "hosted, " : ""}${report.model})\n`);
    } else {
      write(
        `Luke voice: unavailable — ${realtimeMintExplanation(this.#unavailableDiagnostics.lastOutcome)}\n`,
      );
    }
    if (this.#brainModel) {
      write(`Luke brain: enabled (${this.#brainModel.model ?? "model chosen by the service"})\n`);
    } else if (apiKeyConfigured) {
      write("Luke brain: unavailable — the key was found but no adapter was built\n");
    } else {
      write("Luke brain: absent — no OpenAI key and no signed-in account\n");
    }
  }
}
