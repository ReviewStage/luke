import { randomUUID } from "node:crypto";
import { HostedDeviceAgentClient } from "@luke/features";
import { Effect, Layer } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { composeLocalAgents } from "../compose-local-agents.js";
import { LocalAgentPlatform, type LocalAgentPlatformSeam, Reporter } from "../effect/seams.js";
import { type HostDevice, markHostDeviceRefused } from "../host-device-record.js";
import { hostServiceStanding } from "./host-standing.js";
import { type HostReleases, hostTargetOf, hostUpdate } from "./host-update.js";

/**
 * host-daemon.ts -- a host's daemon: the shared follower (`compose-local-agents.ts`) run on the device the box enrolled as, on its device secret, with its OS's platform, for as long as its scope stands.
 *
 * The follower is the desktop's own, handed what a box with nobody signed
 * in at it has in place of an account: its device id for the account and
 * the device both, its device secret as the bearer of every call in place
 * of the desktop's OAuth sign-in, and a gate that stands open but while
 * Luke has refused the box (`host-standing.ts`), so a daemon below the
 * service's floor, or a removed box, rests rather than asks Luke every few
 * seconds. Once Luke refuses the box's secret, the host was removed, so the
 * daemon stops every runner it started, marks the box's record refused
 * (`host-device-record.ts`), so neither it at its next start nor This Mac's
 * app takes the box as never enrolled, and returns. A daemon of an account
 * install, handed its releases, updates itself to the newer release Luke
 * names (`host-update.ts`), and once it switched to it, returns the same
 * way, every runner stopped, for its service manager to start it again on
 * the new release. Everything else is the follower's own: its reads and
 * claims retried in place when Luke is out of reach, and the launches it
 * kept settled as it next opens.
 */

/** Why the daemon returned: Luke refused the box's secret, or it switched to a newer release, which a start on it runs. */
export const HOST_DAEMON_END = { REMOVED: "removed", UPDATED: "updated" } as const;

export interface HostDaemonOptions {
  /** The daemon's state: the device record, the follower's own, and the tools it fetched. */
  readonly stateRoot: string;
  readonly device: HostDevice;
  readonly version: string;
  readonly platform: LocalAgentPlatformSeam;
  /** The account install's releases, where the daemon runs from one of them; none where it takes no notice of a newer release. */
  readonly releases?: HostReleases | undefined;
}

/** The daemon run until Luke refuses the box's secret, every runner it started stopped and its record marked refused before it returns, or until it switched to a newer release, every runner stopped. */
export const hostDaemon = Effect.fnUntraced(function* (options: HostDaemonOptions) {
  const { report } = yield* Reporter;
  const standing = yield* hostServiceStanding({
    serviceOrigin: options.device.serviceOrigin,
    version: options.version,
    report,
  });
  const secret = `Bearer ${options.device.deviceSecret}`;
  const { deviceId } = options.device;
  const { releases, platform } = options;
  const target = hostTargetOf(platform.devicePlatform, platform.deviceArch);
  // Note that the follower and the update live in this scope alone, so closing it once the secret is refused, or the daemon switched releases, stops every runner it started.
  const ended = yield* Effect.scoped(
    Effect.gen(function* () {
      // Note that the update is made on the daemon's own client, never the one that puts its version on a call to Luke, so its download carries nothing of Luke's.
      const update =
        releases === undefined || target === undefined
          ? undefined
          : yield* hostUpdate({ releases, version: options.version, target });
      const composer = yield* composeLocalAgents({
        kernel: {
          stateRoot: options.stateRoot,
          createId: randomUUID,
          runMode: { sendsNetwork: true },
        },
        account: { capabilitiesActive: () => true },
        // Note that the device id stands for the account too, since a host holds no account of its own and acts for its device alone.
        accountId: () => deviceId,
        deviceId,
        switchedOn: standing.asking,
        client: new HostedDeviceAgentClient({
          serviceBaseUrl: options.device.serviceOrigin,
          credential: { authorization: () => Effect.succeed(secret) },
        }),
        update: update?.follower,
      }).pipe(
        Effect.provide(Layer.succeed(LocalAgentPlatform, platform)),
        Effect.updateService(HttpClient.HttpClient, standing.client),
      );
      return yield* Effect.andThen(
        composer.lifetime,
        Effect.race(
          Effect.as(standing.secretRefused, HOST_DAEMON_END.REMOVED),
          Effect.as(update?.ended ?? Effect.never, HOST_DAEMON_END.UPDATED),
        ),
      );
    }),
  );
  if (ended === HOST_DAEMON_END.REMOVED) {
    yield* Effect.ignore(markHostDeviceRefused(options.stateRoot, options.device.deviceSecret));
  }
  return ended;
});
