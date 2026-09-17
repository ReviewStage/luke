import { type AccountRefreshFailed, HOSTED_VOICE_SERVICE_ORIGIN } from "@sidecar/hosted";
import type { LiveDiagnostics } from "@sidecar/live";
import { APP_SETTING_SCHEMA, type AppSettingField, type AppSettingValue } from "@sidecar/settings";
import { Effect } from "effect";
import type { PlatformError } from "effect/PlatformError";
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
  refreshAccount: () => Effect.Effect<void, AccountRefreshFailed>;
  /** This installation's device row id, for the hosted session's handshake; absent or answering nothing, the handshake names no device. */
  deviceId?: () => string | undefined;
  report?: (message: string) => void;
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
  #liveSessions: LiveSessionSource | undefined;
  #unavailableLiveDiagnostics: LiveDiagnostics;
  #applications = 0;

  constructor(options: VoiceCapabilityAssemblerOptions) {
    this.#options = options;
    this.#unavailableLiveDiagnostics = unavailableLiveDiagnostics({
      fixtureMode: options.fixtureRun(),
    });
  }

  /**
   * Where a GPT Live session comes from: the signed-in account through Luke's
   * voice service, on Luke's key. Nothing when no account stands, or when the
   * host handed no socket seam. No credential of the developer's own is ever
   * what a session runs on.
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
      const seams = {
        readAccessToken: () => Effect.map(readAccount(), (account) => account?.accessToken),
        refreshAccount: this.#options.refreshAccount,
        readAccountKey: () => Effect.map(readAccount(), (account) => account?.email),
      };
      const voice = yield* this.#options.settings
        .get(APP_SETTING_SCHEMA.voice.field)
        .pipe(Effect.orElseSucceed(() => undefined));
      if (!isCurrent()) return { latest: false, isCurrent };

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
  }
}
