import { Effect } from "effect";
import type { Files } from "../../src/services/files";
import { FilesLive } from "../../src/services/files";

const filesLayer = FilesLive;

export function runTranscriptEffect<A>(effect: Effect.Effect<A, unknown, Files>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(filesLayer)));
}
