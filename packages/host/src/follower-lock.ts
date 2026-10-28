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
 * follower that died with its process, and is taken over.
 *
 * Taking the lease is one exclusive step the file system decides: the lease
 * is written whole beside its file and hard-linked into place, which fails
 * where a lease already stands, so of two followers that both found it free
 * only one takes it. A stale lease is moved aside first, which likewise only
 * one follower can do. Renewing rewrites the holder's own lease, and a
 * holder that finds the lease no longer its own has lost it (`renew`
 * answers false), which its follow stops on.
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

/** The lease for `holder`, renewed now, written whole in a file of its own beside the lease's; that file's path. */
const writtenLease = Effect.fnUntraced(function* (stateRoot: string, holder: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const written = path.join(stateRoot, `${LOCK_FILE}.${holder}`);
  const renewedAt = yield* Clock.currentTimeMillis;
  yield* fileSystem.makeDirectory(stateRoot, { recursive: true });
  yield* fileSystem.writeFileString(written, encodeLease({ holder, renewedAt }));
  return written;
});

/** The lease written for `holder` linked into place, which fails where any lease already stands. */
const linkedLease = Effect.fnUntraced(function* (stateRoot: string, holder: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const written = yield* writtenLease(stateRoot, holder);
  const linked = yield* Effect.result(fileSystem.link(written, path.join(stateRoot, LOCK_FILE)));
  yield* Effect.ignore(fileSystem.remove(written, { force: true }));
  return Result.isSuccess(linked);
});

/**
 * The machine's lease taken for `holder`, where no other follower holds it:
 * whether `holder` holds it now. A stale or unreadable lease is moved aside
 * first, and one that cannot be written is not held, so a state root that
 * cannot be written follows nothing.
 */
export const takeFollowerLock = Effect.fnUntraced(function* (stateRoot: string, holder: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(stateRoot, LOCK_FILE);
  const lease = yield* readLease(stateRoot);
  const now = yield* Clock.currentTimeMillis;
  if (Option.isSome(lease) && standing(lease.value, now)) return lease.value.holder === holder;
  if (yield* Effect.orElseSucceed(fileSystem.exists(file), () => false)) {
    // Note that only one follower can move the stale lease aside, and the other finds it gone and takes nothing this turn.
    const aside = `${file}.stale.${holder}`;
    if (Result.isFailure(yield* Effect.result(fileSystem.rename(file, aside)))) return false;
    yield* Effect.ignore(fileSystem.remove(aside, { force: true }));
  }
  return yield* Effect.orElseSucceed(linkedLease(stateRoot, holder), () => false);
});

/** The lease renewed for `holder` while it still holds it; whether it does, false once another follower took it. */
export const renewFollowerLock = Effect.fnUntraced(function* (stateRoot: string, holder: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lease = yield* readLease(stateRoot);
  if (Option.isNone(lease) || lease.value.holder !== holder) return false;
  const renewed = Effect.flatMap(writtenLease(stateRoot, holder), (written) =>
    fileSystem.rename(written, path.join(stateRoot, LOCK_FILE)),
  );
  return Result.isSuccess(yield* Effect.result(renewed));
});

/** The lease given back where `holder` still holds it, so the next follower takes it at once. */
export const releaseFollowerLock = Effect.fnUntraced(function* (stateRoot: string, holder: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lease = yield* readLease(stateRoot);
  if (Option.isNone(lease) || lease.value.holder !== holder) return;
  yield* fileSystem.remove(path.join(stateRoot, LOCK_FILE), { force: true }).pipe(Effect.ignore);
});
