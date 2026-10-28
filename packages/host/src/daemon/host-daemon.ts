import { randomUUID } from "node:crypto";
import { HostedDeviceAgentClient } from "@luke/features";
import { Effect, Layer } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { composeLocalAgents } from "../compose-local-agents.js";
import { LocalAgentPlatform, type LocalAgentPlatformSeam, Reporter } from "../effect/seams.js";
import { type HostDevice, markHostDeviceRefused } from "../host-device-record.js";
import { hostServiceStanding } from "./host-standing.js";

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
 * app takes the box as never enrolled, and returns. Everything else is the
 * follower's own: its reads and claims retried in place when Luke is out of
 * reach, and the launches it kept settled as it next opens.
 */

export interface HostDaemonOptions {
  /** The daemon's state: the device record, the follower's own, and the tools it fetched. */
  readonly stateRoot: string;
  readonly device: HostDevice;
  readonly version: string;
  readonly platform: LocalAgentPlatformSeam;
}

/** The daemon run until Luke refuses the box's secret, every runner it started stopped and its record marked refused before it returns. */
export const hostDaemon = Effect.fnUntraced(function* (options: HostDaemonOptions) {
  const { report } = yield* Reporter;
  const standing = yield* hostServiceStanding({
    serviceOrigin: options.device.serviceOrigin,
    version: options.version,
    report,
  });
  const secret = `Bearer ${options.device.deviceSecret}`;
  const { deviceId } = options.device;
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
  }).pipe(
    Effect.provide(Layer.succeed(LocalAgentPlatform, options.platform)),
    Effect.updateService(HttpClient.HttpClient, standing.client),
  );
  // Note that the follower lives in this scope alone, so closing it once the secret is refused stops every runner it started.
  yield* Effect.scoped(Effect.andThen(composer.lifetime, standing.secretRefused));
  yield* Effect.ignore(markHostDeviceRefused(options.stateRoot, options.device.deviceSecret));
});
