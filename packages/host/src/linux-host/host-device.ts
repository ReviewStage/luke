import { randomUUID } from "node:crypto";
import { enrollHost, HOST_ENROLL_OUTCOME, type HostEnrollOutcome } from "@luke/features";
import type { DeviceArch } from "@luke/features/device-agent-wire";
import { DEVICE_PLATFORM } from "@luke/features/device-agent-wire";
import { HOST_WIRE } from "@luke/features/host-wire";
import { Effect, Option, Path, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

/**
 * host-device.ts -- the box's own record of the device it enrolled as: its id, its device secret, and the service it enrolled with, kept readable by the `luke-host` user alone.
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

/** The record's file, in the daemon's state. */
const DEVICE_FILE = "device.json";

const HostDeviceSchema = Schema.Struct({
  deviceId: Schema.String,
  deviceSecret: Schema.String.check(
    Schema.makeFilter(
      (value: string) => value.startsWith(HOST_WIRE.DEVICE_SECRET_PREFIX) || "a device secret",
    ),
  ),
  serviceOrigin: Schema.String,
});

/** The device the box enrolled as. */
export type HostDevice = typeof HostDeviceSchema.Type;

const decodeDevice = Schema.decodeUnknownOption(Schema.fromJsonString(HostDeviceSchema));
const encodeDevice = Schema.encodeSync(Schema.fromJsonString(HostDeviceSchema));

/** The device the box enrolled as, from its state; none where it never enrolled, or its record does not read. */
export const readHostDevice = Effect.fnUntraced(function* (stateRoot: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const text = yield* fileSystem
    .readFileString(path.join(stateRoot, DEVICE_FILE))
    .pipe(Effect.orElseSucceed(() => ""));
  return decodeDevice(text);
});

/** The record written whole, readable by its owner alone, beside the file and moved over it. */
const writeHostDevice = Effect.fnUntraced(function* (stateRoot: string, device: HostDevice) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.makeDirectory(stateRoot, { recursive: true, mode: 0o700 });
  yield* fileSystem.chmod(stateRoot, 0o700);
  const file = path.join(stateRoot, DEVICE_FILE);
  const written = `${file}.writing`;
  yield* fileSystem.remove(written, { force: true });
  // Note that the file is made 0600 before the secret is written into it, so it is never readable by another user.
  yield* fileSystem.writeFileString(written, "", { flag: "wx", mode: 0o600 });
  yield* fileSystem.writeFileString(written, `${encodeDevice(device)}\n`);
  yield* fileSystem.rename(written, file);
});

export interface HostEnrollInput {
  readonly stateRoot: string;
  readonly serviceOrigin: string;
  readonly installToken: string;
  /** The box's own name, as the Hosts list shows it. */
  readonly name: string;
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
    platform: DEVICE_PLATFORM.LINUX,
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
