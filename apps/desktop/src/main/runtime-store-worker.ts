/**
 * The runtime store's worker thread, bundled on its own beside the main
 * bundle. Every synchronous SQLite call happens here; the main thread only
 * posts requests to it.
 */
import "@sidecar/runtime-store/worker";
