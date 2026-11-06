import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

let narrowed: string | undefined;

let placeWorkspace: string | undefined;

function narrowedNow(): string | undefined {
  return narrowed;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function moveTo(next: string | undefined): void {
  if (next === narrowed) return;
  narrowed = next;
  for (const listener of listeners) listener();
}

export function listInboxWorkspace(workspaceId: string): void {
  if (placeWorkspace === workspaceId) return;
  const was = placeWorkspace;
  placeWorkspace = workspaceId;
  if (was !== undefined) moveTo(undefined);
}

export function chooseInboxTask(taskId: string): void {
  moveTo(taskId);
}

export function leaveInboxTask(): void {
  moveTo(undefined);
}

export function openTaskThread(itemTaskId: string | undefined): void {
  if (narrowed !== undefined && narrowed !== itemTaskId) leaveInboxTask();
}

export function standInboxTask(taskId: string | undefined): void {
  moveTo(taskId);
}

export function useInboxTask(): string | undefined {
  return useSyncExternalStore(subscribe, narrowedNow, narrowedNow);
}
