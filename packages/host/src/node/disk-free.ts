import { statfs } from "node:fs/promises";
import { Effect, Option } from "effect";

/**
 * disk-free.ts -- how much of a disk stands free, read off a folder on it (`LocalAgentPlatformSeam.diskFree`), which a sweep reads before it waits out a saved agent's warm window.
 */

/** The share of the disk holding the folder given that stands free to the device's own user, from 0 to 1; none where it could not be read. */
export const diskFree = (folder: string) =>
  Effect.tryPromise(() => statfs(folder)).pipe(
    Effect.map((disk) =>
      disk.blocks > 0 ? Option.some(disk.bavail / disk.blocks) : Option.none<number>(),
    ),
    Effect.orElseSucceed(() => Option.none<number>()),
  );
