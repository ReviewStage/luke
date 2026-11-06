import { Effect, Path } from "effect";
import * as FileSystem from "effect/FileSystem";

const OWNED_FOLDER = "owned-agents";

export const keepOwnedAgent = (stateRoot: string, agentId: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const owned = path.join(stateRoot, OWNED_FOLDER);
    yield* fileSystem.makeDirectory(owned, { recursive: true, mode: 0o700 });
    yield* fileSystem.writeFileString(path.join(owned, agentId), "");
  }).pipe(Effect.ignore);

export const ownedAgents = (stateRoot: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* fileSystem.readDirectory(path.join(stateRoot, OWNED_FOLDER));
  }).pipe(Effect.orElseSucceed((): readonly string[] => []));

export const forgetOwnedAgents = (stateRoot: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.remove(path.join(stateRoot, OWNED_FOLDER), { recursive: true, force: true });
  });

export const forgetOwnedAgent = (stateRoot: string, agentId: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.remove(path.join(stateRoot, OWNED_FOLDER, agentId), { force: true });
  }).pipe(Effect.ignore);
