import { useAtomValue } from "@effect/atom-react";
import type { Failure } from "@repo/features/failure-remedy";
import { Equal } from "effect";
import { Atom } from "effect/reactivity";
import { heldLines } from "../composer-drafts.js";
import type { SentLine } from "./agent-model.js";

export interface FailedLine {
  readonly agentId: string;
  readonly taskId: string | null;
  readonly line: SentLine;
  readonly note: Failure & { readonly cause?: unknown };
}

export const failedLinesAtom = heldLines<FailedLine>();

const failedAgentsAtom = Atom.withEquality(
  Atom.make((get): readonly string[] => [
    ...new Set(get(failedLinesAtom).map((failed) => failed.agentId)),
  ]),
  Equal.equals,
);

const failedTasksAtom = Atom.withEquality(
  Atom.make((get): readonly (string | null)[] => [
    ...new Set(get(failedLinesAtom).map((failed) => failed.taskId)),
  ]),
  Equal.equals,
);

export function failedLinesOf(all: readonly FailedLine[], agentId: string): readonly FailedLine[] {
  return all.filter((failed) => failed.agentId === agentId);
}

export function useFailedAgents(): readonly string[] {
  return useAtomValue(failedAgentsAtom);
}

export function useTaskSendFailed(taskId: string): boolean {
  return useAtomValue(failedTasksAtom, (tasks) => tasks.includes(taskId));
}
