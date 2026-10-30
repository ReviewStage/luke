import { HOST_WIRE } from "@luke/features/host-wire";
import { Effect, Option, Path, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";

/**
 * host-device-record.ts -- a machine's record of the device it enrolled as (`device.json` in `luke-host`'s state): its id, its device secret, the service it enrolled with, and whether that service has since refused the secret.
 *
 * A box writes it as `luke-host connect` pairs it with a code
 * (`daemon/host-pairing.ts`); on a Mac the desktop app writes it as it turns
 * This Mac's `luke-host` on (`compose-this-mac-host.ts`), into the app's own
 * state folder, which is the daemon's there. Either way it is made `0600` in
 * a folder made `0700` before a byte of the secret is written, beside the
 * file and moved over it, so a write cut off leaves the last whole record.
 * The daemon reads it as it starts and calls every procedure on its secret.
 * Once Luke refuses that secret, the machine was removed, and the daemon
 * marks the record refused rather than deleting it, so nothing that reads
 * it, the daemon at its next start or the app, takes the machine as never
 * enrolled and enrolls it again unasked. The record is never logged, and no
 * answer or report names the secret.
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
  /** Present once Luke refused the secret: the machine was removed, and comes back only by joining again. */
  refused: Schema.optionalKey(Schema.Literal(true)),
});

/** The device a machine enrolled as. */
export type HostDevice = typeof HostDeviceSchema.Type;

const decodeDevice = Schema.decodeUnknownOption(Schema.fromJsonString(HostDeviceSchema));
const encodeDevice = Schema.encodeSync(Schema.fromJsonString(HostDeviceSchema));

/** The device the machine enrolled as, from its state; none where it never enrolled, or its record does not read. */
export const readHostDevice = Effect.fnUntraced(function* (stateRoot: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const text = yield* fileSystem
    .readFileString(path.join(stateRoot, DEVICE_FILE))
    .pipe(Effect.orElseSucceed(() => ""));
  return decodeDevice(text);
});

/** The record written whole, readable by its owner alone, beside the file and moved over it. */
export const writeHostDevice = Effect.fnUntraced(function* (stateRoot: string, device: HostDevice) {
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

/** The record marked refused, where it still holds the secret given, so a record enrolled again since is left alone. */
export const markHostDeviceRefused = Effect.fnUntraced(function* (
  stateRoot: string,
  deviceSecret: string,
) {
  const kept = yield* readHostDevice(stateRoot);
  if (Option.isNone(kept) || kept.value.deviceSecret !== deviceSecret) return;
  yield* writeHostDevice(stateRoot, { ...kept.value, refused: true });
});
