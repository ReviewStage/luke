export type { DeletionOutcome } from "./archives.js";
export type { HistorySearchHit } from "./history-table.js";
export type { MaintenanceReport } from "./maintenance-run.js";
export type { FlushState } from "./memory-flush-table.js";
export type {
  EmbeddingWrite,
  MemoryApplyReport,
  MemoryIndexStatus,
  MemoryScanPlan,
  MemorySearchOutcome,
  MemorySearchQuery,
} from "./memory-index-table.js";
export type { NotebookEntry, NotebookMutation } from "./notebook-table.js";
export { type StoreClient, storeClient } from "./store-client.js";
export type { StorePort } from "./wire.js";
export { serveStore } from "./worker-host.js";
