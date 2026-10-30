import { DEVICE_ISOLATION } from "@luke/features/device-agent-wire";
import { Effect, Option, Path, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";

/**
 * local-agent-state.ts -- what a machine keeps of its local agents between runs (`local-agents.json` in its state): the device id each account registered under, the launches no exit has settled yet, how each agent has run there, the agents whose folders a discard kept, and since when, and when each agent was last used there; read and written alike by the follower (`compose-local-agents.ts`) and by This Mac's turn-on (`compose-this-mac-host.ts`). Beside it, which agents' folders this machine made (`owned-agents`).
 *
 * The follower holds the state while it follows and writes it whole; This
 * Mac's turn-on, in the app, reads and changes it in place, never while the
 * follower would write the same field: it mints the account's device id
 * before `luke-host` is enrolled under it, and hands the account's kept
 * launches to that device before its login item is registered. A file that
 * cannot be read or decoded reads as nothing kept, and a key it does not
 * know, as one an earlier build kept, is read past and left out of the next
 * write. A write lands beside the file and is moved over it, so a write cut
 * off leaves the last whole one.
 */

/** The file in the machine's state the device ids and the launches running are kept in. */
const STATE_FILE = "local-agents.json";

/**
 * The folder in the machine's state holding an empty file for each agent
 * whose folder this machine made, named for the agent, from its first
 * launch or files, or, for one it last ran before it kept this record, the
 * first time its follower's gate opens after, until a discard removes its
 * folder. The folder stands in the user's own `~/.luke/agents`, which every
 * Luke install for that user shares, so `luke-host uninstall` reads this to
 * remove its own and no other's (`apps/host/scripts/luke-host.sh`), and the
 * follower to pass over its own alone (`ownedAgents`).
 */
const OWNED_FOLDER = "owned-agents";

/**
 * The state: the device id each account registered under, the launches
 * whose runners this device started and the service has not yet taken a
 * settle of, each with the agent it ran for, absent from a launch kept
 * before it, on a device whose agents may have run directly on it
 * (`formerlyDirect`), how each agent has run here, in a folder of its own
 * or on the developer's own logins,
 * the agents the service no longer lists whose folders a discard kept for
 * work in them, each with when it was first kept (epoch milliseconds),
 * which the follower never checks again while they stand and lets go of
 * whole a week after, and when each agent whose folder stands was last used
 * here (epoch milliseconds): its last launch, turn's end, or files written,
 * or, for a folder from before the record, the first start that kept it,
 * which a pass reads to clear the folders of agents long unused; each of
 * the last three absent from a state file from before it.
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
  kept: Schema.optionalKey(Schema.Record(Schema.String, Schema.Int)),
  lastUsed: Schema.optionalKey(Schema.Record(Schema.String, Schema.Int)),
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

/** The agent given kept as one whose folder this machine made; a write that fails is let go, since the record only serves an uninstall. */
export const keepOwnedAgent = (stateRoot: string, agentId: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const owned = path.join(stateRoot, OWNED_FOLDER);
    yield* fileSystem.makeDirectory(owned, { recursive: true, mode: 0o700 });
    yield* fileSystem.writeFileString(path.join(owned, agentId), "");
  }).pipe(Effect.ignore);

/** The agents kept as ones whose folder this machine made, by id; none where the record cannot be read. */
export const ownedAgents = (stateRoot: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* fileSystem.readDirectory(path.join(stateRoot, OWNED_FOLDER));
  }).pipe(Effect.orElseSucceed((): readonly string[] => []));

/** The agent given no longer kept as one whose folder this machine made, once its folder is gone. */
export const forgetOwnedAgent = (stateRoot: string, agentId: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.remove(path.join(stateRoot, OWNED_FOLDER, agentId), { force: true });
  }).pipe(Effect.ignore);
