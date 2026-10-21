/**
 * chapters-function.ts -- the deployed function a pull request's chapters are generated in, its route and how long it may run, on their own so the function table reads them without the generator.
 *
 * A value import of the generator from `function-durations` would carry the
 * model's SDK into every function's bundle, so the bound lives in this leaf,
 * and `chapters-function.test.ts` holds it between the generation's own
 * deadline (`CHAPTERS_BOUNDS.TIMEOUT`) and the store's stale bound
 * (`CHAPTER_GENERATION_STALE_MS`): a Generate is never cut off while the
 * model may still answer, and never outlives the claim it holds, which
 * another Generate would then take over while it still ran.
 */

/** The route a read and a Generate of a pull request's chapters answer through, as its route file's path spells it under `/api/`. */
export const PULL_REQUEST_CHAPTERS_ROUTE_PATH = "/api/agents/chapters";

export const PULL_REQUEST_CHAPTERS_FUNCTION = {
  /** The function duration the chapters' bundle declares: the generation's three minutes, and a minute for GitHub and the store around it. */
  MAX_DURATION_SECONDS: 240,
} as const;
