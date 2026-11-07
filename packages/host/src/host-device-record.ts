import { HOST_WIRE } from "@repo/features/host-wire";
import { Duration, Effect, Option, Path, Schema, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import { folderMoves } from "./folder-moves.js";

/**
 * host-device-record.ts -- a machine's record of the device it enrolled as (`device.json` in `vespin-host`'s state): its id, its device secret, the service it enrolled with, and whether that service has since refused the secret.
 *
 * A box writes it as `vespin-host connect` pairs it with a code
 * (`daemon/host-pairing.ts`); on a Mac the desktop app writes it as it
 * enrolls This Mac (`compose-this-mac-host.ts`), into the account install's
 * state folder, which is the daemon's there. Either way it is made `0600` in
 * a folder made `0700` before a byte of the secret is written, beside the
 * file and moved over it, so a write cut off leaves the last whole record.
 * The daemon reads it as it starts and calls every procedure on its secret.
 * Once the service refuses that secret, the machine was removed, and the daemon
 * marks the record refused rather than deleting it, so nothing that reads
 * it, the daemon at its next start or the app, takes the machine as never
 * enrolled and enrolls it again unasked. The record is never logged, and no
 * answer or report names the secret.
 */

/** The record's file, in the daemon's state. */
const DEVICE_FILE = "device.json";

/** How long the state folder stands still after a change before the record is read, so the several pulses of one write read it once. */
const RECORD_SETTLE = Duration.millis(250);

const HostDeviceSchema = Schema.Struct({
  deviceId: Schema.String,
  deviceSecret: Schema.String.check(
    Schema.makeFilter(
      (value: string) => value.startsWith(HOST_WIRE.DEVICE_SECRET_PREFIX) || "a device secret",
    ),
  ),
  serviceOrigin: Schema.String,
  /** Present once the service refused the secret: the machine was removed, and comes back by joining again. */
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

/** A pulse each time the record may have moved, as the folder it is written in is watched, since a write moves a new file over it. */
export const hostDeviceMoves = (
  stateRoot: string,
): Stream.Stream<void, never, FileSystem.FileSystem | Path.Path> => folderMoves(stateRoot);

/**
 * A wait until the record is one `holds` takes, as a daemon waits on a
 * connect: read as the wait starts, and again each time the state folder
 * settles after a move (`hostDeviceMoves`), never on a timer. Note that the
 * first read waits out the settle too, so the watch started beside it is
 * armed after one stat of the folder, before the read unless that stat takes
 * longer than the settle. A watch the system refuses fails the wait, for the
 * daemon's service to start it again, rather than leaving it waiting on
 * nothing.
 */
export const hostDeviceWhen = (
  stateRoot: string,
  holds: (record: Option.Option<HostDevice>) => boolean,
) =>
  Stream.merge(hostDeviceMoves(stateRoot), Stream.succeed(undefined)).pipe(
    Stream.debounce(RECORD_SETTLE),
    Stream.mapEffect(() => readHostDevice(stateRoot)),
    Stream.filter(holds),
    Stream.runHead,
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(`The state folder ${stateRoot} could not be watched.`),
        onSome: () => Effect.void,
      }),
    ),
  );

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

/** The record removed, as an uninstall removes it with the state, so the machine reads as never enrolled. */
export const removeHostDevice = Effect.fnUntraced(function* (stateRoot: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.remove(path.join(stateRoot, DEVICE_FILE), { force: true });
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
