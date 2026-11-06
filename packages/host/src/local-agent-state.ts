import { Effect, Path } from "effect";
import * as FileSystem from "effect/FileSystem";

/**
 * local-agent-state.ts -- what a machine keeps of its local agents between runs: which agents' folders it made (`owned-agents` in its state), kept and read by the follower (`compose-local-agents.ts`).
 */

/**
 * The folder in the machine's state holding an empty file for each agent
 * whose folder this machine made, named for the agent, from its first
 * launch or files, until a discard removes its folder. The folder stands in
 * the user's own `~/.vespin/agents`, so `vespin-host uninstall` reads this to
 * remove its own and no other's (`apps/host/scripts/vespin-host.sh`), and the
 * follower to let go of its own turns alone as the gate opens (`ownedAgents`).
 */
const OWNED_FOLDER = "owned-agents";

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

/** No agent kept as one whose folder this machine made, so an uninstall after it leaves every agent's folder as it stands. */
export const forgetOwnedAgents = (stateRoot: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.remove(path.join(stateRoot, OWNED_FOLDER), { recursive: true, force: true });
  });

/** The agent given no longer kept as one whose folder this machine made, once its folder is gone. */
export const forgetOwnedAgent = (stateRoot: string, agentId: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.remove(path.join(stateRoot, OWNED_FOLDER, agentId), { force: true });
  }).pipe(Effect.ignore);
