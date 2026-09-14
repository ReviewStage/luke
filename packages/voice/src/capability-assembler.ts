import type { PlatformError } from "@effect/platform/Error";
import type * as HttpClient from "@effect/platform/HttpClient";
import { HostedModelAdapter, RESPONSES_OPERATION } from "@sidecar/brain";
import { VOICE_CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials/vocabulary";
import { HOSTED_VOICE_SERVICE_ORIGIN } from "@sidecar/hosted";
import type { LiveDiagnostics } from "@sidecar/live";
import type { ExecutionRuntime, ModelAdapter } from "@sidecar/runtime/vocabulary";
import {
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type AppSettingValue,
  VOICE_SOURCE,
  type VoiceSource,
} from "@sidecar/settings";
import { Effect, type Layer } from "effect";
import {
  HostedLiveSessionSource,
  type LiveSessionSource,
  unavailableLiveDiagnostics,
} from "./live-session-source.js";
import type { OpenSocket } from "./live-socket.js";

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
  readVoiceSource(): Effect.Effect<VoiceSource, PlatformError>;
  readApiKey(
    providerId: typeof VOICE_CREDENTIAL_PROVIDER_ID,
  ): Effect.Effect<string | undefined, PlatformError>;
  get<Field extends AppSettingField>(
    field: Field,
  ): Effect.Effect<AppSettingValue<Field>, PlatformError>;
  /**
   * The signed-in account, as the hosted callers need it: the token every
   * attempt is authorized with, and the identity that token answers for, so a
   * refreshed one is never carried on behalf of an account that signed in
   * behind it.
   */
  readAccount(): Effect.Effect<{ accessToken: string; email?: string } | undefined, PlatformError>;
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
  /**
   * The voice service origin a hosted live session's socket opens to;
   * `HOSTED_VOICE_SERVICE_ORIGIN` when absent.
   */
  hostedVoiceServiceOrigin?: string;
  /**
   * The socket seam live sessions attach their sideband through. A host that
   * hands none offers no live sessions, since a session with no trusted side
   * would have nowhere to speak from.
   */
  openSocket?: OpenSocket;
  refreshAccount: () => Effect.Effect<void, unknown>;
  /** This installation's device row id, for the hosted session's handshake; absent or answering nothing, the handshake names no device. */
  deviceId?: () => string | undefined;
  /** The `HttpClient` the brain's own request effects run over; the platform's own when absent. */
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
  /** The runtime a brain model's own request effects are run on; `Runtime.defaultRuntime` for a caller that gave none. */
  execution?: ExecutionRuntime;
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
  #prefetchModel: ModelAdapter | undefined;
  #liveSessions: LiveSessionSource | undefined;
  #unavailableLiveDiagnostics: LiveDiagnostics;
  #voiceSource: VoiceSource = VOICE_SOURCE.ACCOUNT;
  #applications = 0;
  readonly #applied = new Set<() => void>();

  constructor(options: VoiceCapabilityAssemblerOptions) {
    this.#options = options;
    this.#unavailableLiveDiagnostics = unavailableLiveDiagnostics({
      fixtureMode: options.fixtureRun(),
    });
  }

  /**
   * The model adapter the brain's turns run on, or nothing. A signed-in
   * account with the account source runs them through Luke's hosted service
   * on Luke's key; a fixture or evidence run, a run with no account, or a
   * run on the developer's own key source has no brain, so nothing is
   * announced and an ask meets the honest refusal. A key of the developer's
   * own is never what a brain turn runs on.
   */
  get brainModel(): ModelAdapter | undefined {
    return this.#brainModel;
  }

  /**
   * The small model the read prefetch plans and summarizes on, under the same
   * source as the brain's model: the hosted service's prefetch operation on
   * the account, which the service advertises or not. Nothing when no brain
   * may stand, and then nothing is read ahead.
   */
  get prefetchModel(): ModelAdapter | undefined {
    return this.#prefetchModel;
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

  /**
   * Where a GPT Live session comes from, under the same policy as the brain's
   * model: the signed-in account through Luke's voice service. Nothing when no
   * account stands, when the developer's own key source is chosen (a session
   * on that key has no service and so no brain behind it since E5-3), or when
   * the host handed no socket seam.
   */
  get liveSessions(): LiveSessionSource | undefined {
    return this.#liveSessions;
  }

  get unavailableLiveDiagnostics(): LiveDiagnostics {
    return this.#unavailableLiveDiagnostics;
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
  apply(): Effect.Effect<VoiceCapabilityApplication, PlatformError> {
    return Effect.gen(this, function* () {
      const application = ++this.#applications;
      const isCurrent = () => application === this.#applications;
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
      const readAccount = () =>
        this.#options.settings.readAccount().pipe(Effect.orElseSucceed(() => undefined));
      const httpClient = this.#options.httpClient;
      const seams = {
        serviceBaseUrl: this.#options.hostedServiceBaseUrl,
        readAccessToken: () => Effect.map(readAccount(), (account) => account?.accessToken),
        refreshAccount: this.#options.refreshAccount,
        readAccountKey: () => Effect.map(readAccount(), (account) => account?.email),
        ...(httpClient ? { httpClient } : undefined),
        ...(this.#options.execution ? { execution: this.#options.execution } : undefined),
      };
      const voice = yield* this.#options.settings
        .get(APP_SETTING_SCHEMA.voice.field)
        .pipe(Effect.orElseSucceed(() => undefined));
      if (!isCurrent()) return { latest: false, isCurrent };

      const builtBrainModel = policy.useHosted ? new HostedModelAdapter(seams) : undefined;
      this.#brainModel =
        builtBrainModel && this.#options.wrapBrainModel
          ? this.#options.wrapBrainModel(builtBrainModel)
          : builtBrainModel;
      const builtPrefetchModel = policy.useHosted
        ? new HostedModelAdapter({ ...seams, respondOperation: RESPONSES_OPERATION.PREFETCH })
        : undefined;
      this.#prefetchModel =
        builtPrefetchModel && this.#options.wrapBrainModel
          ? this.#options.wrapBrainModel(builtPrefetchModel)
          : builtPrefetchModel;
      const openSocket = this.#options.openSocket;
      this.#liveSessions =
        openSocket && policy.useHosted
          ? new HostedLiveSessionSource({
              serviceOrigin: this.#options.hostedVoiceServiceOrigin ?? HOSTED_VOICE_SERVICE_ORIGIN,
              openSocket,
              readAccessToken: seams.readAccessToken,
              refreshAccount: seams.refreshAccount,
              readAccountKey: seams.readAccountKey,
              ...(this.#options.deviceId ? { deviceId: this.#options.deviceId } : undefined),
              ...(voice ? { voice } : undefined),
            })
          : undefined;
      this.#unavailableLiveDiagnostics = unavailableLiveDiagnostics({
        fixtureMode: this.#options.fixtureRun(),
      });
      this.#voiceSource = policy.source;
      this.#report(apiKey !== undefined);
      for (const listener of this.#applied) listener();
      return { latest: true, isCurrent };
    });
  }

  #report(apiKeyConfigured: boolean): void {
    const write = this.#options.report ?? ((message: string) => process.stderr.write(message));
    if (this.#liveSessions) {
      write(`Luke voice: enabled (hosted, ${this.#liveSessions.diagnostics().model})\n`);
    } else {
      write(`Luke voice: unavailable — ${this.#unavailableLiveDiagnostics.lastOutcome}\n`);
    }
    if (this.#brainModel) {
      write(`Luke brain: enabled (${this.#brainModel.model ?? "model chosen by the service"})\n`);
    } else if (apiKeyConfigured) {
      write("Luke brain: absent — a key of the developer's own runs no brain; sign in for one\n");
    } else {
      write("Luke brain: absent — no signed-in account\n");
    }
  }
}
