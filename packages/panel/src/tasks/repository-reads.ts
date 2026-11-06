/**
 * repository-reads.ts -- the reads of a repository's files, folders, and a page's source, as a File tab, the file tree, an inbox item's code, ⌘K, and a page's tab ask them.
 *
 * A file or a folder is read through a task, or through a workspace's
 * installation and the repository where it stands for no task
 * (`FileReadPlace`). Each read is a `queryOptions` factory keyed by its root
 * and the ids it reads by, its `queryFn` the act, answered at once where it
 * fails and never tried again on its own, so a failed read shows as one and
 * waits for its Retry. Where the answer names its refusal, the refusal is the
 * answer, as the surface draws it.
 */

import type { PagePlace } from "@repo/features/page-wire";
import type { TaskFileRequest } from "@repo/features/task-wire";
import { ACT_KIND } from "@repo/host/acts";
import { queryOptions, skipToken } from "@tanstack/react-query";
import { askAct } from "../act.js";
import { QUERY_ROOT } from "../query-keys.js";
import type { FileReadPlace } from "./use-side-panel.js";

/** The ids a place reads by, each an element of the key: the task, else the workspace and the repository; none for no place. */
function placeIds(
  place: FileReadPlace | undefined,
): readonly [string | null, string | null, string | null] {
  if (place === undefined) return [null, null, null];
  return "taskId" in place
    ? [place.taskId, null, null]
    : [null, place.workspaceId, place.repository];
}

/**
 * One window of a file's lines, or, raw, its whole text, at the ref named or
 * the default branch's head; nothing asked where no place reads it. Lines at
 * a commit never change, so they are held; the head's are read again as a
 * surface asks for them anew.
 */
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
      place === undefined ? skipToken : () => askAct(ACT_KIND.TASKS_FILE, { ...place, ...request }),
    staleTime: ref === undefined ? 0 : Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/** Every listing of the repository a place reads, which a File view marks stale as it opens. */
export function taskTreeKey(place: FileReadPlace) {
  return [QUERY_ROOT.TASK_TREE, ...placeIds(place)] as const;
}

/**
 * One folder of the repository at its default branch, or, recursive, every
 * path under it. A listing is held once it lands, so a folder is listed once
 * however many ask; one the service refused is not, so the next ask lists it
 * again.
 */
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
              // Note that a task's tree is asked for by its plan, and a repository's by its workspace.
              ...("taskId" in place ? { planId: place.taskId } : place),
              path,
              ...(recursive ? { recursive } : undefined),
            }),
    staleTime: (query) =>
      query.state.data !== undefined && "folder" in query.state.data ? Number.POSITIVE_INFINITY : 0,
    retry: false,
  });
}

/** Every page source a page's tab read, of every version, which its Reload forgets. */
export function pageSourcesKey(place: PagePlace, pageId: string) {
  return [
    QUERY_ROOT.PAGE_SOURCE,
    "taskId" in place ? place.taskId : null,
    "agentId" in place ? place.agentId : null,
    pageId,
  ] as const;
}

/**
 * One version's source, colored as HTML: a version's source never changes,
 * so it is held until Reload forgets it, and a read that failed is asked
 * again only on Retry.
 */
export function pageSourceQueryOptions(place: PagePlace, pageId: string, version: number) {
  return queryOptions({
    queryKey: [...pageSourcesKey(place, pageId), version],
    queryFn: () => askAct(ACT_KIND.TASKS_PAGE_SOURCE, { ...place, pageId, version }),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    retryOnMount: false,
  });
}
