/**
 * highlight-worker-script.ts -- the text of the worker a list's files are highlighted in, which each build answers this module with; run as written, as under a test, there is none.
 *
 * Both builds bundle Pierre's worker as one classic script and answer this
 * module with its text (`HIGHLIGHT_WORKER_SCRIPT` in `scripts/build-table.mjs`).
 * The diff bundle reaches it through a dynamic `import()` alone
 * (`./index.ts`'s `listHighlighting`), so a splitting bundler makes it a
 * chunk of its own that is fetched once a pool starts, never with the
 * diff bundle itself.
 */

/** The worker's script, set by the build; none where nothing built the bundle. */
export const HIGHLIGHT_WORKER_SCRIPT: string | undefined = undefined;
