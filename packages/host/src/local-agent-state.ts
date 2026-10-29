import { DEVICE_ISOLATION } from "@luke/features/device-agent-wire";
import { Effect, Option, Path, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";

/**
 * local-agent-state.ts -- what a machine keeps of its local agents between runs (`local-agents.json` in its state): the device id each account registered under, the launches no exit has settled yet, how each agent has run there, and where each agent's saved state stands; read and written alike by the follower (`compose-local-agents.ts`) and by This Mac's turn-on (`compose-this-mac-host.ts`). Beside it, which agents' folders and VMs this machine made (`owned-agents`).
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
 * The folder in the machine's state holding an empty file for each agent
 * whose folder and VM this machine made, named for the agent, from its
 * first launch or files until a discard removes its folder. The folder and
 * the VM stand in the user's own `~/.luke/agents` and smolvm store, which
 * every Luke install for that user shares, so `luke-host uninstall` reads
 * this to remove its own and no other's (`apps/host/scripts/luke-host.sh`),
 * and the follower to delete the VMs its own runs left standing as its gate
 * opens (`ownedAgents`).
 */
const OWNED_FOLDER = "owned-agents";

/**
 * A sealed bundle of an agent's state this device has not yet had
 * committed, kept in its state (`local-agent-saves.ts`) and tried again on
 * the beat: the launch line of the turn it holds the end of, the generation
 * its save starts from, none where the agent had none, the commit its work
 * applies to, the bundle's size and SHA-256, and the last path the service
 * granted for it, when (epoch milliseconds), and whether its upload landed
 * there. No URL, key, or byte of the bundle.
 */
const PendingSaveSchema = Schema.Struct({
  lineId: Schema.String,
  fromGeneration: Schema.NullOr(Schema.Int),
  baseCommit: Schema.NullOr(Schema.String),
  bytes: Schema.Int,
  sha256: Schema.String,
  granted: Schema.optionalKey(
    Schema.Struct({ path: Schema.String, at: Schema.Int, uploaded: Schema.Boolean }),
  ),
});

export type PendingSave = typeof PendingSaveSchema.Type;

/**
 * Where one agent's saved state stands on this device, under the account
 * it was saved for: the generation of it Luke's store holds that the
 * agent's folder stands at, the last this device committed or its newest
 * launch named, absent where it has none; whether its folder holds state
 * that neither the store nor a bundle waiting holds (`unsaved`), its last
 * turn's save having failed or never run, and, where the save was refused
 * for a reason in the agent's own folder that trying again will not clear,
 * why, in plain words of at most `UNSAVED_WHY_CHARACTERS`, which the
 * agent's next launch reads and clears; its bundle waiting to be
 * committed, where one is; and the generation a restore into its folder
 * began from and has not finished (`restoring`), while which the folder
 * holds none of the agent's work as it stands, so a launch restores it
 * again rather than going on from it, and no turn's end saves it. An
 * agent's folder is saved only where its record names neither `unsaved`
 * nor `pending`: a sweep keeps the folder of one that is unsaved or has a
 * bundle waiting, and of one with no record, which never saved.
 */
const AgentSaveSchema = Schema.Struct({
  userId: Schema.String,
  generation: Schema.optionalKey(Schema.Int),
  unsaved: Schema.optionalKey(Schema.Struct({ why: Schema.optionalKey(Schema.String) })),
  pending: Schema.optionalKey(PendingSaveSchema),
  restoring: Schema.optionalKey(Schema.Int),
});

export type AgentSave = typeof AgentSaveSchema.Type;

/** The most characters of why an agent's save failed that its record keeps. */
export const UNSAVED_WHY_CHARACTERS = 300;

/**
 * The state: the device id each account registered under, the launches
 * whose runners this device started and the service has not yet taken a
 * settle of, each with the agent whose VM it ran in, absent from a launch
 * kept before it, on a device whose agents may have run directly on it
 * (`formerlyDirect`), how each agent has run here, in a VM or directly,
 * and where each agent's saved state stands, by agent id; each of the last
 * two absent from a state file from before it.
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
  saves: Schema.optionalKey(Schema.Record(Schema.String, AgentSaveSchema)),
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

/** The agent given kept as one whose folder and VM this machine made; a write that fails is let go, since the record only serves an uninstall. */
export const keepOwnedAgent = (stateRoot: string, agentId: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const owned = path.join(stateRoot, OWNED_FOLDER);
    yield* fileSystem.makeDirectory(owned, { recursive: true, mode: 0o700 });
    yield* fileSystem.writeFileString(path.join(owned, agentId), "");
  }).pipe(Effect.ignore);

/** The agents kept as ones whose folder and VM this machine made, by id; none where the record cannot be read. */
export const ownedAgents = (stateRoot: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* fileSystem.readDirectory(path.join(stateRoot, OWNED_FOLDER));
  }).pipe(Effect.orElseSucceed((): readonly string[] => []));

/** The agent given no longer kept as one whose folder and VM this machine made, once its folder is gone. */
export const forgetOwnedAgent = (stateRoot: string, agentId: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.remove(path.join(stateRoot, OWNED_FOLDER, agentId), { force: true });
  }).pipe(Effect.ignore);
