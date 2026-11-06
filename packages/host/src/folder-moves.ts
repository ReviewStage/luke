import { Effect, Path, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";

/**
 * folder-moves.ts -- a folder followed as it changes, by the file system's own watch: a pulse each time an entry in it is made, written, moved, or removed, and each time the folder itself comes or goes.
 *
 * A folder that is not there yet is waited for on the watch of the nearest
 * folder above it that is, so it is followed from the moment it is made, and
 * one that is removed is waited for again the same way; nothing reads it on a
 * schedule. Note that the watch is never recursive, and is laid on the folder
 * rather than a file in it, because a file written beside itself and moved
 * over itself, as the host's record is, is a new file that a watch on the
 * old one never hears of. A watch the system refuses ends the pulses of the
 * folder it was laid on, rather than being laid again on a timer.
 */

/** Whether the folder stands, read as missing where it cannot be read. */
const standing = (fileSystem: FileSystem.FileSystem, folder: string) =>
  fileSystem.exists(folder).pipe(Effect.orElseSucceed(() => false));

/** The pulses of the folder given, from the moment it stands, for as long as the stream is read. */
export const folderMoves = (
  folder: string,
): Stream.Stream<void, never, FileSystem.FileSystem | Path.Path> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const again = Stream.suspend(() => folderMoves(folder));
      if (!(yield* standing(fileSystem, folder))) {
        const parent = path.dirname(folder);
        if (parent === folder) return Stream.never;
        // Note that each move of the parent asks whether the folder now stands, and the one that finds it is the folder's first pulse.
        return folderMoves(parent).pipe(
          Stream.mapEffect(() => standing(fileSystem, folder)),
          Stream.takeUntil((stands) => stands),
          Stream.filter((stands) => stands),
          Stream.as(undefined),
          Stream.concat(again),
        );
      }
      // Note that a move that finds the folder gone is its last pulse here, and it is waited for again from above.
      return fileSystem.watch(folder).pipe(
        Stream.mapEffect(() => standing(fileSystem, folder)),
        Stream.takeUntil((stands) => !stands),
        Stream.as(undefined),
        Stream.ignore,
        Stream.concat(
          Stream.unwrap(
            Effect.map(standing(fileSystem, folder), (stands) => (stands ? Stream.empty : again)),
          ),
        ),
      );
    }),
  );
