import { DEVICE_ISOLATION } from "@luke/features/device-agent-wire";
import { Effect, Option, Path, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";

/**
 * local-agent-state.ts -- what a machine keeps of its local agents between runs (`local-agents.json` in its state): the device id each account registered under, the launches no exit has settled yet, and how each agent has run there; read and written alike by the follower (`compose-local-agents.ts`) and by This Mac's turn-on (`compose-this-mac-host.ts`).
 *
 * The follower holds the state while it follows and writes it whole; This
 * Mac's turn-on, in the app, reads and changes it in place, never while the
 * follower would write the same field: it mints the account's device id
 * before `luke-host` is enrolled under it, and hands the account's kept
 * launches to that device before its login item is registered. A file that
 * cannot be read or decoded reads as nothing kept. A write lands beside the
 * file and is moved over it, so a write cut off leaves the last whole one.
 */

/** The file in the machine's state the device ids and the launches running are kept in. */
const STATE_FILE = "local-agents.json";

/**
 * The state: the device id each account registered under, the launches
 * whose runners this device started and the service has not yet taken a
 * settle of, each with the agent whose VM it ran in, absent from a launch
 * kept before it, and, on a device whose agents may have run directly on it
 * (`formerlyDirect`), how each agent has run here, in a VM or directly,
 * absent from a state file from before it.
 */
const LocalAgentStateSchema = Schema.Struct({
  devices: Schema.Record(Schema.String, Schema.String),
  launches: Schema.Array(
    Schema.Struct({
      userId: Schema.String,
      id: Schema.String,
      agentId: Schema.optionalKey(Schema.String),
    }),
  ),
  modes: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Literals(Object.values(DEVICE_ISOLATION))),
  ),
});

export type LocalAgentState = typeof LocalAgentStateSchema.Type;

const NO_STATE: LocalAgentState = { devices: {}, launches: [] };

const decodeState = Schema.decodeUnknownOption(Schema.fromJsonString(LocalAgentStateSchema));
const encodeState = Schema.encodeSync(Schema.fromJsonString(LocalAgentStateSchema));

const statePathOf = (stateRoot: string) =>
  Effect.map(Path.Path, (path) => path.join(stateRoot, STATE_FILE));

/** The state as the file holds it; nothing kept where it cannot be read. */
export const readLocalAgentState = (stateRoot: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const text = yield* fileSystem.readFileString(yield* statePathOf(stateRoot));
    return Option.getOrElse(decodeState(text), () => NO_STATE);
  }).pipe(Effect.orElseSucceed(() => NO_STATE));

/** The state written whole, beside the file and moved over it. */
export const writeLocalAgentState = (stateRoot: string, state: LocalAgentState) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const statePath = yield* statePathOf(stateRoot);
    const written = `${statePath}.writing`;
    yield* fileSystem.writeFileString(written, `${encodeState(state)}\n`);
    yield* fileSystem.rename(written, statePath);
  });

/** The state read, changed, and written again; whether it landed. */
const changed = (stateRoot: string, change: (current: LocalAgentState) => LocalAgentState) =>
  Effect.flatMap(readLocalAgentState(stateRoot), (current) =>
    writeLocalAgentState(stateRoot, change(current)).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    ),
  );

/** The device id the account registers under on this machine: the one kept, or one minted with `createId` and kept the first time. */
export const localAgentDeviceOf = (stateRoot: string, userId: string, createId: () => string) =>
  Effect.gen(function* () {
    const kept = (yield* readLocalAgentState(stateRoot)).devices[userId];
    if (kept !== undefined) return kept;
    const minted = createId();
    yield* changed(stateRoot, (current) => ({
      ...current,
      devices: { ...current.devices, [userId]: minted },
    }));
    return minted;
  });

/** The account the device id given was minted for on this machine; none where the state names none. */
export const localAgentOwnerOf = (stateRoot: string, deviceId: string) =>
  Effect.map(
    readLocalAgentState(stateRoot),
    ({ devices }) => Object.entries(devices).find(([, kept]) => kept === deviceId)?.[0],
  );

/**
 * Every launch kept under the account handed to the device given, so the
 * follower that runs on the device's own secret (`@luke/host/daemon`), whose
 * account is its device, settles them; whether that landed.
 */
export const localAgentLaunchesHanded = (stateRoot: string, userId: string, deviceId: string) =>
  changed(stateRoot, (current) => ({
    ...current,
    launches: current.launches.map((launch) =>
      launch.userId === userId ? { ...launch, userId: deviceId } : launch,
    ),
  }));
