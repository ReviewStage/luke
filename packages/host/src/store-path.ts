import path from "node:path";
import { type AgentId, DEFAULT_AGENT_ID } from "@sidecar/runtime/vocabulary";

/**
 * Where the runtime store lives and where its worker's code is found, as pure
 * path decisions. The agent's directory sits under Luke's application data,
 * one per agent, holding the database. The worker script is built beside the main bundle;
 * inside a packaged app it is unpacked from the archive, because a worker
 * thread is started from a real file path rather than through the archive's
 * patched file system.
 */

export const AGENTS_DIRECTORY = "agents";
export const RUNTIME_STORE_WORKER_FILE = "runtime-store-worker.js";
const ASAR_ARCHIVE = "app.asar";
const ASAR_UNPACKED = "app.asar.unpacked";

export function agentRootPath(userData: string, agentId: AgentId = DEFAULT_AGENT_ID): string {
  return path.join(userData, AGENTS_DIRECTORY, agentId);
}

export function runtimeStoreWorkerPath(bundleDirectory: string): string {
  const beside = path.join(bundleDirectory, RUNTIME_STORE_WORKER_FILE);
  const parts = beside.split(path.sep);
  const archive = parts.lastIndexOf(ASAR_ARCHIVE);
  if (archive === -1) return beside;
  return [...parts.slice(0, archive), ASAR_UNPACKED, ...parts.slice(archive + 1)].join(path.sep);
}
