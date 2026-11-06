import type { PagePlace } from "@repo/features/page-wire";
import type { TaskFileRequest, taskFileRefusalSchema } from "@repo/features/task-wire";
import {
  TASK_CALL_FAILURE,
  type TasksFileAnswer,
  type TasksPageSourceAnswer,
  type TasksTreeAnswer,
} from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { queryOptions, skipToken } from "@tanstack/react-query";
import { askAct } from "../act.js";
import { QUERY_ROOT } from "../query-keys.js";
import type { FileReadPlace } from "./use-side-panel.js";

export type RefusedAnswer =
  | typeof taskFileRefusalSchema.Type
  | { readonly failure: typeof TASK_CALL_FAILURE.UNANSWERED };

export class ReadRefused extends Error {
  readonly answer: RefusedAnswer;

  constructor(answer: RefusedAnswer) {
    super("The service did not carry this read.");
    this.answer = answer;
  }
}

function landedFile(answer: TasksFileAnswer) {
  if ("refusal" in answer || "failure" in answer) throw new ReadRefused(answer);
  return answer;
}

function landedTree(answer: TasksTreeAnswer) {
  if ("refusal" in answer || "failure" in answer) throw new ReadRefused(answer);
  return answer;
}

function landedSource(answer: TasksPageSourceAnswer) {
  if ("failure" in answer) throw new ReadRefused(answer);
  return answer;
}

export function refusedAnswer(error: unknown): RefusedAnswer {
  return error instanceof ReadRefused ? error.answer : { failure: TASK_CALL_FAILURE.UNANSWERED };
}

function placeIds(
  place: FileReadPlace | undefined,
): readonly [string | null, string | null, string | null] {
  if (place === undefined) return [null, null, null];
  return "taskId" in place
    ? [place.taskId, null, null]
    : [null, place.workspaceId, place.repository];
}

export function taskFileQueryOptions(place: FileReadPlace | undefined, request: TaskFileRequest) {
  const { path, firstLine, lastLine, raw = false, ref } = request;
  return queryOptions({
    queryKey: [
      QUERY_ROOT.TASK_FILE,
      ...placeIds(place),
      path,
      firstLine,
      lastLine,
      raw,
      ref ?? null,
    ],
    queryFn:
      place === undefined
        ? skipToken
        : () => askAct(ACT_KIND.TASKS_FILE, { ...place, ...request }).then(landedFile),
    staleTime: ref === undefined ? 0 : Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function taskTreeKey(place: FileReadPlace) {
  return [QUERY_ROOT.TASK_TREE, ...placeIds(place)] as const;
}

export function taskTreeQueryOptions(
  place: FileReadPlace | undefined,
  path: string,
  recursive = false,
) {
  return queryOptions({
    queryKey: [QUERY_ROOT.TASK_TREE, ...placeIds(place), path, recursive],
    queryFn:
      place === undefined
        ? skipToken
        : () =>
            askAct(ACT_KIND.TASKS_TREE, {
              ...("taskId" in place ? { planId: place.taskId } : place),
              path,
              ...(recursive ? { recursive } : undefined),
            }).then(landedTree),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function pageSourcesKey(place: PagePlace, pageId: string) {
  return [
    QUERY_ROOT.PAGE_SOURCE,
    "taskId" in place ? place.taskId : null,
    "agentId" in place ? place.agentId : null,
    pageId,
  ] as const;
}

export function pageSourceQueryOptions(place: PagePlace, pageId: string, version: number) {
  return queryOptions({
    queryKey: [...pageSourcesKey(place, pageId), version],
    queryFn: () =>
      askAct(ACT_KIND.TASKS_PAGE_SOURCE, { ...place, pageId, version }).then(landedSource),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    retryOnMount: false,
  });
}
