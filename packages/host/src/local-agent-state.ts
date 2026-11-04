import { Effect, Option, Path, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";

/**
 * local-agent-state.ts -- what a machine keeps of its local agents between runs (`local-agents.json` in its state): the launches no exit has settled yet, the agents whose folders a discard kept, and since when, and when each agent was last used there; read and written by the follower (`compose-local-agents.ts`). Beside it, which agents' folders this machine made (`owned-agents`).
 *
 * The follower holds the state while it follows and writes it whole. A file that
 * cannot be read or decoded reads as nothing kept, and a key it does not
 * know, as one an earlier build kept, is read past and left out of the next
 * write. A write lands beside the file and is moved over it, so a write cut
 * off leaves the last whole one.
 */

/** The file in the machine's state the launches running are kept in. */
const STATE_FILE = "local-agents.json";

/**
 * The folder in the machine's state holding an empty file for each agent
 * whose folder this machine made, named for the agent, from its first
 * launch or files, until a discard removes its folder. The folder stands in
 * the user's own `~/.vespin/agents`, so `vespin-host uninstall` reads this to
 * remove its own and no other's (`apps/host/scripts/vespin-host.sh`), and the
 * follower to pass over its own alone (`ownedAgents`).
 */
const OWNED_FOLDER = "owned-agents";

/**
 * The state: the launches whose runners this device started and the
 * service has not yet taken a settle of, each with the agent it ran for,
 * absent from a launch kept before it, the agents the service no longer
 * lists whose folders a discard kept for work in them, each with when it
 * was first kept (epoch milliseconds), which the follower never checks
 * again while they stand and lets go of whole a week after, and when each
 * agent whose folder stands was last used here (epoch milliseconds): its
 * last launch, turn's end, or files written, which a pass reads to clear
 * the folders of agents long unused; each of the last two absent from a
 * state file from before it.
 */
const LocalAgentStateSchema = Schema.Struct({
  launches: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      agentId: Schema.optionalKey(Schema.String),
    }),
  ),
  kept: Schema.optionalKey(Schema.Record(Schema.String, Schema.Int)),
  lastUsed: Schema.optionalKey(Schema.Record(Schema.String, Schema.Int)),
});

export type LocalAgentState = typeof LocalAgentStateSchema.Type;

const NO_STATE: LocalAgentState = { launches: [] };

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
