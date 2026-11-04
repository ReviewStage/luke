import { randomUUID } from "node:crypto";
import { HostedDeviceAgentClient } from "@repo/features";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { Duration, Effect, Layer, Option } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { composeLocalAgents } from "../compose-local-agents.js";
import { LocalAgentPlatform, type LocalAgentPlatformSeam, Reporter } from "../effect/seams.js";
import { type HostDevice, markHostDeviceRefused, readHostDevice } from "../host-device-record.js";
import { hostServiceStanding } from "./host-standing.js";
import { type HostReleases, hostTargetOf, hostUpdate } from "./host-update.js";

/**
 * host-daemon.ts -- a host's daemon: the shared follower (`compose-local-agents.ts`) run on the device the box enrolled as, on its device secret, with its OS's platform, for as long as its scope stands.
 *
 * The follower is handed the device id the box enrolled under, its device
 * secret as the bearer of every call, and a gate that stands open but while
 * the service has refused its version (`host-standing.ts`), so a daemon below the
 * service's floor rests rather than asks the service every few seconds. Once
 * the service settles the box's secret as refused, the host was removed, so the
 * daemon stops every runner it started, marks the box's record refused
 * (`host-device-record.ts`), so neither it at its next start nor This Mac's
 * app takes the box as never enrolled, and returns. A daemon of an account
 * install, handed its releases, updates itself to the newer release the service
 * names (`host-update.ts`), and once it switched to it, returns the same
 * way, every runner stopped, for its service manager to start it again on
 * the new release. Everything else is the follower's own: its reads
 * asked again in place when the service is out of reach.
 *
 * A box whose record is refused rests (`hostRefusedRest`) rather than
 * exiting: it reads its record every `REFUSED_READ`, so a connect again,
 * by hand or by This Mac's app, is followed within a minute.
 */

/** How often a refused box reads its record again, for a connect that wrote a new one. */
const REFUSED_READ = Duration.minutes(1);

/** Why the daemon returned: the service refused the box's secret, or it switched to a newer release, which a start on it runs. */
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

/** The daemon run until the service refuses the box's secret, every runner it started stopped and its record marked refused before it returns, or until it switched to a newer release, every runner stopped. */
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
      // Note that the update is made on the daemon's own client, never the one that puts its version on a call to the service, so its download carries nothing of ours.
      const update =
        releases === undefined || target === undefined
          ? undefined
          : yield* hostUpdate({ releases, version: options.version, target });
      const composer = yield* composeLocalAgents({
        kernel: { stateRoot: options.stateRoot, createId: randomUUID },
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

export interface HostRefusedRestOptions {
  /** The daemon's state, where its device record stands. */
  readonly stateRoot: string;
  /** The record the service refused. */
  readonly device: HostDevice;
}

/**
 * The rest of a box whose record the service refused, said once as it
 * starts, until the record no longer stands refused on the secret it was
 * refused on: replaced by a connect again.
 */
export const hostRefusedRest = Effect.fnUntraced(function* (options: HostRefusedRestOptions) {
  const { report } = yield* Reporter;
  const { stateRoot, device } = options;
  /** Whether the record still stands refused on the secret this rest was handed. */
  const stillRefused = Effect.map(readHostDevice(stateRoot), (kept) =>
    Option.exists(
      kept,
      (record) => record.refused === true && record.deviceSecret === device.deviceSecret,
    ),
  );
  report(
    `${PRODUCT_NAME} host: ${PRODUCT_NAME} refused this box's secret, so it was removed. Connect it again to follow its agents.`,
  );
  for (;;) {
    yield* Effect.sleep(REFUSED_READ);
    if (!(yield* stillRefused)) return;
  }
});
