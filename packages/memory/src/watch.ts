import { type FSWatcher, watch } from "node:fs";
import { MEMORY_SEARCH_DEFAULTS } from "./defaults.js";

/**
 * Watches the notebook's directory and asks for one reconcile per burst of
 * changes, debounced at the pinned 1,500 ms. The watcher decides nothing
 * about what changed: the reconcile it triggers reads every file again and
 * compares hashes, so a missed event costs a later pass and never a wrong
 * index, and an index can always be rebuilt from the files alone.
 */
export interface MemoryWatcher {
  close(): void;
}

export interface MemoryWatchOptions {
  readonly directory: string;
  readonly onChange: () => void;
  readonly debounceMs?: number;
  readonly report?: (message: string) => void;
}

export function watchMemoryFiles(options: MemoryWatchOptions): MemoryWatcher | undefined {
  const debounceMs = options.debounceMs ?? MEMORY_SEARCH_DEFAULTS.WATCH_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcher: FSWatcher;
  try {
    watcher = watch(options.directory, { recursive: true, persistent: false }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        options.onChange();
      }, debounceMs);
    });
  } catch (error) {
    options.report?.(
      `Memory files are not being watched: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
  watcher.on("error", (error) => options.report?.(`Memory watcher stopped: ${error.message}`));
  return {
    close: () => {
      if (timer) clearTimeout(timer);
      watcher.close();
    },
  };
}
