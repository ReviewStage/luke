import { HOSTED_SERVICE_PATH, VOICE_SERVICE_PATH } from "@sidecar/hosted";
import { OBSERVATION_TICK, OBSERVATION_TICK_PATH } from "./hosted/observation-tick.js";

/**
 * A WebSocket connection to a Vercel Function lives as long as the function
 * may run, so the two voice functions carry the platform's longest generally
 * available duration.
 */
export const VOICE_FUNCTION_MAX_DURATION_SECONDS = 800;

const BRAIN_INFERENCE_MAX_DURATION_SECONDS = 120;
const BRAIN_EMBED_MAX_DURATION_SECONDS = 60;

/**
 * The functions that may run longer than the platform's default, by the path
 * the client calls. `vercel.json`'s `functions` block names each by its
 * committed `api/` entrypoint, and the test beside this table holds the two in
 * step; the bundle script writes the same durations as `export const config`.
 */
export const FUNCTION_MAX_DURATION_SECONDS: ReadonlyMap<string, number> = new Map([
  [HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2, BRAIN_INFERENCE_MAX_DURATION_SECONDS],
  [HOSTED_SERVICE_PATH.BRAIN_COUNT_TOKENS, BRAIN_INFERENCE_MAX_DURATION_SECONDS],
  [HOSTED_SERVICE_PATH.BRAIN_EMBED, BRAIN_EMBED_MAX_DURATION_SECONDS],
  [OBSERVATION_TICK_PATH, OBSERVATION_TICK.MAX_DURATION_SECONDS],
  [VOICE_SERVICE_PATH.SESSIONS, VOICE_FUNCTION_MAX_DURATION_SECONDS],
  [VOICE_SERVICE_PATH.INTRODUCTION, VOICE_FUNCTION_MAX_DURATION_SECONDS],
]);

/** The path a client calls for the route bundled from `server/routes/<relative>.ts`. */
export function functionPath(routeRelativePath: string): string {
  return `/api/${routeRelativePath.replace(/\.ts$/, "")}`;
}

/** The literal the Node builder's static config reader takes a function's duration from. */
export function functionConfigSource(maxDurationSeconds: number): string {
  return `export const config = { maxDuration: ${maxDurationSeconds} };\n`;
}
