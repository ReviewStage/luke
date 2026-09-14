import { HostedModelAdapter, RESPONSES_OPERATION } from "@sidecar/brain";
import { HOSTED_VOICE_SERVICE_ORIGIN } from "@sidecar/hosted";
import type { LiveDiagnostics } from "@sidecar/live";
import type { ExecutionRuntime, ModelAdapter } from "@sidecar/runtime/vocabulary";
import { APP_SETTING_SCHEMA, type AppSettingField, type AppSettingValue } from "@sidecar/settings";
import { Effect, type Layer } from "effect";
import type { PlatformError } from "effect/PlatformError";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import {
  HostedLiveSessionSource,
  type LiveSessionSource,
  unavailableLiveDiagnostics,
} from "./live-session-source.js";
import type { OpenSocket } from "./live-socket.js";

export interface VoiceSettings {
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
  /** What a brain model's own request effects are run on; `Context.empty()` for a caller that gave none. */
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
   * account runs them through Luke's hosted service on Luke's key; a fixture
   * or evidence run, or a run with no account, has no brain, so nothing is
   * announced and an ask meets the honest refusal. No credential of the
   * developer's own is ever what a brain turn runs on.
   */
  get brainModel(): ModelAdapter | undefined {
    return this.#brainModel;
  }

  /**
   * The small model the read prefetch plans and summarizes on, on the same
   * account as the brain's model: the hosted service's prefetch operation,
   * which the service advertises or not. Nothing when no brain may stand,
   * and then nothing is read ahead.
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
   * account stands, or when the host handed no socket seam.
   */
  get liveSessions(): LiveSessionSource | undefined {
    return this.#liveSessions;
  }

  get unavailableLiveDiagnostics(): LiveDiagnostics {
    return this.#unavailableLiveDiagnostics;
  }

  /**
   * Reads the account gate and the preferences, and publishes the capability
   * set they decide as one unit, after every read has completed. Two
   * applications can overlap — a sign-out while a preference read is still
   * out — and the older must never publish over the newer: each application
   * takes its number before its first await and checks it after its last,
   * and one that has been overtaken installs nothing.
   */
  apply(): Effect.Effect<VoiceCapabilityApplication, PlatformError> {
    return Effect.gen({ self: this }, function* () {
      const application = ++this.#applications;
      const isCurrent = () => application === this.#applications;
      // The one credential anything here runs on: the signed-in account,
      // while this run may use credentials at all. Read before the first
      // suspension, so an application answers for the gate as it stood when
      // it began and a later change is the next application's to publish.
      const useHosted = this.#options.credentialsUsable() && this.#options.accountSignedIn();
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

      const builtBrainModel = useHosted ? new HostedModelAdapter(seams) : undefined;
      this.#brainModel =
        builtBrainModel && this.#options.wrapBrainModel
          ? this.#options.wrapBrainModel(builtBrainModel)
          : builtBrainModel;
      const builtPrefetchModel = useHosted
        ? new HostedModelAdapter({ ...seams, respondOperation: RESPONSES_OPERATION.PREFETCH })
        : undefined;
      this.#prefetchModel =
        builtPrefetchModel && this.#options.wrapBrainModel
          ? this.#options.wrapBrainModel(builtPrefetchModel)
          : builtPrefetchModel;
      const openSocket = this.#options.openSocket;
      this.#liveSessions =
        openSocket && useHosted
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
      this.#report();
      for (const listener of this.#applied) listener();
      return { latest: true, isCurrent };
    });
  }

  #report(): void {
    const write = this.#options.report ?? ((message: string) => process.stderr.write(message));
    if (this.#liveSessions) {
      write(`Luke voice: enabled (hosted, ${this.#liveSessions.diagnostics().model})\n`);
    } else {
      write(`Luke voice: unavailable — ${this.#unavailableLiveDiagnostics.lastOutcome}\n`);
    }
    if (this.#brainModel) {
      write(`Luke brain: enabled (${this.#brainModel.model ?? "model chosen by the service"})\n`);
    } else {
      write("Luke brain: absent — no signed-in account\n");
    }
  }
}
