/**
 * The door through which server-side code reaches `@sidecar/live` by name,
 * kept apart from `core.ts` because several of this package's names (the
 * proactive speech turns, `sessionInstructions`) are also exported by
 * `@sidecar/realtime` behind that door, and a star export from both would
 * collide. `core.ts` still carries the package's side-effect door for the
 * compiler; this one is the same relative path, for the names.
 */
export * from "../../../packages/live/src/index.js";
