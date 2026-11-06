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

const REFUSED_READ = Duration.minutes(1);

export const HOST_DAEMON_END = { REMOVED: "removed", UPDATED: "updated" } as const;

export interface HostDaemonOptions {
  readonly stateRoot: string;
  readonly device: HostDevice;
  readonly version: string;
  readonly platform: LocalAgentPlatformSeam;
  readonly releases?: HostReleases | undefined;
}

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
  const ended = yield* Effect.scoped(
    Effect.gen(function* () {
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
  readonly stateRoot: string;
  readonly device: HostDevice;
}

export const hostRefusedRest = Effect.fnUntraced(function* (options: HostRefusedRestOptions) {
  const { report } = yield* Reporter;
  const { stateRoot, device } = options;
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
