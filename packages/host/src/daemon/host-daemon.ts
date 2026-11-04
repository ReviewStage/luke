import { randomUUID } from "node:crypto";
import { HostedDeviceAgentClient } from "@repo/features";
import { HOST_WIRE } from "@repo/features/host-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { Clock, Duration, Effect, Layer, Option } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { composeLocalAgents } from "../compose-local-agents.js";
import { LocalAgentPlatform, type LocalAgentPlatformSeam, Reporter } from "../effect/seams.js";
import {
  type HostDevice,
  markHostDeviceAccepted,
  markHostDeviceRefused,
  readHostDevice,
} from "../host-device-record.js";
import { hostServiceStanding } from "./host-standing.js";
import { type HostReleases, hostTargetOf, hostUpdate } from "./host-update.js";

/**
 * host-daemon.ts -- a host's daemon: the shared follower (`compose-local-agents.ts`) run on the device the box enrolled as, on its device secret, with its OS's platform, for as long as its scope stands.
 *
 * The follower is the desktop's own, handed what a box with nobody signed
 * in at it has in place of an account: its device id for the account and
 * the device both, its device secret as the bearer of every call in place
 * of the desktop's OAuth sign-in, and a gate that stands open but while
 * the service has refused its version (`host-standing.ts`), so a daemon below the
 * service's floor rests rather than asks the service every few seconds. Once
 * the service settles the box's secret as refused, the host was removed, so the
 * daemon stops every runner it started, marks the box's record refused
 * (`host-device-record.ts`), so neither it at its next start nor This Mac's
 * app takes the box as never enrolled, and returns. A daemon of an account
 * install, handed its releases, updates itself to the newer release the service
 * names (`host-update.ts`), and once it switched to it, returns the same
 * way, every runner stopped, for its service manager to start it again on
 * the new release. Everything else is the follower's own: its reads and
 * claims retried in place when the service is out of reach, and the launches it
 * kept settled as it next opens.
 *
 * A box whose record is refused rests (`hostRefusedRest`) rather than
 * exiting: it reads its record every `REFUSED_READ`, so a connect again,
 * by hand or by This Mac's app, is followed within a minute, and asks the
 * service every `REFUSED_ASK` whether it takes the stored secret again, as
 * a database restored to before it lost the box would; once it does, the
 * record's refusal is taken back and the box follows its agents again.
 */

/** How often a refused box reads its record again, for a connect that wrote a new one. */
const REFUSED_READ = Duration.minutes(1);

/** How often a refused box asks the service whether it takes its stored secret again. */
const REFUSED_ASK = Duration.minutes(20);

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

export interface HostRefusedRestOptions {
  /** The daemon's state, where its device record stands. */
  readonly stateRoot: string;
  /** The record the service refused. */
  readonly device: HostDevice;
  readonly version: string;
}

/**
 * The rest of a box whose record the service refused, said once as it
 * starts, until the record no longer stands refused on the secret it was
 * refused on: replaced by a connect again, or accepted once the service
 * took that secret again, said once too. The ask is a read of its live
 * agents, which changes nothing in the service.
 */
export const hostRefusedRest = Effect.fnUntraced(function* (options: HostRefusedRestOptions) {
  const { report } = yield* Reporter;
  const { stateRoot, device } = options;
  const client = new HostedDeviceAgentClient({
    serviceBaseUrl: device.serviceOrigin,
    credential: { authorization: () => Effect.succeed(`Bearer ${device.deviceSecret}`) },
  });
  const accepted = client.liveAgents(device.deviceId).pipe(
    Effect.map((agentIds) => agentIds !== undefined),
    Effect.updateService(
      HttpClient.HttpClient,
      HttpClient.mapRequest((request) =>
        HttpClientRequest.setHeader(request, HOST_WIRE.VERSION_HEADER, options.version),
      ),
    ),
  );
  /** Whether the record still stands refused on the secret this rest was handed. */
  const stillRefused = Effect.map(readHostDevice(stateRoot), (kept) =>
    Option.exists(
      kept,
      (record) => record.refused === true && record.deviceSecret === device.deviceSecret,
    ),
  );
  report(
    `${PRODUCT_NAME} host: ${PRODUCT_NAME} refused this box's secret, so it was removed. It asks ${PRODUCT_NAME} again every ${Duration.format(REFUSED_ASK)} in case it takes the secret again; connect it again to follow its agents now.`,
  );
  let askedAt = Number.NEGATIVE_INFINITY;
  for (;;) {
    yield* Effect.sleep(REFUSED_READ);
    if (!(yield* stillRefused)) return;
    const now = yield* Clock.currentTimeMillis;
    if (now - askedAt < Duration.toMillis(REFUSED_ASK)) continue;
    askedAt = now;
    if (yield* accepted) {
      yield* markHostDeviceAccepted(stateRoot, device.deviceSecret);
      report(
        `${PRODUCT_NAME} host: ${PRODUCT_NAME} took this box's secret again, so it follows its agents again.`,
      );
      return;
    }
  }
});
