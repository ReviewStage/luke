import type { AccountRefreshFailed } from "@luke/features";
import type { LiveDiagnostics } from "@luke/live";
import type { AppSettingField, AppSettingValue } from "@luke/settings";
import { Effect } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { type LiveSessionSource, unavailableLiveDiagnostics } from "./live-session-source.js";
import type { OpenSocket } from "./live-socket.js";

interface VoiceSettings {
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
  #unavailableLiveDiagnostics: LiveDiagnostics;
  #applications = 0;

  constructor(options: VoiceCapabilityAssemblerOptions) {
    this.#options = options;
    this.#unavailableLiveDiagnostics = unavailableLiveDiagnostics({
      fixtureMode: options.fixtureRun(),
    });
  }

  /**
   * Where a GPT Live session comes from: nowhere, since Luke's voice service
   * is gone and no session is opened on a key of the developer's own.
   */
  get liveSessions(): LiveSessionSource | undefined {
    return undefined;
  }

  get unavailableLiveDiagnostics(): LiveDiagnostics {
    return this.#unavailableLiveDiagnostics;
  }

  /**
   * Publishes the capability set, which offers no live session, and reports
   * why. Each application takes its number as it begins, so a caller about to
   * build on the published set can ask whether a newer one has begun since.
   */
  apply(): Effect.Effect<VoiceCapabilityApplication, PlatformError> {
    return Effect.sync(() => {
      const application = ++this.#applications;
      const isCurrent = () => application === this.#applications;
      this.#unavailableLiveDiagnostics = unavailableLiveDiagnostics({
        fixtureMode: this.#options.fixtureRun(),
      });
      this.#report();
      return { latest: true, isCurrent };
    });
  }

  #report(): void {
    // The console where none is handed in: a desktop's main process and a browser tab both have one.
    const write = this.#options.report ?? ((message: string) => console.warn(message.trimEnd()));
    write(`Luke voice: unavailable — ${this.#unavailableLiveDiagnostics.lastOutcome}\n`);
  }
}
