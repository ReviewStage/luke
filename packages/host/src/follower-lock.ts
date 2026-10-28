import { Clock, Duration, Effect, Option, Path, Result, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";

/**
 * follower-lock.ts -- the one follower a machine runs at a time: a lease in the state root that whoever follows the machine's local agents holds, renewed while it follows, and that every other follower is refused by.
 *
 * Two followers on one machine, the desktop app's own and its `luke-host`
 * login item, share the state root's `local-agents.json` and would each
 * claim lines and write that file over the other's, so a follower takes
 * this lease before it registers, holds it for as long as its gate stands
 * open, and gives it back as its follow ends. The lease names its holder,
 * an id each follower mints once, and when it was last renewed, on the
 * follower's own clock; a lease not renewed for `LEASE` was left by a
 * follower that died with its process, and is taken over. A lease is
 * written beside its file and moved over it, then read back, so of two
 * followers that both found it free only the one whose write stands takes
 * it.
 */

/** The lease's file, in the state root. */
const LOCK_FILE = "local-agents.lock";

/** How long a lease stands unrenewed before another follower may take it, well past the renewal every follower makes while it follows. */
const LEASE = Duration.seconds(30);

const LeaseSchema = Schema.Struct({ holder: Schema.String, renewedAt: Schema.Number });

type Lease = typeof LeaseSchema.Type;

const decodeLease = Schema.decodeUnknownOption(Schema.fromJsonString(LeaseSchema));
const encodeLease = Schema.encodeSync(Schema.fromJsonString(LeaseSchema));

/** The lease as it stands in the state root; none where no follower holds one, or it does not read. */
const readLease = Effect.fnUntraced(function* (stateRoot: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const text = yield* fileSystem
    .readFileString(path.join(stateRoot, LOCK_FILE))
    .pipe(Effect.orElseSucceed(() => ""));
  return decodeLease(text);
});

/** Whether the lease stands for its holder now: renewed within `LEASE`. */
const standing = (lease: Lease, now: number) => now - lease.renewedAt < Duration.toMillis(LEASE);

/** Whether a follower other than `holder` holds the machine's lease now; with no holder named, whether any does. */
export const followerLockHeld = Effect.fnUntraced(function* (stateRoot: string, holder?: string) {
  const lease = yield* readLease(stateRoot);
  const now = yield* Clock.currentTimeMillis;
  return Option.isSome(lease) && lease.value.holder !== holder && standing(lease.value, now);
});

/** The lease written for `holder`, renewed now, beside its file and moved over it. */
const writeLease = Effect.fnUntraced(function* (stateRoot: string, holder: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(stateRoot, LOCK_FILE);
  const written = `${file}.${holder}`;
  const renewedAt = yield* Clock.currentTimeMillis;
  yield* fileSystem.makeDirectory(stateRoot, { recursive: true });
  yield* fileSystem.writeFileString(written, encodeLease({ holder, renewedAt }));
  yield* fileSystem.rename(written, file);
});

/**
 * The machine's lease taken for `holder`, where no other follower holds it:
 * whether `holder` holds it now. One that cannot be written or read back is
 * not held, so a state root that cannot be written follows nothing.
 */
export const takeFollowerLock = Effect.fnUntraced(function* (stateRoot: string, holder: string) {
  if (yield* followerLockHeld(stateRoot, holder)) return false;
  if (Result.isFailure(yield* Effect.result(writeLease(stateRoot, holder)))) return false;
  // Note that the lease is read back, since another follower that found it free at the same moment may have moved its own over it.
  const lease = yield* readLease(stateRoot);
  return Option.isSome(lease) && lease.value.holder === holder;
});

/** The lease renewed for `holder` while it still holds it; whether it does. */
export const renewFollowerLock = Effect.fnUntraced(function* (stateRoot: string, holder: string) {
  const lease = yield* readLease(stateRoot);
  if (Option.isNone(lease) || lease.value.holder !== holder) return false;
  return Result.isSuccess(yield* Effect.result(writeLease(stateRoot, holder)));
});

/** The lease given back where `holder` still holds it, so the next follower takes it at once. */
export const releaseFollowerLock = Effect.fnUntraced(function* (stateRoot: string, holder: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lease = yield* readLease(stateRoot);
  if (Option.isNone(lease) || lease.value.holder !== holder) return;
  yield* fileSystem.remove(path.join(stateRoot, LOCK_FILE), { force: true }).pipe(Effect.ignore);
});
