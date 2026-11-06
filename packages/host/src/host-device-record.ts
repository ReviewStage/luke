import { HOST_WIRE } from "@repo/features/host-wire";
import { Effect, Option, Path, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";

const DEVICE_FILE = "device.json";

const HostDeviceSchema = Schema.Struct({
  deviceId: Schema.String,
  deviceSecret: Schema.String.check(
    Schema.makeFilter(
      (value: string) => value.startsWith(HOST_WIRE.DEVICE_SECRET_PREFIX) || "a device secret",
    ),
  ),
  serviceOrigin: Schema.String,
  refused: Schema.optionalKey(Schema.Literal(true)),
});

export type HostDevice = typeof HostDeviceSchema.Type;

const decodeDevice = Schema.decodeUnknownOption(Schema.fromJsonString(HostDeviceSchema));
const encodeDevice = Schema.encodeSync(Schema.fromJsonString(HostDeviceSchema));

export const readHostDevice = Effect.fnUntraced(function* (stateRoot: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const text = yield* fileSystem
    .readFileString(path.join(stateRoot, DEVICE_FILE))
    .pipe(Effect.orElseSucceed(() => ""));
  return decodeDevice(text);
});

export const writeHostDevice = Effect.fnUntraced(function* (stateRoot: string, device: HostDevice) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.makeDirectory(stateRoot, { recursive: true, mode: 0o700 });
  yield* fileSystem.chmod(stateRoot, 0o700);
  const file = path.join(stateRoot, DEVICE_FILE);
  const written = `${file}.writing`;
  yield* fileSystem.remove(written, { force: true });
  yield* fileSystem.writeFileString(written, "", { flag: "wx", mode: 0o600 });
  yield* fileSystem.writeFileString(written, `${encodeDevice(device)}\n`);
  yield* fileSystem.rename(written, file);
});

export const removeHostDevice = Effect.fnUntraced(function* (stateRoot: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.remove(path.join(stateRoot, DEVICE_FILE), { force: true });
});

export const markHostDeviceRefused = Effect.fnUntraced(function* (
  stateRoot: string,
  deviceSecret: string,
) {
  const kept = yield* readHostDevice(stateRoot);
  if (Option.isNone(kept) || kept.value.deviceSecret !== deviceSecret) return;
  yield* writeHostDevice(stateRoot, { ...kept.value, refused: true });
});
