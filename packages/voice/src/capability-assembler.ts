import {
  type BrainClient,
  type DigestClient,
  openAiBrainClient,
  openAiDigestClient,
} from "@sidecar/brain";
import { VOICE_CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials/vocabulary";
import { HOSTED_SERVICE_PATH } from "@sidecar/hosted";
import { type RealtimeDiagnostics, realtimeMintExplanation } from "@sidecar/realtime";
import {
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type AppSettingValue,
  VOICE_SOURCE,
  type VoiceSource,
} from "@sidecar/settings";
import { HostedRealtimeCredentialMinter } from "./hosted-credentials.js";
import type { RealtimeCredentialMinter } from "./minter.js";
import { openAiRealtimeCredentials, unavailableRealtimeDiagnostics } from "./openai-credentials.js";

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
   * Decorates the brain client the policy builds, so a traced development
   * run records every turn's request without the client learning it is being
   * watched. The decoration may only observe: the agent still sees a
   * `BrainClient`, and absence means the client is used as built.
   */
  wrapBrainClient?: (client: BrainClient) => BrainClient;
}

export class VoiceCapabilityAssembler {
  readonly #options: VoiceCapabilityAssemblerOptions;
  #brainClient: BrainClient | undefined;
  #digestClient: DigestClient | undefined;
  #realtimeCredentials: RealtimeCredentialMinter | undefined;
  #unavailableDiagnostics: RealtimeDiagnostics;
  #voiceSource: VoiceSource = VOICE_SOURCE.ACCOUNT;

  constructor(options: VoiceCapabilityAssemblerOptions) {
    this.#options = options;
    this.#unavailableDiagnostics = unavailableRealtimeDiagnostics({
      fixtureMode: options.fixtureRun(),
      apiKeyConfigured: false,
    });
  }

  /**
   * The client the brain's turns run on, or nothing. In this build the brain
   * runs only on the developer's own key: a signed-in account with no key
   * has voice through the hosted mint and no brain, so nothing is announced
   * and an ask is answered with the honest refusal.
   */
  get brainClient(): BrainClient | undefined {
    return this.#brainClient;
  }

  /**
   * The client each wake's transcript slice is summarized through before the
   * brain sees it, built beside the brain on the same key and standing down
   * with it. Without one the brain still runs, on fallback digests alone.
   */
  get digestClient(): DigestClient | undefined {
    return this.#digestClient;
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
    const builtBrainClient = openAiBrainClient(apiKey);
    this.#brainClient =
      builtBrainClient && this.#options.wrapBrainClient
        ? this.#options.wrapBrainClient(builtBrainClient)
        : builtBrainClient;
    this.#digestClient = openAiDigestClient(apiKey);
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
      fixtureMode: this.#options.fixtureRun(),
      apiKeyConfigured: apiKey !== undefined,
    });
    this.#voiceSource = policy.source;
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
    if (this.#brainClient) {
      write(`Luke brain: enabled (${this.#brainClient.model ?? "model chosen by the service"})\n`);
      write(
        this.#digestClient
          ? `Luke brain digest: enabled (${this.#digestClient.model ?? "model chosen by the service"})\n`
          : "Luke brain digest: absent — wakes carry fallback digests\n",
      );
    } else if (apiKeyConfigured) {
      write("Luke brain: unavailable — the key was found but no client was built\n");
    } else {
      write("Luke brain: absent — this build runs the brain only on an OpenAI key\n");
    }
  }
}
