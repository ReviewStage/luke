import { notebookMemoryProvider } from "@sidecar/memory";
import { recentDailyNotesEffect } from "@sidecar/runtime/effect";
import type { MemoryDefinition, MemoryScope, SessionKey } from "@sidecar/runtime/vocabulary";
import { Effect } from "effect";
import type { MemoryMaintenance } from "./memory-maintenance.js";

export interface MemoryDefinitionDependencies {
  /** Whose notebook this is; on this Mac the one agent's workspace is the one account's. */
  scope: MemoryScope;
  /** The housekeeping captures, for the conversations whose memory is kept. */
  maintenance: MemoryMaintenance;
  workspaceDirectory: () => string;
  now: () => number;
}

/**
 * The notebook as the memory provider every conversation's local brain is
 * handed: the recent dated notes for recall, and a capture only for the
 * conversations maintenance says keep their memory. This Mac holds no
 * notebook index and no remembered facts any more — both stood in the
 * SQLite store the desktop no longer opens — so the provider is handed no
 * search access and no facts, and its two reads refuse by their own word.
 * The remembered facts and their index are the hosted brain's.
 */
export function wireMemoryDefinitions(dependencies: MemoryDefinitionDependencies) {
  return (sessionKey: SessionKey): MemoryDefinition => {
    const capture = dependencies.maintenance.captureFor(sessionKey);
    return {
      scope: dependencies.scope,
      provider: notebookMemoryProvider({
        scope: dependencies.scope,
        access: undefined,
        facts: () => [],
        recentNotes: () =>
          recentDailyNotesEffect(dependencies.workspaceDirectory(), dependencies.now()).pipe(
            Effect.orDie,
          ),
        ...(capture ? { capture } : undefined),
      }),
    };
  };
}
