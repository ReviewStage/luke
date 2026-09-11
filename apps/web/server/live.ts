/**
 * The door through which server-side code reaches `@sidecar/live` by name,
 * kept apart from `core.ts` so the voice functions' vocabulary stands on its
 * own door rather than among the hosted tier's. `core.ts` still carries the
 * package's side-effect door for the compiler; this one is the same relative
 * path, for the names.
 */
export * from "../../../packages/live/src/index.js";
