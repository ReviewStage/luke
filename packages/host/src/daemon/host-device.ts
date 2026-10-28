import { randomUUID } from "node:crypto";
import { enrollHost, HOST_ENROLL_OUTCOME, type HostEnrollOutcome } from "@luke/features";
import type { DeviceArch, DevicePlatform } from "@luke/features/device-agent-wire";
import { HOST_WIRE } from "@luke/features/host-wire";
import { Effect, Option } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { readHostDevice, writeHostDevice } from "../host-device-record.js";

/**
 * host-device.ts -- a box enrolled with an install token, and its record of the device it enrolled as written (`../host-device-record.ts`): its id, its device secret, and the service it enrolled with, kept readable by the `luke-host` user alone.
 *
 * The install script runs the enroll once as that user (`luke-host enroll`),
 * which mints the box's device id the first time and keeps it, trades the
 * install token for the box's device secret (`@luke/features`'
 * `enrollHost`), and writes the three to `device.json` in the daemon's
 * state, made `0600` in a folder made `0700` before a byte of the secret is
 * written, beside the file and moved over it, so a write cut off leaves the
 * last whole record. Enrolling again keeps the id: a host still enrolled
 * keeps its record and its secret, since the service writes nothing for it
 * (`HOST_ENROLL_OUTCOME.STILL_ENROLLED`), and a host removed in Settings
 * comes back under the same id with a new secret. The daemon reads the record as it starts, and calls
 * every procedure on its secret from then on; the record is never logged,
 * and no answer or report names the secret.
 */

export interface HostEnrollInput {
  readonly stateRoot: string;
  readonly serviceOrigin: string;
  readonly installToken: string;
  /** The box's own name, as the Hosts list shows it. */
  readonly name: string;
  /** The OS the box runs, which the Hosts list says it is (`HostOs.platform`). */
  readonly platform: DevicePlatform;
  readonly arch: DeviceArch;
  /** The daemon's version, which the enroll carries as every call of a host's does. */
  readonly version: string;
}

/**
 * The box enrolled with the install token given, under the id it enrolled
 * under before or one minted now, and its record written where the service
 * took it; how the enroll ended either way. A record that cannot be written
 * fails, since the secret the service answered once is then lost.
 */
export const enrollHostDevice = Effect.fnUntraced(function* (input: HostEnrollInput) {
  const kept = yield* readHostDevice(input.stateRoot);
  const deviceId = Option.match(kept, {
    onNone: () => randomUUID(),
    onSome: (device) => device.deviceId,
  });
  const outcome: HostEnrollOutcome = yield* enrollHost(input.serviceOrigin, input.installToken, {
    deviceId,
    name: input.name,
    platform: input.platform,
    arch: input.arch,
  }).pipe(
    Effect.updateService(
      HttpClient.HttpClient,
      HttpClient.mapRequest(HttpClientRequest.setHeader(HOST_WIRE.VERSION_HEADER, input.version)),
    ),
  );
  if (outcome.outcome === HOST_ENROLL_OUTCOME.ENROLLED) {
    yield* writeHostDevice(input.stateRoot, {
      deviceId,
      deviceSecret: outcome.deviceSecret,
      serviceOrigin: input.serviceOrigin,
    });
  }
  return outcome;
});
