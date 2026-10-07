import type { Effect, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { DevicePlatform, PushEnvironment } from "../core.js";

/**
 * The device record's vocabulary: what a registration and a heartbeat write,
 * and the seams a caller runs them through. The briefing push forgets a row
 * whose token Apple reports gone through `forgetDevice`.
 */

/** A push token with the gateway that issued it, as a row stores the pair. */
interface DevicePushAddress {
  token: string;
  environment: PushEnvironment;
}

/**
 * What a registration writes: the row's key, its platform, and the push
 * address it arrived with. An address replaces the one on file; none leaves
 * it, because a device that registers before Apple has handed its token back
 * still has the token it registered with last time.
 */
interface DeviceRegistration {
  installationId: string;
  platform: DevicePlatform;
  push: DevicePushAddress | undefined;
}

/**
 * What a heartbeat writes beside the last-seen instant. `push` is a change
 * only when present: a new address replaces the one on file, `null` clears
 * it, and absent leaves it. `activeUntil` and `quietUntil` likewise move only
 * when the device reported them; the heartbeat carries no quiet instant, the
 * change-signal poll does.
 */
interface DeviceHeartbeat {
  deviceId: string;
  /** `null` clears the presence on file, which is how a device reports it went idle. */
  activeUntil: Date | null | undefined;
  /** The instant a meeting hold the device observes ends; `null` clears it, absent leaves it. */
  quietUntil?: Date | null | undefined;
  push: DevicePushAddress | null | undefined;
}

/** What a device write answers: an effect over the ambient client, composed into the request that made it. */
type DeviceEffect<A> = Effect.Effect<A, SqlError | Schema.SchemaError, SqlClient.SqlClient>;

export interface DeviceSeams {
  /**
   * Upserts the installation's row under the account, moving it from any
   * account that held it, and answers the row's id, minted here on a first
   * registration and kept across every later one.
   */
  registerDevice: (
    userId: string,
    registration: DeviceRegistration,
    mintId: () => string,
    now: Date,
  ) => DeviceEffect<{ deviceId: string }>;
  /** Moves the row's last-seen instant and applies the heartbeat's changes; answers whether the account holds the row. */
  touchDevice: (userId: string, heartbeat: DeviceHeartbeat, now: Date) => DeviceEffect<boolean>;
  /** Deletes the row only where this account holds it; answers whether a row went. */
  forgetDevice: (userId: string, deviceId: string) => DeviceEffect<boolean>;
}
