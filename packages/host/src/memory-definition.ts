import type { RememberedFact } from "@sidecar/actions";
import { notebookMemoryProvider } from "@sidecar/memory";
import { recentDailyNotes } from "@sidecar/runtime";
import type { MemoryDefinition, MemoryScope, SessionKey } from "@sidecar/runtime/vocabulary";
import type { HostActionPerformer } from "./brain/action-performer.js";
import type { MemoryMaintenance } from "./memory-maintenance.js";
import type { MemoryWiring } from "./notebook-memory.js";

export interface MemoryDefinitionDependencies {
  /** Whose notebook this is; on this Mac the one agent's workspace is the one account's. */
  scope: MemoryScope;
  /** The notebook's index, for each conversation's search and read. */
  index: MemoryWiring;
  /** The housekeeping captures, for the conversations whose memory is kept. */
  maintenance: MemoryMaintenance;
  /** The notebook's entries as they stand, read fresh for every recall. */
  facts: () => readonly RememberedFact[];
  workspaceDirectory: () => string;
  now: () => number;
}

/**
 * The notebook as the memory provider every conversation's brain is handed:
 * the index's search and read bound to the conversation, the facts and the
 * recent notes for recall, the two writes carried through the same action
 * performer every other action runs through — `admit()` and the store's
 * worker included — and a capture only for the conversations maintenance
 * says keep their memory.
 */
export function wireMemoryDefinitions(dependencies: MemoryDefinitionDependencies) {
  return (sessionKey: SessionKey, actions: HostActionPerformer): MemoryDefinition => {
    const capture = dependencies.maintenance.captureFor(sessionKey);
    return {
      scope: dependencies.scope,
      provider: notebookMemoryProvider({
        scope: dependencies.scope,
        access: dependencies.index.accessFor(sessionKey),
        facts: dependencies.facts,
        recentNotes: () => recentDailyNotes(dependencies.workspaceDirectory(), dependencies.now()),
        // A notebook write's turn is the run it was called in, in the conversation whose memory this is.
        perform: (call, context) =>
          actions.perform(call, { ...context, conversationId: sessionKey, turnId: context.runId }),
        ...(capture ? { capture } : undefined),
      }),
    };
  };
}
